/*
 * ws-upgrade-handler.ts — embedded-terminal WebSocket upgrade body.
 *
 * Extracted from `terminal/routes.ts` in iterate-2026-05-27-ws-upgrade-
 * handler-split (ADR-103 retirement candidate #1). Owns the post-upgrade
 * lifecycle for the WS attach contract:
 *
 *   - replay-only branch for done/launch_failed tasks
 *   - live branch with:
 *       * atomic ptyManager.attach() returning {role, hadPriorWriter}
 *       * new-plain `awaiting_external_start → active` flip (AC-4)
 *       * subscribeForConnection (onData, onBackpressure, onPromoteToWriter)
 *       * sync `ready` envelope (auto-launch handshake timing — Spec 76)
 *       * async replay IIFE: pauseForConn → live-mirror-first / disk-fallback
 *         resolveReplaySnapshot → flushLiveBuffer → resumeForConn
 *   - per-message writer-role gating via getRole (non-mutating)
 *   - snapshot-on-detach via atomic detachAndCount (ADR-092)
 *
 * --- PROTECTED DEEP MODULE (see ADR-103 §Retirement Plan) -----------------
 *
 * ADR-103's deep-module argument names this file as the cohesive unit
 * worth protecting: three shared locks (writer-slot, pause-refcount,
 * attach-count), one onData broadcast, one backpressure budget. The
 * argument applies to the WS body AS A WHOLE — splitting it further
 * across more files is the exact failure mode ADR-101 calls out
 * ("moving complexity outward"). Do NOT add unrelated terminal helpers
 * (HTTP-only logic, spawn-env factory, image-paste utilities, …) to
 * this module. If a helper genuinely belongs to the WS body alone,
 * keep it private here; otherwise route it through `routes.ts` or a
 * dedicated neutral module like `terminal-reset.ts`.
 */

import type { WSEvents } from "hono/ws";

import type { ExternalTask, SdkSessionsStore } from "../core/sdk-sessions-store.js";
import type {
  PtyHandleMeta,
  PtyManager,
} from "./pty-manager.js";
import type { ScrollbackStore } from "./scrollback-store.js";
import type { SnapshotRecord, SnapshotStore } from "./snapshot-store.js";
import {
  buildReplaySnapshotEnvelope,
  tryReadSnapshot as tryReadSnapshotShared,
} from "./replay-snapshot.js";
import { deriveTerminalReset } from "./terminal-reset.js";
import { startWsHeartbeat } from "./ws-heartbeat.js";

// ---------------------------------------------------------------------------
// Inbound message contract
// ---------------------------------------------------------------------------

interface WSMessageData {
  type: "data";
  payload: string;
}
interface WSMessageResize {
  type: "resize";
  cols: number;
  rows: number;
}
export type WSInbound = WSMessageData | WSMessageResize;

