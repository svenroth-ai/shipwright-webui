/*
 * headless-mirror.ts — Iterate A (ADR-088)
 *
 * Per-task @xterm/headless Terminal instance that mirrors a live pty's
 * byte stream. Lives only while the pty is live. On dispose we snapshot
 * the stable cell-state via the M2 double-serialize stabilization
 * (`serializeStable()`) and the caller persists it to disk via
 * snapshot-store.
 *
 * Architecture invariants (from .shipwright/planning/embedded-terminal-refactor-headless.md):
 *
 *   1. Headless mirrors only for LIVE ptys. Idle/completed tasks persist
 *      only the serialized snapshot on disk, not a live Terminal instance.
 *   2. @xterm/headless is CJS — wire via the default-import-destructure
 *      shim from this file's ESM consumers.
 *   3. `term.write(data, callback)` MUST be awaited before serialize. The
 *      parser is async-ish; serializing immediately after a batch can
 *      capture incomplete state. write() below wraps the callback in a
 *      Promise.
 *   4. Snapshot version is pinned by the caller (snapshot-store header);
 *      no version logic lives here. The output of serializeStable() is
 *      the verbatim payload that gets the header glued on.
 *   5. Plan-D″ (ADR-034) unaffected — this mirror parses pty output;
 *      never spawns Claude. The pty-manager spawn whitelist is unchanged.
 *
 * Why M2 (double-serialize)? Spike T2 in the planning doc proved that
 * `serialize → write-back → serialize` is idempotent: round2 == round3.
 * The first serialize ("raw") has a 1-character resize-drift artifact
 * (column-0 dash on one line of an otherwise-blank dialog row in the
 * production scenario). One extra parse + serialize cycle eliminates it.
 * Cost: ~10 ms per attach. See planning doc § "Resize-drift mitigation".
 */

// CJS interop. @xterm/headless ships CommonJS; @xterm/addon-serialize
// ships CommonJS. ESM consumers must default-import the package and
// destructure the named export.
import pkg from "@xterm/headless";
import addonPkg from "@xterm/addon-serialize";
const { Terminal } = pkg;
const { SerializeAddon } = addonPkg;

// Re-derive the Terminal type from the value-only import. addon-serialize
// works by side-effect (loadAddon) — we don't need a separate type from it.
type XtermTerminal = InstanceType<typeof Terminal>;

/**
 * DECTCEM (cursor-visibility) restore sequences.
 *
 * `@xterm/addon-serialize`'s `_serializeModes()` serializes the public
 * IModes set + the mouse-tracking selector, but NEVER DECTCEM (`?25`).
 * `serializeStable()` re-appends exactly one of these so a reattach
 * reproduces the producer's cursor-visibility state instead of xterm's
 * always-visible default. Sibling workaround for the same addon-serialize
 * mode-drop class: `replay-snapshot.ts` re-appends `?1006h`.
 */
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

/**
 * Snapshot every line in the active buffer (scrollback + viewport) as
 * strings — used by serializeStableWithCanonicalBuffer to capture the
 * round2 reference. translateToString(false) preserves trailing spaces;
 * the test compares character-for-character.
 */
function snapshotVisibleLines(term: XtermTerminal): string[] {
  const buffer = term.buffer.active;
  const total = buffer.length;
  const out: string[] = new Array(total);
  for (let y = 0; y < total; y++) {
    const line = buffer.getLine(y);
    out[y] = line ? line.translateToString(false) : "";
  }
  return out;
}

export interface HeadlessMirrorOpts {
  taskId: string;
  cols: number;
  rows: number;
  /**
   * Scrollback depth for the live mirror. xterm.js default is 1000.
   * Matches `EmbeddedTerminal.tsx` client-side scrollback so visible
   * regions line up.
   */
  scrollback?: number;
}

/**
 * Per-task headless terminal mirror. Disposable.
 *
 * Lifecycle:
 *   - new HeadlessMirror({...})            — construct in pty-manager.spawn
 *   - await mirror.write(buf)              — once per pty.onData chunk
 *   - const snap = await mirror.serializeStable()  — on pty.kill / dispose
 *   - mirror.dispose()                     — frees the Terminal instance
 *
 * Memory: a Terminal at 120×30 with 1 000-line scrollback uses ~1-2 MB
 * RSS measured under the spike. Multiplied by the active-task-count cap
 * in pty-manager, total live-mirror memory stays well under the spike's
 * 80 MB ceiling across multiple in-scope terminals.
 */
/**
 * Hard caps to defeat resize-DoS. xterm.js allocates per-cell state, so
 * 100 000 × 100 000 = 10 000 000 000 cells would OOM the Node process.
 * Real terminals top out around 500 × 200; we cap at 1000 × 500 (well
 * above any real terminal) so a misbehaving client can't request a
 * pathological resize. Clamping is silent because the pty itself uses
 * the requested dims — the mirror just clamps for its own buffer
 * allocation (round-tripped through resize() below).
 */
