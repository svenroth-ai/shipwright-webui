/*
 * routes.ts — embedded-terminal HTTP + WebSocket surface (iterate-2026-05-03).
 *
 * The WebSocket upgrade at GET /api/terminal/:taskId/ws is the AUTHORITATIVE
 * lifecycle entrypoint: it ensure-or-creates the pty atomically. The
 * separate POST /spawn route is retained only as an idempotent prewarm
 * (returns the existing handle if one exists; never duplicates).
 *
 * External-review (2026-05-03) drove these contracts:
 *   - WS upgrade rejects unknown Origin (loopback CORS posture mirrored).
 *   - Writer ownership tied to the live WS conn identity; cleared on close.
 *   - Backpressure handled inside PtyManager via WS.bufferedAmount.
 *   - PTY persists across last-connection detach (ADR-068-A1 Replay-on-
 *     Attach). Orphan GC runs via the 30-min idle ceiling + explicit
 *     "Stop terminal session" / DELETE task cascade.
 *
 * Auth posture: same loopback-only CORS gate as the rest of the HTTP
 * surface. A future remote-access mode would need additional auth (see
 * ADR-067).
 *
 * Iterate-2026-05-27 (ADR-103 retirement candidate #1): the WS upgrade
 * BODY moved to `ws-upgrade-handler.ts`. This file retains:
 *   - reject-the-upgrade validations (origin, task, trustedCwd) — they
 *     MUST stay synchronous here, otherwise failure mode degrades from
 *     "HTTP upgrade rejection" to "silent WS disconnect" (external plan
 *     review HIGH #1, 2026-05-27);
 *   - HTTP route handlers (spawn, close, clear-scrollback, paste-image,
 *     append-gitignore);
 *   - the spawn-env factory (buildSpawnEnv, createNodePtySpawnFn).
 */

import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { stat as fsStat } from "node:fs/promises";

import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import { pathGuard, realPathGuard } from "../core/path-guard.js";
import { resolveTrustedOrigins } from "../lib/resolveTrustedOrigins.js";
import type {
  PtyHandleApi,
  PtyManager,
  PtySpawnFn,
  ShellKind,
} from "./pty-manager.js";
import { quotePathForShell } from "./pty-manager.js";
import {
  appendGitignoreLine,
  ImagePasteError,
  MAX_IMAGE_BYTES,
  savePastedImage,
} from "./image-paste.js";
import type { ScrollbackStore } from "./scrollback-store.js";
import type { SnapshotStore } from "./snapshot-store.js";
import {
  buildWsHandlers,
  type ValidatedWsUpgradeContext,
} from "./ws-upgrade-handler.js";

// Re-export `deriveTerminalReset` for any historical importer. The
// canonical home is `./terminal-reset.js` (extracted in iterate-2026-
// 05-27-ws-upgrade-handler-split to break the routes.ts ↔ ws-upgrade-
// handler.ts cycle — external plan review MED #3, 2026-05-27).
export { deriveTerminalReset } from "./terminal-reset.js";

