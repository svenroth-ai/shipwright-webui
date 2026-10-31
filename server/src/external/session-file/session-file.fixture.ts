import { afterEach, beforeEach } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSessionFileRouter } from "./routes.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { SESSION, assistant, jl, makeLayout, ts, type Layout } from "../../core/session-info/test-fixtures.js";

export const BS = "\x5c";
/** Per-test fixture dirs, reassigned by installFixtures()'s hooks. */
export const fx = { l: undefined as unknown as Layout, proj: "", out: "" };

export function installFixtures(): void {
  beforeEach(() => {
    fx.l = makeLayout();
    fx.proj = realpathSync(mkdtempSync(path.join(tmpdir(), "sf-proj-")));
    fx.out = realpathSync(mkdtempSync(path.join(tmpdir(), "sf-out-")));
    writeFileSync(path.join(fx.proj, "in.md"), "# inside");
    writeFileSync(path.join(fx.out, "a.txt"), "outside a");
    writeFileSync(path.join(fx.out, "a.txt.bak"), "outside bak");
  });
  afterEach(() => {
    for (const d of [fx.l.projectsDir, fx.proj, fx.out]) rmSync(d, { recursive: true, force: true });
  });
}

export const user = (n: number, content: unknown) => ({ type: "user", timestamp: ts(n), message: { role: "user", content } });
export const say = (n: number, text: string) => assistant(n, { blocks: [{ type: "text", text }] });
export const session = (...recs: unknown[]) => writeFileSync(fx.l.sessionPath, jl(...recs));

export function app(withTask = true, task: { projectId: string; cwd: string } = { projectId: "p", cwd: fx.proj }) {
  const store = {
    get: (id: string) => (withTask && id === "t1" ? { taskId: "t1", sessionUuid: SESSION, ...task } : undefined),
  } as never;
  return createSessionFileRouter({
    store,
    watcher: new SessionWatcher({ projectsDir: fx.l.projectsDir }),
    getProjectById: (id) => (id === "p" ? { id: "p", name: "p", path: fx.proj } : undefined),
    infoDeps: { sessionsDir: "Z:" + BS + "none", noMemo: true },
  });
}
export const get = (p: string, a = app()) => a.request(`/api/external/tasks/t1/session-file?path=${encodeURIComponent(p)}`);
export const j = async (r: Response) => (await r.json()) as { error?: string; detail?: string };