const MAX_COLS = 1000;
const MAX_ROWS = 500;
function clampCols(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.floor(n), MAX_COLS);
}
function clampRows(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.floor(n), MAX_ROWS);
}

export class HeadlessMirror {
  public readonly taskId: string;
  private term: XtermTerminal;
  private cols: number;
  private rows: number;
  private readonly scrollback: number;
  private disposed = false;
  /**
   * Tracks unresolved write() resolvers. serializeStable() awaits the
   * corresponding promises before snapshotting so the parser cannot be
   * mid-CSI / mid-OSC when the serialize callback runs (Gemini
   * external-review #4 + architecture invariant #3 + external code
   * review HIGH: tracking resolvers explicitly so `dispose()` can
   * forcibly resolve them and never hang `flushPendingWrites`).
   *
   * Stored as a Map of Promise -> resolver so dispose() can drain the
   * set without waiting for parser callbacks that may never fire on a
   * disposed Terminal. The set is bounded by the in-flight write count.
   */
  private pendingWrites = new Map<Promise<void>, () => void>();

  constructor(opts: HeadlessMirrorOpts) {
    this.taskId = opts.taskId;
    this.cols = clampCols(opts.cols);
    this.rows = clampRows(opts.rows);
    this.scrollback = opts.scrollback ?? 1000;
    this.term = new Terminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollback,
      // allowProposedApi: serializeAddon uses proposed APIs on some
      // versions; setting true is the documented requirement.
      allowProposedApi: true,
    });
  }

  /**
   * Test-only handle on the underlying Terminal. Real callers go through
   * write/serializeStable/dispose; the fixture test needs to feed bytes
   * and snapshot visible lines directly.
   */
  get terminalForTesting(): XtermTerminal {
    return this.term;
  }

  /**
   * Feed raw bytes into the headless mirror. Awaits the parser callback
   * before resolving — this is architecture invariant #3, required for
   * mid-escape split correctness.
   *
   * Accepts Buffer | Uint8Array | string. node-pty emits strings by
   * default; the snapshot pipeline can also feed Buffers.
   */
  write(data: Buffer | Uint8Array | string): Promise<void> {
    if (this.disposed) {
      // No-op on disposed mirror; never throw from the pty.onData hot path.
      return Promise.resolve();
    }
    // Capture resolver in a closure so dispose() can drain pending
    // writes without depending on the parser callback ever firing on a
    // disposed Terminal (external code review HIGH: hang risk).
    let storedResolve!: () => void;
    const p = new Promise<void>((resolve) => {
      storedResolve = resolve;
      try {
        // Cast: @xterm/headless typings accept string | Uint8Array.
        // Buffer is a Uint8Array subclass so the cast is safe.
        this.term.write(data as string | Uint8Array, () => resolve());
      } catch (err) {
        // Parser exceptions are silently swallowed — the broadcast loop
        // must stay live (external review Gemini #3). The pending-writes
        // tracking still resolves so serializeStable() doesn't block.
        // eslint-disable-next-line no-console
        console.warn(
          `[headless-mirror] term.write threw for ${this.taskId}: ${(err as Error).message}`,
        );
        resolve();
      }
    });
    this.pendingWrites.set(p, storedResolve);
    p.finally(() => {
      this.pendingWrites.delete(p);
    });
    return p;
  }

  /**
   * Await every in-flight write callback. Used internally by
   * serializeStable so the parser is in a stable state when round1
   * runs (architecture invariant #3 + external review Gemini #4).
   */
  private async flushPendingWrites(): Promise<void> {
    // Snapshot the current set; new writes that arrive while we wait
    // are not part of this flush. This is intentional: serializeStable
    // captures the state at the moment cleanup decided to snapshot.
    const inflight = [...this.pendingWrites.keys()];
    if (inflight.length === 0) return;
    await Promise.all(inflight);
  }

  /**
   * Adjust dimensions. Headless terminal preserves scrollback contents
   * across resize; rewrap behavior follows xterm.js's reflow.
   */
  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    // Clamp to defeat resize-DoS (external review Gemini #5). The pty
    // itself is sized by the caller; we cap only the mirror.
    this.cols = clampCols(cols);
    this.rows = clampRows(rows);
    this.term.resize(this.cols, this.rows);
  }

  /**
   * M2 double-serialize. Per spike T2: `serialize → write-back → serialize`
   * is idempotent at round2 == round3, so this produces the stable fixed
   * point that the client's xterm.js will reproduce byte-for-byte.
   *
   * Procedure:
   *   raw   = primary serialize (may contain 1-char drift artifacts)
   *   warm  = transient Terminal, replay raw, serialize → stable (round2)
   *   return stable, dispose warm
   *
   * Contract: when the returned `stable` string is later written into a
   * fresh client-side xterm Terminal of the same cols/rows, that
   * Terminal's visible buffer (round3 application) is line-for-line
   * equal to the warm Terminal's visible buffer at the moment of round2
   * serialization. The live mirror's own visible buffer is round1 — it
   * may differ from round2 by one or two cells on resize boundaries.
   * That is the documented one-shot artifact M2 trades for idempotence.
   *
   * The warm Terminal MUST use identical cols/rows + scrollback so the
   * replay buffer is identical in shape.
   */
  async serializeStable(): Promise<string> {
    const { stable } = await this.serializeStableWithCanonicalBuffer();
    return stable;
  }

  /**
   * Same as serializeStable() but also returns the canonical (round2)
   * visible-buffer snapshot. Test-only — production callers use
   * serializeStable() which discards the buffer. The round2 buffer is
   * the contract reference: a client replay of `stable` produces the
   * same lines.
   *
   * `stable` additionally carries a trailing DECTCEM (`?25h` / `?25l`):
   * addon-serialize never serializes cursor visibility, so it is restored
   * explicitly here — see `readCursorHidden()`.
   */
  async serializeStableWithCanonicalBuffer(): Promise<{
    stable: string;
    canonicalLines: string[];
  }> {
    if (this.disposed) {
      throw new Error("HeadlessMirror.serializeStable: mirror is disposed");
    }
    // External review Gemini #4 — drain in-flight writes so the live
    // parser is at a stable state (NOT mid-CSI / mid-OSC) before
    // round1 serializes. Without this, a fire-and-forget pty.onData
    // mirror.write() that arrived just before kill could leave the
    // serialize output missing the trailing payload bytes.
    await this.flushPendingWrites();
    // Capture DECTCEM from the LIVE mirror now — after the flush so a
    // trailing ?25 toggle in the last pty chunk is already processed, and
    // before round1/round2 (which read addon state, not this.term's
    // cursor mode). addon-serialize drops ?25 entirely; readCursorHidden()
    // + the append at the return is the restore.
    const cursorHidden = this.readCursorHidden();
    // Round 1 — serialize the live mirror.
    const liveAddon = new SerializeAddon();
    this.term.loadAddon(liveAddon);
    let raw: string;
    try {
      raw = liveAddon.serialize();
    } finally {
      liveAddon.dispose();
    }

    // Round 2 — replay into a warm Terminal of identical dimensions +
    // scrollback. Serialize the warm one. Per T2, this output equals
    // round 3 (the next replay would be idempotent).
    const warm = new Terminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollback,
      allowProposedApi: true,
    });
    const warmAddon = new SerializeAddon();
    warm.loadAddon(warmAddon);
    try {
      await new Promise<void>((resolve) => {
        warm.write(raw, () => resolve());
      });
      const stable = warmAddon.serialize();
      const canonicalLines = snapshotVisibleLines(warm);
      // DECTCEM restore — append the cursor-visibility mode addon-serialize
      // never emits. Position-independent and idempotent (xterm no-ops a
      // redundant mode set), so it does not perturb the M2 fixed point or
      // the round2 visible buffer (`canonicalLines`) — cursor visibility is
      // not cell content.
      const stableWithCursor =
        stable + (cursorHidden ? CURSOR_HIDE : CURSOR_SHOW);
      return { stable: stableWithCursor, canonicalLines };
    } finally {
      warmAddon.dispose();
      warm.dispose();
    }
  }

  /**
   * Live mirror's DECTCEM state — `true` when the cursor is hidden.
   * addon-serialize never serializes `?25`, so `serializeStable()` restores
   * it explicitly: else a reattach shows a ghost cursor that Claude Code
   * (fullscreen under `CLAUDE_CODE_NO_FLICKER=1`, ADR-095/098) believes is
   * hidden, jumping with every CUP redraw. The `_core.coreService` peek is
   * an internal-surface read (xterm exact-pinned 6.0.0, CLAUDE.md rule 22),
   * correct across `?25l` / `?25h` AND soft-reset. Unreadable internal →
   * `false` (pre-fix behaviour) so a future xterm refactor degrades safely.
   */
  private readCursorHidden(): boolean {
    try {
      const core = (this.term as unknown as {
        _core?: { coreService?: { isCursorHidden?: boolean } };
      })._core;
      return core?.coreService?.isCursorHidden === true;
    } catch {
      return false;
    }
  }

  /** Current dimensions. Used by snapshot-store to write the header. */
  get dimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Idempotent. External code review HIGH: drain pending writes BEFORE
   * disposing the Terminal so any `flushPendingWrites()` awaiters can
   * resolve immediately rather than wait forever on parser callbacks
   * that will never fire on a disposed Terminal.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Forcibly resolve any in-flight write promises. The associated
    // `term.write` callback may never run on a disposed Terminal; this
    // path guarantees flushPendingWrites() returns instead of hanging.
    for (const resolve of this.pendingWrites.values()) {
      try {
        resolve();
      } catch {
        /* ignore */
      }
    }
    this.pendingWrites.clear();
    try {
      this.term.dispose();
    } catch {
      // best-effort
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