export interface TerminalRoutesDeps {
  store: SdkSessionsStore;
  ptyManager: PtyManager;
  upgradeWebSocket: UpgradeWebSocket<WebSocket, { onError: (err: unknown) => void }>;
  /** Allowed Origin header values for the WS upgrade. */
  allowedOrigins?: (origin: string | null) => boolean;
  /**
   * Shell resolver — defaults to pwsh.exe on win32, $SHELL || /bin/bash
   * elsewhere. Can be overridden for tests. Returned value MUST be on
   * the PtyManager whitelist or spawn() will reject.
   */
  resolveShell?: () => string;
  /** Per-task.cwd image-paste retention (default 20). */
  pastesKeepLast?: number;
  /**
   * Iterate-2026-05-04 (ADR-068-A1) — disk-backed scrollback. Optional
   * for tests; production uses a single ScrollbackStore instance shared
   * with PtyManager so append + replay see the same disk state.
   */
  scrollbackStore?: ScrollbackStore;
  /**
   * Iterate-2026-05-11 (ADR-089, Iterate B) — headless-mirror snapshot
   * store. When wired AND a snapshot exists on disk for the task AND
   * the snapshot's `terminalVersion` matches the currently-pinned
   * `@xterm/headless` version, the WS attach emits a single
   * `replay_snapshot` envelope. When missing or version-mismatched
   * (Iterate C, ADR-087), no replay history is sent — the client gets
   * a blank terminal with a live shell. The legacy chunked-replay
   * fallback path has been retired.
   */
  snapshotStore?: SnapshotStore;
  /**
   * Iterate-2026-05-11 (ADR-089) — currently-pinned `@xterm/headless`
   * version. Used to gate the snapshot path: header.terminalVersion
   * must equal this string for the snapshot to be served, otherwise
   * no replay history is sent (Iterate C / ADR-087 retired the chunked
   * fallback). Production wires the value read from `@xterm/headless`'s
   * package.json so the gate stays coupled to the npm pin.
   */
  expectedTerminalVersion?: string;
  /**
   * Iterate v0.8.2 AC-9 — retention TTL surfaced in the WS `ready`
   * envelope so the disclosure footer can interpolate the actual value.
   * Defaults to 1 day to match `SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS`
   * default in config.ts.
   */
  retentionDays?: number;
  /**
   * Iterate v0.8.2 AC-9 — resolved scrollback directory path surfaced
   * in the WS `ready` envelope. Defaults to a placeholder when no
   * scrollbackStore is wired (test config).
   */
  scrollbackDirHint?: string;
}

// Iterate v0.8.4 — the WS upgrade Origin gate now defers to
// `resolveTrustedOrigins(process.env)` so it widens consistently with
// `HONO_HOST` / `WEBUI_TRUSTED_ORIGINS`. The default (no env vars set)
// remains loopback-only, identical to the pre-iterate behaviour.
//
// External code-review F4 still binds: `null` / empty Origin is
// rejected unconditionally (browsers always send an Origin header on
// WS upgrades from a real page; absent = non-browser caller, which
// falls outside the CORS contract regardless of policy mode).
function defaultAllowedOrigins(origin: string | null): boolean {
  return resolveTrustedOrigins(process.env).isAllowed(origin);
}

/**
 * Probe the Windows shell fallback chain pwsh → powershell → cmd. Returns
 * the first executable we can resolve via the PATH. Cached per-process —
 * shells don't disappear during a server lifetime. ESM-safe (no require).
 */
let cachedWinShell: string | null = null;
function resolveWindowsShell(): string {
  if (cachedWinShell !== null) return cachedWinShell;
  for (const candidate of ["pwsh.exe", "powershell.exe", "cmd.exe"]) {
    const r = spawnSync("where", [candidate], { stdio: "ignore" });
    if (r.status === 0) {
      cachedWinShell = candidate;
      return candidate;
    }
  }
  // Last-resort: cmd.exe is essentially always present on Windows.
  cachedWinShell = "cmd.exe";
  return "cmd.exe";
}

/**
 * Resolve task.cwd through realpath BEFORE using it as the trusted root
 * for any path-guard check. Without this, a symlinked task.cwd could
 * pass child-path checks while pointing the new write surface outside
 * the intended project root (external review F2 v2 — security HIGH).
 *
 * Returns the realpath-resolved absolute cwd, or null if cwd is missing
 * or unresolvable. Caller must hard-fail (404 / 403) on null.
 */
function resolveTrustedCwd(rawCwd: string | undefined | null): string | null {
  if (!rawCwd || typeof rawCwd !== "string") return null;
  if (rawCwd.indexOf("\0") !== -1) return null;
  if (!existsSync(rawCwd)) return null;
  try {
    return realpathSync(rawCwd);
  } catch {
    return null;
  }
}

