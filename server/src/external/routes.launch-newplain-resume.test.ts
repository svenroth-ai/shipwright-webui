/*
 * routes.launch-newplain-resume.test.ts — iterate v0.8.8 AC-1
 * + Iterate L resume-cta-active-state refinement.
 *
 * For `new-plain` tasks BEFORE the first JSONL write, `Resume`
 * semantically can't work — Claude only writes a JSONL transcript
 * AFTER the user types their first message inside the TUI. So
 * `claude --resume <sessionUuid>` fails with "No conversation found"
 * for a new-plain task whose pty died before the user got to type
 * anything. v0.8.8 AC-1 made the Resume click in that case emit a
 * FRESH launch (`--session-id <uuid>`, no `--resume`) so Claude
 * opens a new TUI session under the same task identity.
 *
 * Iterate L (resume-cta-active-state) — empirical reproducer caught
 * the over-aggressive form of that gate: a new-plain task whose
 * JSONL DOES exist (user typed messages) still got forced through
 * the fresh-launch branch, which Claude then rejects with
 * "Session ID <uuid> is already in use" because the SQLite session
 * registry holds the lock. Refinement: gate also on
 * `firstJsonlObservedAt` — if the JSONL has been observed, emit the
 * real `--resume` regardless of actionId.
 *
 * Non-new-plain tasks keep the existing `--resume <uuid>`
 * semantics; their JSONL existence is taken for granted by the
 * legacy flow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

function inMemoryDeps(): SdkSessionsStoreDeps & { _files: Map<string, string> } {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    _files: files,
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

describe("AC-1 — POST /launch with resume=true on `new-plain` emits FRESH launch (no --resume)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "ac1-newplain-resume-"));
    const deps = inMemoryDeps();
    store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: { get: () => undefined },
      }),
    );
  });

  async function createTask(opts: { actionId?: string; title?: string }): Promise<{ taskId: string; sessionUuid: string }> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: opts.title ?? "t",
        cwd: "/tmp/whatever",
        actionId: opts.actionId,
      }),
    });
    const json = (await res.json()) as { task: { taskId: string; sessionUuid: string } };
    return { taskId: json.task.taskId, sessionUuid: json.task.sessionUuid };
  }

  async function postLaunch(taskId: string, body: Record<string, unknown>) {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ commands: { powershell: string; cmd: string; posix: string } }>;
  }

  it("new-plain + resume=true + JSONL NOT observed → fresh launch (--session-id, v0.8.8 original)", async () => {
    // Original v0.8.8 case preserved: brand-new task, user clicked Resume
    // before typing anything, no JSONL on disk → --resume would fail with
    // "No conversation found", so emit fresh --session-id launch instead.
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "ac1-resume-newplain-no-jsonl" });
    const { commands } = await postLaunch(taskId, { resume: true });

    expect(commands.powershell).not.toMatch(/--resume\b/);
    expect(commands.cmd).not.toMatch(/--resume\b/);
    expect(commands.posix).not.toMatch(/--resume\b/);

    expect(commands.powershell).toContain(`--session-id '${sessionUuid}'`);
    expect(commands.cmd).toContain(`--session-id "${sessionUuid}"`);
    expect(commands.posix).toContain(`--session-id '${sessionUuid}'`);
  });

  it("new-plain + resume=true + JSONL OBSERVED → real --resume (Iterate L fix)", async () => {
    // Iterate L empirical reproducer: a new-plain task where the user
    // typed messages → JSONL exists → SQLite session registry holds the
    // lock. Previously v0.8.8 forced fresh launch, which Claude rejected
    // with "Session ID is already in use". Fix: detect
    // firstJsonlObservedAt and route to --resume.
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "ac1-resume-newplain-jsonl" });
    // Simulate the watcher having observed the JSONL by patching the
    // task. In production this is set by SessionWatcher when the
    // <uuid>.jsonl file first appears under ~/.claude/projects/.
    store.patch(taskId, { firstJsonlObservedAt: new Date().toISOString() });
    const { commands } = await postLaunch(taskId, { resume: true });

    expect(commands.powershell).toMatch(/--resume '/);
    expect(commands.powershell).toContain(`--resume '${sessionUuid}'`);
    expect(commands.powershell).not.toMatch(/--session-id\b/);
  });

  it("new-plain + resume=false → fresh launch regardless of JSONL observation", async () => {
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "ac1-fresh-newplain" });
    store.patch(taskId, { firstJsonlObservedAt: new Date().toISOString() });
    const { commands } = await postLaunch(taskId, { resume: false });

    expect(commands.powershell).not.toMatch(/--resume\b/);
    expect(commands.powershell).toContain(`--session-id '${sessionUuid}'`);
  });

  it("non-new-plain + resume=true → commands DO emit --resume (existing semantics preserved)", async () => {
    // No actionId set on the task → legacy fallback path passes resume
    // through. Real-world case: adopted brownfield tasks that have a real
    // JSONL on disk to resume from.
    const { taskId, sessionUuid } = await createTask({ title: "ac1-real-resume" });
    const { commands } = await postLaunch(taskId, { resume: true });

    expect(commands.powershell).toMatch(/--resume '/);
    expect(commands.powershell).toContain(`--resume '${sessionUuid}'`);
    // Per launcher.ts contract: resume + no fork → no `--session-id` flag
    // (Claude CLI rejects --session-id+--resume without --fork-session).
    expect(commands.powershell).not.toMatch(/--session-id\b/);
  });
});
