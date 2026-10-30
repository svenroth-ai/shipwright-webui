import { afterEach, describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";

import { createSessionInfoRouter } from "./routes.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { readSessionInfo } from "../../core/session-info/session-info.js";
import { SESSION, assistant, jl, makeLayout, type Layout } from "../../core/session-info/test-fixtures.js";

let l: Layout;
afterEach(() => l && rmSync(l.projectsDir, { recursive: true, force: true }));

const store = (uuid: string | null) => ({ get: (id: string) => (id === "t1" && uuid ? { taskId: "t1", sessionUuid: uuid } : undefined) }) as never;

describe("GET /api/external/tasks/:id/session-info", () => {
  it("404 for an unknown task", async () => {
    l = makeLayout();
    const app = createSessionInfoRouter({ store: store(SESSION), watcher: new SessionWatcher({ projectsDir: l.projectsDir }) });
    expect((await app.request("/api/external/tasks/nope/session-info")).status).toBe(404);
  });

  it("missing when no JSONL exists yet", async () => {
    l = makeLayout();
    const app = createSessionInfoRouter({ store: store(SESSION), watcher: new SessionWatcher({ projectsDir: l.projectsDir }) });
    const res = await app.request("/api/external/tasks/t1/session-info");
    expect(await res.json()).toEqual({ status: "missing" });
  });

  it("ok with the derived info; never modifies the transcript", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { usage: [1, 2, 3] })));
    const before = (await import("node:fs")).readFileSync(l.sessionPath);
    const app = createSessionInfoRouter({
      store: store(SESSION),
      watcher: new SessionWatcher({ projectsDir: l.projectsDir }),
      infoDeps: { sessionsDir: "Z:\\none", noMemo: true },
    });
    const body = (await (await app.request("/api/external/tasks/t1/session-info")).json()) as { status: string; info: { context: { tokens: number } } };
    expect(body.status).toBe("ok");
    expect(body.info.context.tokens).toBe(6);
    expect((await import("node:fs")).readFileSync(l.sessionPath).equals(before)).toBe(true);
  });
});

describe("memo", () => {
  it("re-scans when the file grows, reuses when unchanged", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { usage: [1, 0, 0] })));
    const loc = { path: l.sessionPath, encodedCwd: "x", mtimeMs: 0, sizeBytes: 0 };
    const d = { sessionsDir: "Z:\\none" };
    expect((await readSessionInfo(SESSION, loc, d)).context.tokens).toBe(1);
    expect((await readSessionInfo(SESSION, loc, d)).context.tokens).toBe(1);
    (await import("node:fs")).appendFileSync(l.sessionPath, jl(assistant(2, { usage: [9, 0, 0] })));
    expect((await readSessionInfo(SESSION, loc, d)).context.tokens).toBe(9);
  });
});