function defaultResolveShell(): string {
  if (os.platform() === "win32") {
    return process.env.SHIPWRIGHT_TERMINAL_SHELL ?? resolveWindowsShell();
  }
  return process.env.SHIPWRIGHT_TERMINAL_SHELL ?? process.env.SHELL ?? "/bin/bash";
}

export function createTerminalRoutes(deps: TerminalRoutesDeps) {
  const { store, ptyManager, upgradeWebSocket } = deps;
  const allowedOrigins = deps.allowedOrigins ?? defaultAllowedOrigins;
  const resolveShell = deps.resolveShell ?? defaultResolveShell;
  const pastesKeepLast = deps.pastesKeepLast ?? 20;
  const scrollbackStore = deps.scrollbackStore;
  const snapshotStore = deps.snapshotStore;
  const expectedTerminalVersion = deps.expectedTerminalVersion;
  // Iterate v0.8.2 AC-9: defaults match config.ts so a wired path is
  // always preferred but the constructor stays optional.
  const retentionDays = deps.retentionDays ?? 1;
  const scrollbackDirHint = deps.scrollbackDirHint ?? "<scrollback>";

  return (app: Hono): Hono => {
    // --- POST /api/terminal/:taskId/spawn — idempotent prewarm ------------
    app.post("/api/terminal/:taskId/spawn", async (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      const task = store.get(taskId);
      if (!task) return c.json({ error: "task_not_found" }, 404);
      const trustedCwd = resolveTrustedCwd(task.cwd);
      if (!trustedCwd) return c.json({ error: "task_cwd_unresolvable" }, 404);

      try {
        const meta = ptyManager.spawn(taskId, {
          cwd: trustedCwd,
          shell: resolveShell(),
        });
        return c.json({
          taskId: meta.taskId,
          shell: meta.shell,
          shellKind: meta.shellKind,
          cwd: meta.cwd,
        });
      } catch (err) {
        return c.json(
          { error: "pty_spawn_rejected", detail: String((err as Error).message) },
          400,
        );
      }
    });

    // --- POST /api/terminal/:taskId/close ---------------------------------
    // ADR-068-A1: kill pty only — scrollback is RETAINED on disk.
    // Re-attach replays the history. Use /clear-scrollback to delete.
    app.post("/api/terminal/:taskId/close", (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      ptyManager.kill(taskId);
      return c.body(null, 204);
    });

    // --- POST /api/terminal/:taskId/clear-scrollback (ADR-068-A1) --------
    // Loud destructive: deletes <taskId>.log + <taskId>.log.1. Throws on
    // failure (5xx) so the UI surfaces an inline error. Independent of
    // /close — the user can clear history while the pty stays alive
    // (the next pty.onData will re-create the file).
    app.post("/api/terminal/:taskId/clear-scrollback", async (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      if (!scrollbackStore) {
        // No store wired (test config) — treat as no-op success.
        return c.body(null, 204);
      }
      try {
        await scrollbackStore.clear(taskId);
        return c.body(null, 204);
      } catch (err) {
        const detail = String((err as Error).message);
        // ScrollbackStoreError("invalid_task_id") → 400; everything else
        // (path-guard escape, EACCES, …) → 500.
        const code = (err as { code?: string }).code;
        if (code === "invalid_task_id") {
          return c.json({ error: "invalid_task_id", detail }, 400);
        }
        if (code === "scrollback_path_outside_dir") {
          return c.json({ error: "scrollback_path_outside_dir", detail }, 403);
        }
        return c.json({ error: "clear_failed", detail }, 500);
      }
    });

    // --- POST /api/terminal/:taskId/paste-image ---------------------------
    // Multipart/form-data with field "image: File". Saves to
    // <task.cwd>/.shipwright-webui/pastes/img-<ts>-<rand>.<ext> (iterate v0.8.2
    // AC-6 — moved from `.claude-pastes/`), prunes to keep-last-N, and
    // pty.write()s the shell-quoted absolute path into the buffer
    // (followed by a trailing space). 413 fast-fail on large Content-Length.
    app.post("/api/terminal/:taskId/paste-image", async (c) => {
      // Iterate v0.8.2 AC-4: structured timing logs gated by
      // SHIPWRIGHT_DEBUG_PASTE_TIMING. Off in prod by default; flip on
      // when diagnosing the latency of the full clipboard→pty roundtrip.
      const debugTiming =
        process.env.SHIPWRIGHT_DEBUG_PASTE_TIMING === "1" ||
        process.env.SHIPWRIGHT_DEBUG_PASTE_TIMING === "true";
      const t0 = debugTiming ? performance.now() : 0;
      const mark = (label: string): void => {
        if (!debugTiming) return;
        const elapsed = (performance.now() - t0).toFixed(1);
        // eslint-disable-next-line no-console
        console.log(`[paste-image] ${label} t+${elapsed}ms`);
      };
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      const task = store.get(taskId);
      if (!task) return c.json({ error: "task_not_found" }, 404);
      const trustedCwd = resolveTrustedCwd(task.cwd);
      if (!trustedCwd) return c.json({ error: "task_cwd_unresolvable" }, 404);

      // Content-Length precheck — refuse before buffering. 9 MiB ceiling
      // gives 1 MiB of headroom over the 8 MiB blob cap (multipart envelope
      // overhead). External review F2 v2: also refuse missing/invalid
      // Content-Length so chunked-transfer can't bypass the precheck.
      const rawLen = c.req.header("content-length");
      if (!rawLen) {
        return c.json({ error: "content_length_required" }, 411);
      }
      const contentLength = parseInt(rawLen, 10);
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return c.json({ error: "content_length_invalid" }, 400);
      }
      if (contentLength > 9 * 1024 * 1024) {
        return c.json({ error: "image_too_large" }, 413);
      }

      let body: Awaited<ReturnType<typeof c.req.parseBody>>;
      try {
        body = await c.req.parseBody();
      } catch (err) {
        return c.json({ error: "invalid_multipart", detail: String((err as Error).message) }, 400);
      }
      mark("parseBody-done");
      const file = body.image;
      if (!(file instanceof File)) {
        return c.json({ error: "missing_image_field" }, 400);
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (err) {
        return c.json({ error: "image_read_failed", detail: String((err as Error).message) }, 400);
      }
      mark(`bytes-extracted size=${bytes.byteLength}`);

      // External review F3 (v2): if no pty exists yet, ensure-or-create
      // it so paste-image works even when the user pastes into a freshly
      // opened terminal tab. The writer-gate still applies — paste-image
      // never writes if the current writer is a different tab.
      try {
        let meta = ptyManager.get(taskId);
        if (!meta) {
          try {
            meta = ptyManager.spawn(taskId, {
              cwd: trustedCwd,
              shell: resolveShell(),
            });
          } catch {
            // Spawn failure is non-fatal here — the file save still
            // succeeds; the response will report ptyWritten=false.
            meta = undefined;
          }
        }
        const result = await savePastedImage({
          cwd: trustedCwd,
          bytes,
          keepLast: pastesKeepLast,
        });
        mark("savePastedImage-done");
        let ptyWritten = false;
        if (meta && ptyManager.hasActiveWriter(taskId)) {
          const quoted = quotePathForShell(result.absolutePath, meta.shellKind);
          ptyManager.write(taskId, quoted + " ");
          ptyWritten = true;
        }
        mark(`response-out ptyWritten=${ptyWritten}`);
        return c.json({
          path: result.absolutePath,
          kind: result.kind,
          gitignoreSuggestion: result.gitignoreSuggestion,
          ptyWritten,
          kept: result.prune.kept,
          deleted: result.prune.deleted,
        });
      } catch (err) {
        if (err instanceof ImagePasteError) {
          const status = err.code === "image_too_large" ? 413 : 400;
          return c.json({ error: err.code, detail: err.message }, status);
        }
        return c.json(
          { error: "internal_error", detail: String((err as Error).message) },
          500,
        );
      }
    });

    // --- POST /api/terminal/:taskId/append-gitignore ----------------------
    // Idempotent append of `.shipwright-webui/` to <task.cwd>/.gitignore
    // (iterate v0.8.2 AC-6). realpath-guarded so a symlinked .gitignore can't
    // redirect the write outside cwd (external review F11).
    app.post("/api/terminal/:taskId/append-gitignore", async (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      const task = store.get(taskId);
      if (!task) return c.json({ error: "task_not_found" }, 404);
      const trustedCwd = resolveTrustedCwd(task.cwd);
      if (!trustedCwd) return c.json({ error: "task_cwd_unresolvable" }, 404);

      const guard = pathGuard(trustedCwd, ".gitignore");
      if (!guard.ok) {
        return c.json({ error: "path_guard_traversal", detail: guard.reason }, 403);
      }
      // External code-review F2: existence FIRST, then realPathGuard.
      // realPathGuard internally calls realpathSync, which throws on
      // ENOENT — without this ordering, a missing .gitignore returns
      // 403 gitignore_symlink_escape (wrong) instead of 404
      // gitignore_missing (the spec'd behavior).
      try {
        await fsStat(guard.absolute);
      } catch {
        return c.json({ error: "gitignore_missing" }, 404);
      }
      const real = realPathGuard(trustedCwd, guard.absolute);
      if (!real.ok) {
        return c.json({ error: "gitignore_symlink_escape", detail: real.reason }, 403);
      }
      try {
        const did = await appendGitignoreLine(real.absolute);
        if (!did) {
          // Already present (we already proved the file exists).
          return c.json({ ok: true, appended: false, reason: "already_present" });
        }
        return c.body(null, 204);
      } catch (err) {
        return c.json(
          { error: "internal_error", detail: String((err as Error).message) },
          500,
        );
      }
    });

    // Iterate C (ADR-087): the legacy chunked-replay path
    // (replay_start → replay_chunk* → replay_separator → replay_end)
    // has been RETIRED. Cell-state snapshots produced by the
    // @xterm/headless mirror (ADR-088/089) are the sole replay
    // primitive. When a snapshot is unavailable (missing on disk,
    // version mismatch, or `headlessMirrorEnabled=false`), the client
    // gets a blank terminal with a live shell — per the plan's
    // explicit trade-off.

    // --- GET /api/terminal/:taskId/ws — authoritative lifecycle entry ----
    //
    // VALIDATION TIMING contract (external plan review HIGH #1,
    // 2026-05-27): every reject-the-upgrade check below MUST throw
    // synchronously inside the `upgradeWebSocket((c) => …)` factory
    // BEFORE `buildWsHandlers` returns its handler object. A throw
    // here rejects the HTTP Upgrade; a throw inside `onOpen` only
    // closes an already-upgraded socket — silently from the client's
    // perspective. Do NOT move any of these checks into the
    // ws-upgrade-handler.ts body.
    app.get(
      "/api/terminal/:taskId/ws",
      upgradeWebSocket((c) => {
        const taskId = c.req.param("taskId");
        if (!taskId) throw new Error("missing_task_id");
        const origin = c.req.header("origin") ?? null;
        if (!allowedOrigins(origin)) {
          // Refuse via upgrade rejection: throw so onError handles it,
          // and the client sees the WS connection close immediately.
          throw new Error("origin_not_allowed");
        }
        const task = store.get(taskId);
        if (!task) throw new Error("task_not_found");
        const trustedCwd = resolveTrustedCwd(task.cwd);
        if (!trustedCwd) throw new Error("task_cwd_unresolvable");

        const ctx: ValidatedWsUpgradeContext = {
          taskId,
          task,
          trustedCwd,
          ptyManager,
          store,
          scrollbackStore,
          snapshotStore,
          expectedTerminalVersion,
          retentionDays,
          scrollbackDirHint,
          resolveShell,
        };
        return buildWsHandlers(ctx);
      }),
    );

    return app;
  };
}

