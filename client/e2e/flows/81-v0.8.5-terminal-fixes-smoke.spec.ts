/*
 * Spec 81 — v0.8.5 terminal fixes + cleanup smoke
 * (iterate-2026-05-08-v0-8-5-terminal-fixes-and-cleanup).
 *
 * Empirical regression coverage for ACs that unit tests cannot reach:
 *
 *   - AC-1: EmbeddedTerminal wrapper carries `bg-[#1a1a1a]` AND
 *           `padding: 8px` — single-layer dark canvas with inner inset.
 *   - AC-4: new-plain (`/api/external/launch` with actionId="new-plain")
 *           tasks transition `awaiting_external_start` → `active`
 *           the moment the WS upgrade onOpen succeeds.
 *   - AC-6: TaskDetailHeader on awaiting/active tasks shows NO
 *           `cta-terminal` button (only the kebab menu + status badge).
 *
 * Stage 2 AC-3 (defensive `term.clear()` on replay_start) is covered
 * exclusively by EmbeddedTerminal.test.tsx unit tests because the
 * accumulated-100-banner observation requires either a 1.6 MB
 * scrollback fixture (slow + flaky) or a multi-attach simulation that
 * doesn't reflect real WS-reconnect timing. The unit tests proved the
 * call-shape; user-side runtime "Clear terminal history" resolves the
 * historical accumulation.
 *
 * Stage 1 AC-2 (Ctrl+V handler revert) is covered by absence: Spec
 * 80 was deleted; client/src/components/terminal/clipboard-paste.ts
 * is removed; the EmbeddedTerminal.test.tsx wiring tests are gone.
 * The DOM `paste` event listener (right-click → Paste) survival is
 * covered by the existing "paste-handler — …" unit cases.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const SHIPWRIGHT_WEBUI_PROJECT_ID = "50e86b6e-3ade-44c4-9e21-2c62c65f804e";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v085-spec81-"));
}

async function cleanupCwd(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function createTaskWithLaunch(
  request: APIRequestContext,
  cwd: string,
  title: string,
): Promise<string> {
  // Two-step flow that mirrors NewIssueModal:
  //   1) POST /api/external/tasks with actionId persisted at create-time
  //   2) POST /api/external/tasks/:id/launch with actionId on the body so
  //      the launch handler resolves the new-plain command template + flips
  //      state from draft → awaiting_external_start.
  const created = await request.post("/api/external/tasks", {
    data: {
      title,
      cwd,
      actionId: "new-plain",
    },
  });
  if (!created.ok()) {
    throw new Error(`create: HTTP ${created.status()} — ${await created.text()}`);
  }
  const cBody = (await created.json()) as { task: { taskId: string } };
  const taskId = cBody.task.taskId;

  const launched = await request.post(
    `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
    {
      data: { actionId: "new-plain" },
    },
  );
  if (!launched.ok()) {
    throw new Error(
      `launch: HTTP ${launched.status()} — ${await launched.text()}`,
    );
  }
  return taskId;
}

async function deleteTask(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch {
    /* best-effort */
  }
}

test.describe("Spec 81 — v0.8.5 terminal fixes smoke", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);
  });

  test("AC-1: EmbeddedTerminal wrapper has single-layer dark bg + 8px inner padding", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTaskWithLaunch(request, cwd, "ac1-padding");
    try {
      await page.goto(`/tasks/${taskId}`);
      const wrap = page.getByTestId("embedded-terminal");
      await wrap.waitFor({ state: "attached", timeout: 15_000 });

      const styles = await wrap.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          backgroundColor: cs.backgroundColor,
          paddingTop: cs.paddingTop,
          paddingRight: cs.paddingRight,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          borderRadius: cs.borderTopLeftRadius,
        };
      });

      // bg-[#1a1a1a] = rgb(26, 26, 26)
      expect(styles.backgroundColor.replace(/\s+/g, "")).toMatch(
        /^rgba?\(26,26,26[,\)]/,
      );
      // p-2 = 8px on all four sides (Tailwind v4 default scale)
      expect(styles.paddingTop).toBe("8px");
      expect(styles.paddingRight).toBe("8px");
      expect(styles.paddingBottom).toBe("8px");
      expect(styles.paddingLeft).toBe("8px");
      // v0.8.6 AC-1 — rounded corners removed (visually out of place
      // against the rest of the WebUI's square chrome).
      expect(styles.borderRadius).toBe("0px");
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-4: new-plain task transitions awaiting_external_start → active on WS upgrade onOpen", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTaskWithLaunch(request, cwd, "ac4-newplain-transition");
    try {
      // Pre-condition: state is awaiting_external_start right after launch
      // (no JSONL written yet because new-plain only writes on first message).
      const pre = await request.get(
        `/api/external/tasks/${encodeURIComponent(taskId)}`,
      );
      expect(pre.ok()).toBeTruthy();
      const preBody = (await pre.json()) as { task: { state: string } };
      expect(preBody.task.state).toBe("awaiting_external_start");

      // Navigate to the task — TaskDetailPage mounts EmbeddedTerminal
      // which opens the WS, server's onOpen fires the v0.8.5 AC-4 patch.
      await page.goto(`/tasks/${taskId}`);

      // Wait for the WS to reach ready=true (proves onOpen has fired
      // and the server has had its chance to patch state).
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });

      // Server transcript-poll state-machine writes asynchronously;
      // give it up to 5s to commit the patch via store.persist().
      let observedActive = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !observedActive) {
        const post = await request.get(
          `/api/external/tasks/${encodeURIComponent(taskId)}`,
        );
        if (post.ok()) {
          const postBody = (await post.json()) as { task: { state: string } };
          if (postBody.task.state === "active") {
            observedActive = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(observedActive).toBe(true);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-6: TaskDetailHeader shows NO Terminal CTA on awaiting/active tasks", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTaskWithLaunch(request, cwd, "ac6-no-terminal-cta");
    try {
      await page.goto(`/tasks/${taskId}`);
      // Wait until we're past the initial header render.
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toBeVisible({ timeout: 15_000 });

      // Header CTA matrix per v0.8.5 AC-6:
      //   draft / awaiting / active / done / launch_failed → no cta-terminal.
      // The kebab "..." menu trigger remains; assert it's still there to
      // prove the header itself rendered (not a router error fallback).
      await expect(page.getByTestId("cta-terminal")).toHaveCount(0);
      await expect(
        page.getByTestId("task-detail-menu-trigger"),
      ).toBeVisible();

      // Force the active state by waiting for AC-4's transition (covered
      // above; here we just re-assert no-terminal-cta after the badge
      // would have flipped).
      await new Promise((r) => setTimeout(r, 1000));
      await expect(page.getByTestId("cta-terminal")).toHaveCount(0);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