export function isWSInbound(v: unknown): v is WSInbound {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type === "data" && typeof o.payload === "string") return true;
  if (o.type === "resize" && typeof o.cols === "number" && typeof o.rows === "number") {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validated context (strict precondition: validation already happened
// in routes.ts BEFORE this object is constructed).
// ---------------------------------------------------------------------------

/**
 * `ValidatedWsUpgradeContext` encodes the strict precondition that
 * **all reject-the-upgrade validations have already passed** at the
 * route boundary before this context is constructed:
 *   - `taskId` is non-empty,
 *   - Origin header is on the trusted list,
 *   - `task` was found in the SdkSessionsStore,
 *   - `trustedCwd` is the realpath-resolved absolute cwd
 *     (`resolveTrustedCwd` returned non-null).
 *
 * External plan review HIGH #1 (openrouter/openai, 2026-05-27): anything
 * that throws AFTER the WS upgrade succeeds becomes a silent WS
 * disconnect instead of an HTTP rejection. Therefore validation MUST
 * stay synchronous in `routes.ts` and produce this Validated… type as
 * its output. Treat the fields as read-only inside this module; do
 * NOT re-validate (the route already did) and do NOT widen the type
 * by accepting nullable cwd / task.
 */
export interface ValidatedWsUpgradeContext {
  readonly taskId: string;
  readonly task: ExternalTask;
  readonly trustedCwd: string;
  readonly ptyManager: PtyManager;
  readonly store: SdkSessionsStore;
  readonly scrollbackStore?: ScrollbackStore;
  readonly snapshotStore?: SnapshotStore;
  readonly expectedTerminalVersion?: string;
  readonly retentionDays: number;
  readonly scrollbackDirHint: string;
  /**
   * Resolver for the spawned-shell path. Identical to
   * `TerminalRoutesDeps.resolveShell` — the live branch passes its
   * value into `ptyManager.spawn()` for the ensure-or-create call.
   */
  readonly resolveShell: () => string;
}

// ---------------------------------------------------------------------------
// Private helpers (formerly factory-closure helpers inside routes.ts).
// Moved here as one cohesive unit per external plan review HIGH #2 so
// import order + initialization stay coupled to the WS body.
// ---------------------------------------------------------------------------

const tryReadSnapshot = (
  snapshotStore: SnapshotStore | undefined,
  taskId: string,
  expectedTerminalVersion: string | undefined,
): Promise<SnapshotRecord | null> =>
  tryReadSnapshotShared(snapshotStore, taskId, expectedTerminalVersion);

// ADR-092 — replay-snapshot resolution. LIVE mirror wins over disk
// (closes the ADR-091 bug + avoids serving stale disk image when
// last-detach flushed and the shell produced more output after).
const resolveReplaySnapshot = async (
  ctx: ValidatedWsUpgradeContext,
): Promise<SnapshotRecord | null> => {
  const live = await ctx.ptyManager.serializeMirrorIfLive(ctx.taskId);
  if (live) return live;
  return tryReadSnapshot(
    ctx.snapshotStore,
    ctx.taskId,
    ctx.expectedTerminalVersion,
  );
};

// ADR-089 — single-envelope replay emit. Backpressure stays trivial
// because the entire snapshot is one WS frame.
const sendReplaySnapshot = (
  ws: { send(d: string): void },
  rec: SnapshotRecord,
): boolean => {
  try {
    ws.send(JSON.stringify(buildReplaySnapshotEnvelope(rec)));
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// buildWsHandlers — entry point for the WS body.
// ---------------------------------------------------------------------------

/**
 * Build the Hono WS handler object (`onOpen`, `onMessage`, `onClose`,
 * `onError`) for the embedded-terminal WS upgrade.
 *
 * Precondition: `ctx` is a `ValidatedWsUpgradeContext` — all
 * reject-the-upgrade validations passed in `routes.ts`. Failures
 * raised inside the returned handlers degrade to WS disconnects, NOT
 * HTTP upgrade rejections (see type doc).
 *
 * Dispatches between two branches:
 *   - **replay-only** (`task.state === "done" || task.state === "launch_failed"`):
 *     no pty is spawned. The WS sends a `ready` envelope, emits the
 *     stored cell-state snapshot if available, then closes cleanly.
 *   - **live** (anything else): the WS owns a live shell. The full
 *     ADR-068-A1 / ADR-087 / ADR-092 lifecycle applies.
 */
export function buildWsHandlers(
  ctx: ValidatedWsUpgradeContext,
): WSEvents<WebSocket> {
  const isReplayOnly =
    ctx.task.state === "done" || ctx.task.state === "launch_failed";

  if (isReplayOnly) {
    return buildReplayOnlyHandlers(ctx);
  }
  return buildLiveHandlers(ctx);
}

// ---------------------------------------------------------------------------
// Replay-only branch (done / launch_failed tasks).
// ---------------------------------------------------------------------------

function buildReplayOnlyHandlers(
  ctx: ValidatedWsUpgradeContext,
): WSEvents<WebSocket> {
  const { taskId, trustedCwd, scrollbackStore, retentionDays, scrollbackDirHint } = ctx;
  return {
    onOpen(_evt, ws) {
      void (async () => {
        let scrollbackBytes = 0;
        if (scrollbackStore && !scrollbackStore.disabled) {
          try {
            scrollbackBytes = await scrollbackStore.bytes(taskId);
          } catch { /* fall through with 0 */ }
        }
        try {
          ws.send(
            JSON.stringify({
              type: "ready",
              role: "reader",
              shellKind: null,
              cwd: trustedCwd,
              replayOnly: true,
              // ADR-104 — replay-only tasks (done / launch_failed)
              // never carry a reset banner: no pty is spawned and
              // Resume is not applicable in a terminal state.
              terminalReset: false,
              // fix-resume-guard-survives-reload — replay-only
              // tasks spawn no pty; there is nothing to reuse.
              ptyReused: false,
              scrollbackBytes,
              retentionDays,
              scrollbackDir: scrollbackDirHint,
            }),
          );
        } catch { /* ignore */ }
        // Iterate C (ADR-087) — snapshot is the sole replay path.
        // When `tryReadSnapshot` returns null (missing snapshot,
        // version mismatch, or headlessMirrorEnabled=false), the
        // client receives no replay history — by design, per the
        // plan-of-record trade-off. The legacy chunked-replay
        // emission has been retired.
        const snap = await tryReadSnapshot(
          ctx.snapshotStore,
          taskId,
          ctx.expectedTerminalVersion,
        );
        if (snap) {
          sendReplaySnapshot(
            ws as unknown as Parameters<typeof sendReplaySnapshot>[0],
            snap,
          );
        }
        // Close cleanly — no live shell to keep open.
        try {
          (ws as unknown as { close?: (code?: number) => void }).close?.(1000);
        } catch { /* ignore */ }
      })();
    },
    // No onMessage / onClose / onError needed — there is no
    // pty to detach from. The runtime tolerates omitted handlers.
  };
}

// ---------------------------------------------------------------------------
// Live branch (pty-backed tasks).
// ---------------------------------------------------------------------------

function buildLiveHandlers(
  ctx: ValidatedWsUpgradeContext,
): WSEvents<WebSocket> {
  const { taskId, task, trustedCwd, store, scrollbackStore, retentionDays, scrollbackDirHint } = ctx;

  // ADR-104 — capture pty-existence on the synchronous line
  // IMMEDIATELY before spawn(). Race-free: there is no `await`
  // between this probe and spawn(), and Node is single-threaded,
  // so no concurrent WS attach can create the pty in between.
  const ptyExistedBeforeAttach = ctx.ptyManager.get(taskId) !== undefined;
  // Ensure-or-create the pty against the realpath-validated cwd.
  const meta: PtyHandleMeta = ctx.ptyManager.spawn(taskId, {
    cwd: trustedCwd,
    shell: ctx.resolveShell(),
  });
  // ADR-104 — true when this attach freshly re-created the pty
  // after a prior Claude session was lost (server restart / crash).
  const terminalReset = deriveTerminalReset(
    ptyExistedBeforeAttach,
    task.firstJsonlObservedAt,
  );

  // Per-connection identity is the WSContext (re-used in attach/detach).
  // We build it inline to keep references stable across handlers.
  const connToken = { taskId, t: Date.now() } as const;

  return {
    onOpen(_evt, ws) {
      startWsHeartbeat(ws); // reap a dead socket → free a pinned writer slot (read-only false-blocker, iterate-2026-05-31)
      // `hadPriorWriter` = atomic snapshot in attach() (iterate
      // 2026-05-27-fix-pty-reused-prewarm-race); feeds ready.ptyReused
      // so the guard arms only on real reload/multi-tab, not prewarm.
      // `ptyExistedBeforeAttach` still drives ADR-104 terminalReset.
      const { role, hadPriorWriter } = ctx.ptyManager.attach(taskId, connToken);

      // Iterate v0.8.5 AC-4 — new-plain (`/api/external/launch`
      // with actionId === "new-plain") tasks never write a JSONL
      // until the user types their first message inside Claude
      // (per known_issues.md "Awaiting-launch state — expected
      // latency band"). The transcript-poll-driven state machine
      // can therefore never flip these tasks out of
      // `awaiting_external_start`, even though Claude is plainly
      // reachable in the embedded terminal — confusing UX.
      //
      // Pty-up is the operator's mental model of "active" for
      // new-plain. When the WS upgrade succeeds and the task is
      // in `awaiting_external_start` AND was launched as
      // new-plain, flip it to `active` immediately. The
      // transcript-poll path remains authoritative for all other
      // actionIds (slash-command launches; resume; fork) — they
      // write JSONL at first prompt and the existing
      // !firstJsonlObservedAt branch handles them.
      if (
        task.state === "awaiting_external_start" &&
        task.actionId === "new-plain"
      ) {
        store.patch(taskId, { state: "active" });
        // Don't set firstJsonlObservedAt — pty-up is not the
        // same evidence as JSONL-on-disk; the existing
        // transcript-poll transition will set the timestamp
        // correctly when the user actually types something.
        void store.persist();
      }

      // ADR-068-A1 replay flow (post-ADR-087 / Iterate C):
      //   1. Subscribe with a liveBuffer so we don't miss live output
      //      while the snapshot read + send happens.
      //   2. Pause pty (avoids OOM on slow xterm-render under
      //      backgrounded-tab conditions — Decision #15).
      //   3. Send `ready` envelope.
      //   4. Emit a single `replay_snapshot` envelope when a usable
      //      snapshot exists; otherwise emit no replay history
      //      (blank terminal with live shell — the chunked
      //      replay_start/chunk/separator/end fallback was retired).
      //   5. Flush liveBuffer + flip replayDone.
      //   6. Resume pty.
      const liveBuffer: string[] = [];
      let replayDone = false;

      const flushLiveBuffer = () => {
        for (const data of liveBuffer) {
          try {
            ws.send(JSON.stringify({ type: "data", payload: data }));
          } catch { /* socket may be mid-close */ }
        }
        liveBuffer.length = 0;
      };

      ctx.ptyManager.subscribeForConnection(taskId, connToken, {
        onData: (data) => {
          if (replayDone) {
            try {
              ws.send(JSON.stringify({ type: "data", payload: data }));
            } catch { /* socket may be mid-close */ }
          } else {
            liveBuffer.push(data);
          }
        },
        onBackpressure: ({ droppedBytes }) => {
          try {
            ws.send(
              JSON.stringify({ type: "backpressure", droppedBytes }),
            );
          } catch { /* ignore */ }
        },
        // Fired when the previous writer detaches and we get
        // promoted (closes the StrictMode double-mount race).
        onPromoteToWriter: () => {
          try {
            ws.send(JSON.stringify({ type: "writer-promoted" }));
          } catch { /* ignore */ }
        },
      });

      // Iterate v0.8.2 AC-8/AC-9: ready envelope stays SYNC to
      // preserve the auto-launch handshake timing (Spec 76
      // regressed when ready was moved into the async IIFE).
      // scrollbackBytes is initialised to 0 here; the precise
      // value is computed inside the IIFE and emitted via a
      // follow-up `scrollback-meta` envelope so the disclosure
      // footer can update once the bytes() probe resolves.
      try {
        ws.send(
          JSON.stringify({
            type: "ready",
            role,
            shellKind: meta.shellKind,
            cwd: meta.cwd,
            replayOnly: false,
            // ADR-104 — drives the EmbeddedTerminal reset banner.
            terminalReset,
            // `true` iff a writer attached BEFORE this WS upgrade
            // (iterate-2026-05-27-fix-pty-reused-prewarm-race —
            // refined from `ptyExistedBeforeAttach`; prewarm-only
            // ptys now correctly emit `false`).
            ptyReused: hadPriorWriter,
            scrollbackBytes: 0,
            retentionDays,
            scrollbackDir: scrollbackDirHint,
          }),
        );
        // External code-review F8: also emit an explicit
        // `second-attach` envelope so reader-role consumers can
        // surface a UX banner before the first input attempt.
        if (role === "reader") {
          ws.send(JSON.stringify({ type: "second-attach" }));
        }
      } catch { /* ignore */ }

      // Iterate C (ADR-087) — snapshot is the sole replay path.
      // ADR-086's "skip replay for new-plain" branch is gone:
      // cell-state snapshots have no byte-stream corruption, and
      // there is no chunked path to skip. ADR-068-A1's per-conn
      // pause stake (pauseForConn / resumeForConn) is preserved
      // so multi-tab attach still serializes the replay write
      // cleanly with live pty output.
      void (async () => {
        try {
          ctx.ptyManager.pauseForConn(taskId, connToken);
          let scrollbackBytes = 0;
          if (scrollbackStore && !scrollbackStore.disabled) {
            try {
              scrollbackBytes = await scrollbackStore.bytes(taskId);
            } catch { /* fall through with 0 */ }
          }
          // Privacy disclosure footer still receives the byte
          // count — even though no chunked replay is emitted,
          // the on-disk file may exist and the user has a
          // "Clear history" button surfaced from this number.
          try {
            ws.send(
              JSON.stringify({
                type: "scrollback-meta",
                scrollbackBytes,
              }),
            );
          } catch { /* ignore */ }
          // ADR-092 (Iterate E) — live mirror FIRST, disk snapshot
          // FALLBACK. Closes the ADR-091 bug where re-attach to a
          // live pty (no prior kill → no disk snapshot) yielded a
          // blank terminal, AND avoids serving a stale disk
          // snapshot when last-detach flushed but the shell
          // produced more output after. Disk is the fallback for
          // done/exited tasks and post-server-restart scenarios.
          const snap = await resolveReplaySnapshot(ctx);
          if (snap) {
            sendReplaySnapshot(
              ws as unknown as Parameters<typeof sendReplaySnapshot>[0],
              snap,
            );
          }
          flushLiveBuffer();
          replayDone = true;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[terminal] replay failed for ${taskId}: ${(err as Error).message}`,
          );
          flushLiveBuffer();
          replayDone = true;
        } finally {
          ctx.ptyManager.resumeForConn(taskId, connToken);
        }
      })();
    },
    onMessage(evt, ws) {
      const raw = typeof evt.data === "string" ? evt.data : "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      // App-level liveness ping (iterate-2026-06-18). Answered BEFORE the
      // role gate so READERS stay alive too. The client uses the pong to
      // detect a silently half/full-open socket (OS sleep / Tailscale
      // partition) that never fires a `close` event, then reconnects.
      // Distinct from the server's own protocol-level ping/pong heartbeat
      // (ws-heartbeat.ts) — that frees the server slot; this wakes the client.
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "ping"
      ) {
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch {
          /* ignore */
        }
        return;
      }
      if (!isWSInbound(parsed)) return;
      // External code-review F6: use the non-mutating getRole()
      // here so re-evaluating the writer gate on every inbound
      // message can NOT silently flip the original writer to
      // reader. attach() is idempotent for same-conn since the
      // F6 fix, but getRole() is the cheaper + safer entrypoint.
      const actualRole = ctx.ptyManager.getRole(taskId, connToken);
      if (actualRole !== "writer") {
        try {
          ws.send(JSON.stringify({ type: "read_only" }));
        } catch { /* ignore */ }
        return;
      }
      if (parsed.type === "data") {
        ctx.ptyManager.write(taskId, parsed.payload);
      } else {
        ctx.ptyManager.resize(taskId, parsed.cols, parsed.rows);
      }
    },
    onClose() {
      // ADR-092 (Iterate E) — snapshot-on-detach resilience.
      // `detachAndCount` performs the detach + post-state read
      // as a single atomic observation (external code review
      // OpenAI HIGH #1 — split-step "check count → detach →
      // check count" was vulnerable to a concurrent attach
      // landing between the two reads). Only when the
      // post-detach count is 0 do we flush the mirror to disk
      // so a future re-attach (or server restart) finds a
      // usable snapshot via `tryReadSnapshot`. The pty stays
      // alive; only persistence fires here. Fire-and-forget
      // — never block the WS close handshake.
      const { remainingAttachCount } = ctx.ptyManager.detachAndCount(
        taskId,
        connToken,
      );
      if (remainingAttachCount === 0) {
        // flushMirrorSnapshot wraps its async body in try/catch
        // internally — no rejection escapes (per Gemini LOW #3
        // / OpenAI MED #4: ensures no unhandled rejection noise
        // from this fire-and-forget call). SnapshotStore.write
        // is per-task PQueue-serialized (snapshot-store.ts —
        // Iterate B MEDIUM-1) so overlapping calls cannot
        // corrupt the file.
        void ctx.ptyManager.flushMirrorSnapshot(taskId);
      }
    },
    onError() {
      const { remainingAttachCount } = ctx.ptyManager.detachAndCount(
        taskId,
        connToken,
      );
      if (remainingAttachCount === 0) {
        void ctx.ptyManager.flushMirrorSnapshot(taskId);
      }
    },
  };
}