// ---------------------------------------------------------------------------
// PtySpawnFn factory — wraps @lydell/node-pty so PtyManager stays
// dependency-injection-friendly + native-binary-free in tests.
// ---------------------------------------------------------------------------

/**
 * Iterate G (ADR-095), amended Iterate I (ADR-097), restored Iterate J
 * (ADR-098) — pure helper that builds the env map handed to the spawned
 * pty. Factored out of `createNodePtySpawnFn` so it can be unit-tested
 * without the native node-pty binary.
 *
 * Layered as: baseProcessEnv → TERM/COLORTERM/FORCE_COLOR brand-fit
 * overrides (ADR-067) → CLAUDE_CODE_NO_FLICKER toggle
 * (ADR-095/ADR-097/ADR-098) → caller-supplied opts.env (last-write-wins
 * for most keys; the default-on CLAUDE_CODE_NO_FLICKER is protected
 * from accidental caller silent-revert — see opt-out-wins symmetry
 * below).
 *
 * CLAUDE_CODE_NO_FLICKER (ADR-098):
 *   - Default ON: the key is written as `"1"` into the env map.
 *     Claude Code renders into the alt-screen buffer (vim/htop-style),
 *     bypassing per-frame ANSI cursor moves entirely. Required because
 *     Claude Code 2.1.139 emits ZERO DECSET 2026 / Synchronized Output
 *     sequences in its main-buffer rendering (empirical: 265 711-byte
 *     live scrollback, 0 `\x1b[?2026h` / 0 `\x1b[?2026l`, 21 690 raw
 *     CUP sequences). xterm 6.0's native sync-output honour has
 *     nothing to batch because the producer never opts in.
 *     Claude Code Issue #37283 remains open. Docs:
 *     https://code.claude.com/docs/en/fullscreen.
 *   - Opt-OUT via SHIPWRIGHT_TERMINAL_NO_FLICKER=0: the key is deleted
 *     from the env map so the child shell sees whatever (if anything)
 *     the upstream env set. Useful for users who explicitly want
 *     Claude in the main buffer (Cmd+F scrollback search, mouse
 *     capture, etc.) and are willing to accept the visible flicker
 *     around streaming output.
 *
 * Reversion from ADR-097's opt-in default: ADR-097 hypothesised that
 * xterm 6's DECSET 2026 honour would batch Claude TUI's main-buffer
 * frames flicker-free. UAT post-Iterate-I falsified the hypothesis;
 * ADR-098 documents the empirical scrollback investigation. The
 * default-on stance from ADR-095 is restored verbatim. The
 * "opt-out wins over caller-env override" semantic (ADR-095, external
 * code review openai medium, 2026-05-13) is preserved as the
 * symmetric default-on regression fence.
 */
