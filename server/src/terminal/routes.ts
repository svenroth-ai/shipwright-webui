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
 */

import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import { pathGuard, realPathGuard } from "../core/path-guard.js";
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

function defaultAllowedOrigins(origin: string | null): boolean {
  // External code-review F4: refuse missing/null Origin. The browser
  // always sends an Origin header on WS upgrades from a real page; an
  // absent header indicates a non-browser caller (curl, scripted client),
  // which falls outside the loopback-CORS posture.
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
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

interface WSMessageData {
  type: "data";
  payload: string;
}
interface WSMessageResize {
  type: "resize";
  cols: number;
  rows: number;
}
type WSInbound = WSMessageData | WSMessageResize;

function isWSInbound(v: unknown): v is WSInbound {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type === "data" && typeof o.payload === "string") return true;
  if (o.type === "resize" && typeof o.cols === "number" && typeof o.rows === "number") {
    return true;
  }
  return false;
}

export function createTerminalRoutes(deps: TerminalRoutesDeps) {
  const { store, ptyManager, upgradeWebSocket } = deps;
  const allowedOrigins = deps.allowedOrigins ?? defaultAllowedOrigins;
  const resolveShell = deps.resolveShell ?? defaultResolveShell;
  const pastesKeepLast = deps.pastesKeepLast ?? 20;
  const scrollbackStore = deps.scrollbackStore;
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

    // Iterate v0.8.2 AC-7/8/9 — shared chunked-replay helper. Used by
    // both the live and replay-only branches so the envelope sequence
    // (replay_start → replay_chunk* → replay_separator → replay_end)
    // stays bit-for-bit identical.
    const sendReplayChunked = async (
      ws: { send(d: string): void; bufferedAmount?: number },
      replay: string,
    ): Promise<void> => {
      if (replay.length === 0) return;
      const utf8 = Buffer.from(replay, "utf8");
      const totalBytes = utf8.byteLength;
      try {
        ws.send(JSON.stringify({ type: "replay_start", totalBytes }));
      } catch { /* ignore */ }
      const HWM = 1_048_576;
      const CHUNK_SIZE = 65536;
      const decoder = new StringDecoder("utf8");
      const readBufferedAmount = (): number => {
        const maybe = (ws as unknown as { bufferedAmount?: number })
          .bufferedAmount;
        return typeof maybe === "number" ? maybe : 0;
      };
      for (let i = 0; i < utf8.byteLength; i += CHUNK_SIZE) {
        while (readBufferedAmount() > HWM) {
          await new Promise((r) => setTimeout(r, 10));
        }
        const chunkBuf = utf8.subarray(i, i + CHUNK_SIZE);
        const chunkStr = decoder.write(chunkBuf);
        if (chunkStr.length > 0) {
          try {
            ws.send(
              JSON.stringify({ type: "replay_chunk", payload: chunkStr }),
            );
          } catch { /* ignore */ }
        }
      }
      const tail = decoder.end();
      if (tail.length > 0) {
        try {
          ws.send(JSON.stringify({ type: "replay_chunk", payload: tail }));
        } catch { /* ignore */ }
      }
      const sep =
        "\r\n\x1b[2m\x1b[33m── Shipwright: scrollback restored from disk; live shell below ──\x1b[0m\r\n";
      try {
        ws.send(JSON.stringify({ type: "replay_separator", payload: sep }));
        ws.send(JSON.stringify({ type: "replay_end" }));
      } catch { /* ignore */ }
    };

    // --- GET /api/terminal/:taskId/ws — authoritative lifecycle entry ----
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

        // Iterate v0.8.2 AC-7: replay-only mode for terminal tasks that
        // have already finished. Skip pty spawn + attach entirely; the
        // WS only serves the historical scrollback and then closes.
        const isReplayOnly =
          task.state === "done" || task.state === "launch_failed";

        if (isReplayOnly) {
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
                      scrollbackBytes,
                      retentionDays,
                      scrollbackDir: scrollbackDirHint,
                    }),
                  );
                } catch { /* ignore */ }
                if (
                  scrollbackStore &&
                  !scrollbackStore.disabled &&
                  scrollbackBytes > 0
                ) {
                  try {
                    const replay = await scrollbackStore.read(taskId);
                    await sendReplayChunked(
                      ws as unknown as Parameters<typeof sendReplayChunked>[0],
                      replay,
                    );
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.warn(
                      `[terminal] replay-only replay failed for ${taskId}: ${(err as Error).message}`,
                    );
                  }
                }
                // Close cleanly — no live shell to keep open.
                try {
                  (ws as unknown as { close?: (code?: number) => void }).close?.(
                    1000,
                  );
                } catch { /* ignore */ }
              })();
            },
            // No onMessage / onClose / onError needed — there is no
            // pty to detach from. The runtime tolerates omitted handlers.
          };
        }

        // Ensure-or-create the pty against the realpath-validated cwd.
        const meta = ptyManager.spawn(taskId, {
          cwd: trustedCwd,
          shell: resolveShell(),
        });

        // Per-connection identity is the WSContext (re-used in attach/detach).
        // We build it inline to keep references stable across handlers.
        const connToken = { taskId, t: Date.now() } as const;

        return {
          onOpen(_evt, ws) {
            const { role } = ptyManager.attach(taskId, connToken);

            // ADR-068-A1 replay flow:
            //   1. Subscribe with a liveBuffer so we don't miss live output
            //      while reading scrollback from disk.
            //   2. Pause pty (avoids OOM on slow xterm-render under
            //      backgrounded-tab conditions — Decision #15).
            //   3. Send `ready` envelope.
            //   4. Read scrollback + chunked replay envelopes.
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

            ptyManager.subscribeForConnection(taskId, connToken, {
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

            // Async replay (IIFE so onOpen stays sync). On error, just
            // flush the liveBuffer + flip replayDone — the live shell
            // continues to work; only the historical replay was lost.
            void (async () => {
              if (!scrollbackStore || scrollbackStore.disabled) {
                flushLiveBuffer();
                replayDone = true;
                return;
              }
              try {
                // AC-3a (iterate-2026-05-05): per-conn pause stake so
                // multi-tab replay doesn't cross-trigger pty.resume.
                ptyManager.pauseForConn(taskId, connToken);
                const scrollbackBytes = await scrollbackStore.bytes(taskId);
                // AC-8/AC-9 follow-up envelope so the disclosure footer
                // updates once the bytes() probe resolves.
                try {
                  ws.send(
                    JSON.stringify({ type: "scrollback-meta", scrollbackBytes }),
                  );
                } catch { /* ignore */ }
                if (scrollbackBytes > 0) {
                  const replay = await scrollbackStore.read(taskId);
                  await sendReplayChunked(
                    ws as unknown as Parameters<typeof sendReplayChunked>[0],
                    replay,
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
                // AC-3a — release this conn's pause stake. detach()
                // also calls resumeForConn defensively in case onClose
                // races us, so this resume is idempotent.
                ptyManager.resumeForConn(taskId, connToken);
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
            if (!isWSInbound(parsed)) return;
            // External code-review F6: use the non-mutating getRole()
            // here so re-evaluating the writer gate on every inbound
            // message can NOT silently flip the original writer to
            // reader. attach() is idempotent for same-conn since the
            // F6 fix, but getRole() is the cheaper + safer entrypoint.
            const actualRole = ptyManager.getRole(taskId, connToken);
            if (actualRole !== "writer") {
              try {
                ws.send(JSON.stringify({ type: "read_only" }));
              } catch { /* ignore */ }
              return;
            }
            if (parsed.type === "data") {
              ptyManager.write(taskId, parsed.payload);
            } else {
              ptyManager.resize(taskId, parsed.cols, parsed.rows);
            }
          },
          onClose() {
            ptyManager.detach(taskId, connToken);
          },
          onError() {
            ptyManager.detach(taskId, connToken);
          },
        };
      }),
    );

    return app;
  };
}

// ---------------------------------------------------------------------------
// PtySpawnFn factory — wraps @lydell/node-pty so PtyManager stays
// dependency-injection-friendly + native-binary-free in tests.
// ---------------------------------------------------------------------------

export async function createNodePtySpawnFn(): Promise<PtySpawnFn> {
  // Lazy import keeps the native binary out of the module-load path for
  // unit tests that mock PtyManager.
  const { spawn: nodePtySpawn } = await import("@lydell/node-pty");
  return (shell, args, opts) => {
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
    const termEnv: Record<string, string | undefined> = {
      ...(process.env as Record<string, string>),
      TERM: "dumb",
      COLORTERM: "",
      FORCE_COLOR: "1",
      ...(opts.env ?? {}),
    };
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
