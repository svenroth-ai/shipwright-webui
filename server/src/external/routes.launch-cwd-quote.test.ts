import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

// Minimal in-memory store deps (mirrors routes.test.ts).
function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

/**
 * Regression: macOS WebUI paste artifact (iterate-2026-07-06,
 * fix-launch-path-quote-strip). A project/task path copied from a shell
 * context arrives wrapped in surrounding single quotes, e.g.
 *   '/Users/marcelburkart/Projects/Claude Command Center'
 * Before the fix the launcher shell-escaped the LITERAL quote chars into
 *   cd ''\''/Users/.../Claude Command Center'\''' && claude ...
 * which zsh reads as a directory literally named "'…'" → "cd: no such file
 * or directory" and the launch never starts. The path must be normalised at
 * the input boundary so the emitted command is
 *   cd '/Users/.../Claude Command Center' && … .
 */
describe("POST /launch — quote-wrapped cwd normalisation (FR-01.10)", () => {
  let app: Hono;
  let store: SdkSessionsStore;

  beforeEach(async () => {
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: "/nonexistent-projects" });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({ store, watcher, ptyManager: { get: () => undefined } }),
    );
  });

  it("emits a single-quoted cd, not the double-escaped form", async () => {
    const quoted = "'/Users/marcelburkart/Projects/Claude Command Center'";
    const create = await app.request("/api/external/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", cwd: quoted }),
    });
    const { task } = await create.json() as { task: { taskId: string } };

    const launch = await app.request(`/api/external/tasks/${task.taskId}/launch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: false }),
    });
    expect(launch.status).toBe(200);
    const body = await launch.json() as { commands: { posix: string } };

    // The broken (pre-fix) form contains the tell-tale doubled escape.
    expect(body.commands.posix).not.toContain("''\\''");
    expect(body.commands.posix).toContain(
      "cd '/Users/marcelburkart/Projects/Claude Command Center' &&",
    );
    // --add-dir carried the same doubled path pre-fix; assert it too.
    expect(body.commands.posix).toContain(
      "--add-dir '/Users/marcelburkart/Projects/Claude Command Center'",
    );
  });
});
