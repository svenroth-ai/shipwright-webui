/*
 * Spec 84 — v0.8.8 AC-1 empirical regression
 * (iterate-2026-05-08-v0-8-8-newplain-resume-and-cli-robustness).
 *
 * For `new-plain` tasks, clicking Resume in the UI must produce a
 * FRESH launch (no `--resume` flag) — Claude can't resume a session
 * that never wrote a JSONL on disk.
 *
 * Test shape: POST /launch with `resume: true` against a `new-plain`
 * task, assert the returned `commands.powershell` does NOT contain
 * `--resume` and DOES contain `--session-id <uuid>`. Mirrors the unit
 * test (routes.launch-newplain-resume.test.ts) but runs against the
 * live dev stack to guard against regression in the wired-together
 * route + store + launcher path.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const SHIPWRIGHT_WEBUI_PROJECT_ID = "eab3bd8d-d89a-4b8c-aaaa-60a5ff856407";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v088-spec84-"));
}

async function deleteTask(request: APIRequestContext, taskId: string): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch { /* best-effort */ }
}

test.describe("Spec 84 — v0.8.8 new-plain Resume → fresh launch (AC-1)", () => {
  test.setTimeout(60_000);

  test("new-plain + POST /launch with resume=true → commands omit --resume", async ({ request }) => {
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;
    try {
      const created = await request.post("/api/external/tasks", {
        data: {
          title: "spec84-newplain-resume",
          cwd,
          actionId: "new-plain",
          projectId: SHIPWRIGHT_WEBUI_PROJECT_ID,
        },
      });
      const cBody = (await created.json()) as { task: { taskId: string; sessionUuid: string } };
      taskId = cBody.task.taskId;
      const sessionUuid = cBody.task.sessionUuid;

      const launched = await request.post(
        `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
        { data: { resume: true } },
      );
      expect(launched.ok()).toBe(true);
      const lBody = (await launched.json()) as {
        commands: { powershell: string; cmd: string; posix: string };
      };

      // The fix: --resume must NOT appear, --session-id MUST appear.
      expect(lBody.commands.powershell).not.toMatch(/--resume\b/);
      expect(lBody.commands.cmd).not.toMatch(/--resume\b/);
      expect(lBody.commands.posix).not.toMatch(/--resume\b/);
      expect(lBody.commands.powershell).toContain(sessionUuid);
      expect(lBody.commands.powershell).toMatch(/--session-id /);
    } finally {
      if (taskId) await deleteTask(request, taskId);
      try { await fs.rm(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("non-new-plain (no actionId) + resume=true → commands DO include --resume (existing semantics preserved)", async ({ request }) => {
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;
    try {
      // No actionId → legacy fallback path keeps resume semantics.
      const created = await request.post("/api/external/tasks", {
        data: {
          title: "spec84-real-resume",
          cwd,
          projectId: SHIPWRIGHT_WEBUI_PROJECT_ID,
        },
      });
      const cBody = (await created.json()) as { task: { taskId: string; sessionUuid: string } };
      taskId = cBody.task.taskId;
      const sessionUuid = cBody.task.sessionUuid;

      const launched = await request.post(
        `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
        { data: { resume: true } },
      );
      expect(launched.ok()).toBe(true);
      const lBody = (await launched.json()) as {
        commands: { powershell: string; cmd: string; posix: string };
      };
      expect(lBody.commands.powershell).toMatch(/--resume /);
      expect(lBody.commands.powershell).toContain(sessionUuid);
    } finally {
      if (taskId) await deleteTask(request, taskId);
      try { await fs.rm(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
