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
 *   - PTY autoclosed when last connection detaches (no orphan tab leak).
 *
 * Auth posture: same loopback-only CORS gate as the rest of the HTTP
 * surface. A future remote-access mode would need additional auth (see
 * ADR-067).
 */

import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import os from "node:os";
import path from "node:path";

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
 * the first executable we can resolve via the PATH (or `where` on Windows).
 * `node:child_process.spawnSync('where', [...])` is the cheapest probe.
 * Cached per-process — shells don't disappear during a server lifetime.
 */
let cachedWinShell: string | null = null;
function resolveWindowsShell(): string {
  if (cachedWinShell !== null) return cachedWinShell;
  // require() is fine here — node:child_process is a built-in.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
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

  return (app: Hono): Hono => {
    // --- POST /api/terminal/:taskId/spawn — idempotent prewarm ------------
    app.post("/api/terminal/:taskId/spawn", async (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      const task = store.get(taskId);
      if (!task) return c.json({ error: "task_not_found" }, 404);

      try {
        const meta = ptyManager.spawn(taskId, {
          cwd: task.cwd,
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
    app.post("/api/terminal/:taskId/close", (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      ptyManager.kill(taskId);
      return c.body(null, 204);
    });

    // --- POST /api/terminal/:taskId/paste-image ---------------------------
    // Multipart/form-data with field "image: File". Saves to
    // <task.cwd>/.claude-pastes/img-<ts>-<rand>.<ext>, prunes to keep-last-N,
    // and pty.write()s the shell-quoted absolute path into the buffer
    // (followed by a trailing space). 413 fast-fail on large Content-Length.
    app.post("/api/terminal/:taskId/paste-image", async (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      const task = store.get(taskId);
      if (!task) return c.json({ error: "task_not_found" }, 404);

      // Content-Length precheck — refuse before buffering. 9 MiB ceiling
      // gives 1 MiB of headroom over the 8 MiB blob cap (multipart envelope
      // overhead).
      const contentLength = parseInt(c.req.header("content-length") ?? "0", 10);
      if (contentLength > 9 * 1024 * 1024) {
        return c.json({ error: "image_too_large" }, 413);
      }

      let body: Awaited<ReturnType<typeof c.req.parseBody>>;
      try {
        body = await c.req.parseBody();
      } catch (err) {
        return c.json({ error: "invalid_multipart", detail: String((err as Error).message) }, 400);
      }
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

      // External code-review F3: refuse paste-image if there's no live
      // writer bound to this task's pty. The writer-slot is filled when
      // a WS connection has attached as writer; a second tab that's a
      // reader cannot drive the pty via this REST surface either. If
      // no pty exists at all, savePastedImage still persists the file
      // but we skip the pty.write step.
      try {
        const result = await savePastedImage({
          cwd: task.cwd,
          bytes,
          keepLast: pastesKeepLast,
        });
        const meta = ptyManager.get(taskId);
        if (meta && ptyManager.hasActiveWriter(taskId)) {
          const quoted = quotePathForShell(result.absolutePath, meta.shellKind);
          ptyManager.write(taskId, quoted + " ");
        }
        return c.json({
          path: result.absolutePath,
          kind: result.kind,
          gitignoreSuggestion: result.gitignoreSuggestion,
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
    // Idempotent append of `.claude-pastes/` to <task.cwd>/.gitignore.
    // realpath-guarded so a symlinked .gitignore can't redirect the write
    // outside cwd (external review F11).
    app.post("/api/terminal/:taskId/append-gitignore", async (c) => {
      const taskId = c.req.param("taskId");
      if (!taskId) return c.json({ error: "missing_task_id" }, 400);
      const task = store.get(taskId);
      if (!task) return c.json({ error: "task_not_found" }, 404);

      const guard = pathGuard(task.cwd, ".gitignore");
      if (!guard.ok) {
        return c.json({ error: "path_guard_traversal", detail: guard.reason }, 403);
      }
      // External code-review F2: existence FIRST, then realPathGuard.
      // realPathGuard internally calls realpathSync, which throws on
      // ENOENT — without this ordering, a missing .gitignore returns
      // 403 gitignore_symlink_escape (wrong) instead of 404
      // gitignore_missing (the spec'd behavior).
      const { stat } = await import("node:fs/promises");
      try {
        await stat(guard.absolute);
      } catch {
        return c.json({ error: "gitignore_missing" }, 404);
      }
      const real = realPathGuard(task.cwd, guard.absolute);
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

        // Ensure-or-create the pty.
        const meta = ptyManager.spawn(taskId, {
          cwd: task.cwd,
          shell: resolveShell(),
        });

        // Per-connection identity is the WSContext (re-used in attach/detach).
        // We build it inline to keep references stable across handlers.
        const connToken = { taskId, t: Date.now() } as const;

        return {
          onOpen(_evt, ws) {
            const { role } = ptyManager.attach(taskId, connToken);
            ptyManager.subscribeForConnection(taskId, connToken, {
              onData: (data) => {
                try {
                  ws.send(JSON.stringify({ type: "data", payload: data }));
                } catch { /* socket may be mid-close */ }
              },
              onBackpressure: ({ droppedBytes }) => {
                try {
                  ws.send(
                    JSON.stringify({ type: "backpressure", droppedBytes }),
                  );
                } catch { /* ignore */ }
              },
            });
            try {
              ws.send(
                JSON.stringify({
                  type: "ready",
                  role,
                  shellKind: meta.shellKind,
                  cwd: meta.cwd,
                }),
              );
              // External code-review F8: also emit an explicit
              // `second-attach` envelope so reader-role consumers can
              // surface a UX banner before the first input attempt.
              if (role === "reader") {
                ws.send(JSON.stringify({ type: "second-attach" }));
              }
            } catch { /* ignore */ }
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
    const handle = nodePtySpawn(shell, args, {
      cwd: opts.cwd,
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      env: { ...(process.env as Record<string, string>), ...(opts.env ?? {}) },
      name: opts.name ?? "xterm-256color",
    });
    // The library's IPty matches our PtyHandleApi shape; cast is safe.
    return handle as unknown as PtyHandleApi;
  };
}

export type { ShellKind };