export function buildSpawnEnv(
  baseProcessEnv: Record<string, string | undefined>,
  callerEnv?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  // ADR-067 brand fit on Windows: chalk's `supports-color` package
  // has a hardcoded Windows branch that returns level 3 (truecolor)
  // for Windows 10 build ≥14931 — REGARDLESS of TERM, COLORTERM, or
  // FORCE_COLOR=1. Claude Code uses chalk under ink, so its
  // "auto mode on" banner emits RGB \x1b[38;2;...m escapes that
  // bypass our 16-slot xterm theme and render the original neon
  // yellow on beige.
  //
  // The single escape hatch in supports-color:
  //
  //   if (env.TERM === 'dumb') { return min; }   // min = FORCE_COLOR || 0
  //
  // So `TERM=dumb` + `FORCE_COLOR=1` returns level 1 (16-color),
  // which falls into our brand theme. Trade-off: ncurses-based tools
  // (vim, less, htop) also see TERM=dumb and disable their colors;
  // power users can override per-shell via `$env:TERM = "xterm"`
  // before invoking those tools. For Claude Code as the primary
  // workload of this pane, brand consistency wins over vim color.
  //
  // Iterate K UAT 2026-05-14: empirically tested `TERM=xterm-256color`
  // (siteboon-parity) hoping it would unlock Claude/Ink sync-output
  // emission. Falsified: byte-stream histogram of pre/post scrollback
  // for the same task showed 0 DECSET 2026 sequences in BOTH eras.
  // TERM=dumb does NOT block Claude's sync-output. It DOES, however,
  // suppress PowerShell 7's xterm window manipulation + cursor-shape
  // + ED2 sequences emitted on each PSReadLine prompt redraw — which
  // added visible new flicker / minor smearing on Strg+C return to
  // shell. Keeping TERM=dumb. Real flicker fix is xterm.js side:
  // scrollOnEraseInDisplay (see EmbeddedTerminal.tsx) — see xtermjs
  // issue #5620 + maintainer @jerch's diagnosis.
  const env: Record<string, string | undefined> = {
    ...baseProcessEnv,
    TERM: "dumb",
    COLORTERM: "",
    FORCE_COLOR: "1",
  };
  // Iterate G (ADR-095), restored Iterate J (ADR-098) after the
  // Iterate I (ADR-097) opt-in attempt was empirically falsified.
  // Claude TUI flicker workaround: default ON — Claude Code 2.1.139
  // emits zero DECSET 2026 sequences in its main-buffer rendering, so
  // xterm 6.0's native Synchronized-Output honour cannot batch frames
  // the producer never wraps. Opt-OUT via SHIPWRIGHT_TERMINAL_NO_FLICKER=0.
  const optedOut = baseProcessEnv.SHIPWRIGHT_TERMINAL_NO_FLICKER === "0";
  if (optedOut) {
    // Explicit-off path: ensure the key is absent so the child shell
    // sees whatever (if anything) the upstream env set. We delete
    // rather than set to undefined because undefined keys can survive
    // some spread operations in TypeScript erasure paths.
    delete env.CLAUDE_CODE_NO_FLICKER;
  } else {
    env.CLAUDE_CODE_NO_FLICKER = "1";
  }
  // Caller-supplied env wins for ALL keys EXCEPT CLAUDE_CODE_NO_FLICKER
  // when the user has explicitly opted OUT via SHIPWRIGHT_TERMINAL_NO_FLICKER=0.
  // External code review (openai medium, 2026-05-13) — allowing the
  // caller to silently re-inject the key would break the documented
  // opt-out contract. The opt-out wins; the rest of the caller env
  // still flows through. Symmetric to ADR-097's opt-in-wins fence,
  // now restored to the ADR-095 default-on stance per ADR-098.
  if (callerEnv) {
    for (const [k, v] of Object.entries(callerEnv)) {
      if (optedOut && k === "CLAUDE_CODE_NO_FLICKER") continue;
      env[k] = v;
    }
  }
  return env;
}

export async function createNodePtySpawnFn(): Promise<PtySpawnFn> {
  // Lazy import keeps the native binary out of the module-load path for
  // unit tests that mock PtyManager.
  const { spawn: nodePtySpawn } = await import("@lydell/node-pty");
  return (shell, args, opts) => {
    const termEnv = buildSpawnEnv(
      process.env as Record<string, string | undefined>,
      opts.env,
    );
    const handle = nodePtySpawn(shell, args, {
      cwd: opts.cwd,
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      env: termEnv,
      // node-pty's own `name` is used by some Win32 conpty paths; we
      // keep it on "xterm" so the conpty layer stays sane while the
      // child-process env still sees TERM=dumb.
      name: opts.name ?? "xterm",
    });
    // The library's IPty matches our PtyHandleApi shape; cast is safe.
    return handle as unknown as PtyHandleApi;
  };
}

export type { ShellKind };
