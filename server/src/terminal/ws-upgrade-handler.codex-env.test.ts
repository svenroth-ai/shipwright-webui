/*
 * ws-upgrade-handler.codex-env.test.ts — Codex Light §2.4 session-identity
 * plumbing. `pty-manager.spawn()` must receive `env.SHIPWRIGHT_SESSION_ID`
 * for a Codex-runtime task so its shell tool's `record_event.py` calls can
 * be filtered back to this run; a Claude-runtime task must NOT get it (its
 * own `CLAUDE_ENV_FILE` mechanism overwrites it anyway — see §2.4).
 */
import { describe, expect, it } from "vitest";

import { buildWsHandlers } from "./ws-upgrade-handler.js";
import { makeCtx, makeTask } from "./ws-upgrade-handler.fixtures.js";

describe("buildWsHandlers — live attach — §2.4 SHIPWRIGHT_SESSION_ID env", () => {
  it("codex runtime: spawn() env carries SHIPWRIGHT_SESSION_ID = task.sessionUuid", () => {
    const task = makeTask({ runtime: "codex", sessionUuid: "thread-sess-1" });
    const ctx = makeCtx({ task });
    buildWsHandlers(ctx);
    const spawnMock = (ctx.ptyManager as unknown as {
      __mocks: { spawn: { mock: { calls: unknown[][] } } };
    }).__mocks.spawn;
    expect(spawnMock.mock.calls[0][1]).toMatchObject({
      env: { SHIPWRIGHT_SESSION_ID: "thread-sess-1" },
    });
  });

  it("claude runtime: spawn() env is undefined", () => {
    const task = makeTask({ runtime: "claude" });
    const ctx = makeCtx({ task });
    buildWsHandlers(ctx);
    const spawnMock = (ctx.ptyManager as unknown as {
      __mocks: { spawn: { mock: { calls: unknown[][] } } };
    }).__mocks.spawn;
    expect(spawnMock.mock.calls[0][1]).toMatchObject({ env: undefined });
  });
});
