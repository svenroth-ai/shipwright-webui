/*
 * ws-heartbeat-reap-integration.test.ts — END-TO-END proof that the WS
 * liveness heartbeat reaps a DEAD writer against REAL sockets and the
 * existing detach -> reader-promotion chain clears read-only by promoting
 * the surviving tab (iterate-2026-05-31-terminal-readonly-keepalive).
 *
 * WHY a real server + real `ws` clients (not the faked WSContext used by
 * ws-upgrade-handler.*.test.ts): the unit tests drive a FAKE socket, so
 * they cannot prove the load-bearing facts —
 *   (1) `ws.raw` on the REAL @hono/node-ws WSContext is actually pingable,
 *       i.e. `startWsHeartbeat(ws)` ARMS in production rather than silently
 *       no-op'ing via its capability guard (which would leave every unit
 *       test green while the fix does nothing), and
 *   (2) a non-ponging writer is genuinely `terminate()`d and the reader is
 *       promoted to writer ("writer-promoted") — the actual outcome that
 *       clears the false "Read-only — another tab is the active writer"
 *       banner.
 *
 * A half-open / dead peer is simulated deterministically by pausing the
 * writer client's underlying TCP socket: the TCP stays ESTABLISHED (no
 * close), but the paused client never reads the server's WS ping frames
 * and therefore never auto-pongs — exactly the OS-sleep / Tailscale
 * half-open failure mode. The server's heartbeat then reaps it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import WebSocketClient from "ws";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

import {
  PtyManager,
  type PtySpawnFn,
  type PtyHandleApi,
} from "./pty-manager.js";
import { createTerminalRoutes } from "./routes.js";
import type { SdkSessionsStore, ExternalTask } from "../core/sdk-sessions-store.js";

// --- fake pty so no real shell is spawned (heartbeat is socket-level) ------

function createFakePty(): PtyHandleApi {
  return {
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    write: () => {},
    resize: () => {},
    kill: () => {},
  };
}
const fakeSpawn: PtySpawnFn = () => createFakePty();

const TASK_ID = "11111111-2222-3333-4444-555555555555";

function makeStore(cwd: string): SdkSessionsStore {
  const task: ExternalTask = {
    taskId: TASK_ID,
    sessionUuid: "00000000-0000-0000-0000-000000000001",
    cwd,
    pluginDirs: [],
    state: "active",
    title: "reap-int",
    projectId: "unassigned",
    createdAt: "2026-05-31T00:00:00.000Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    firstJsonlObservedAt: "2026-05-31T00:00:00.000Z",
  };
  return {
    get: (id: string) => (id === TASK_ID ? task : undefined),
    patch: () => {},
    persist: async () => {},
  } as unknown as SdkSessionsStore;
}

interface Conn {
  ws: WebSocketClient;
  role: string;
}

function connect(url: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketClient(url, { origin: "http://127.0.0.1" });
    const timer = setTimeout(() => reject(new Error("connect timeout (no ready)")), 8000);
    ws.on("message", (raw: WebSocketClient.RawData) => {
      let env: { type?: string; role?: string };
      try {
        env = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (env.type === "ready" && typeof env.role === "string") {
        clearTimeout(timer);
        resolve({ ws, role: env.role });
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe("ws-heartbeat reap+promote (real server, real ws sockets)", () => {
  let server: ReturnType<typeof serve> | null = null;
  let pm: PtyManager | null = null;
  let cwd = "";
  const conns: WebSocketClient[] = [];

  afterEach(async () => {
    for (const c of conns) {
      try {
        const sock = (c as unknown as { _socket?: { resume?: () => void } })._socket;
        sock?.resume?.();
        c.terminate();
      } catch {
        /* ignore */
      }
    }
    conns.length = 0;
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
      server = null;
    }
    pm?.killAll();
    pm = null;
    delete process.env.SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS;
    if (cwd) {
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      cwd = "";
    }
  });

  it(
    "reaps a non-ponging writer and promotes the reader to writer",
    async () => {
      // Floor is 1000ms; with the default 2-miss tolerance a paused writer
      // is reaped within ~3 ticks (~3s).
      process.env.SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS = "1000";
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hb-int-"));

      pm = new PtyManager({ spawn: fakeSpawn, watchdogEnabled: false });
      const app = new Hono();
      const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
      createTerminalRoutes({
        store: makeStore(cwd),
        ptyManager: pm,
        upgradeWebSocket,
        allowedOrigins: () => true,
        resolveShell: () => "bash",
      })(app);

      const port: number = await new Promise((resolve) => {
        server = serve(
          { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
          (info: { port: number }) => resolve(info.port),
        );
      });
      injectWebSocket(server!);

      const url = `ws://127.0.0.1:${port}/api/terminal/${TASK_ID}/ws`;

      const a = await connect(url);
      conns.push(a.ws);
      expect(a.role, "first attach is writer").toBe("writer");

      const b = await connect(url);
      conns.push(b.ws);
      expect(b.role, "second attach is reader").toBe("reader");

      // Arm the promotion listener BEFORE killing the writer.
      const promoted = new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 9000);
        b.ws.on("message", (raw: WebSocketClient.RawData) => {
          let env: { type?: string };
          try {
            env = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (env.type === "writer-promoted") {
            clearTimeout(t);
            resolve(true);
          }
        });
      });

      // Make the writer a dead/half-open peer: pause its TCP socket so it
      // stops reading -> never auto-pongs -> server's heartbeat reaps it.
      // The TCP connection itself stays OPEN (no close frame).
      const aSock = (a.ws as unknown as { _socket: { pause(): void } })._socket;
      aSock.pause();

      const wasPromoted = await promoted;
      expect(
        wasPromoted,
        "reader must be promoted to writer after the dead writer is reaped " +
          "(proves startWsHeartbeat armed against the real ws.raw and the " +
          "terminate -> detach -> promotion chain fired)",
      ).toBe(true);
    },
    20000,
  );
});
