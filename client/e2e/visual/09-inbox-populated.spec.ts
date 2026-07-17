/*
 * Visual baseline — Inbox POPULATED (A19, FR-01.63). The empty state is captured
 * by 03-shell-routes.spec.ts; this captures the other half: mid-run questions on
 * the §5.2 solid neutral sub-panel, showing the repainted card anatomy + the
 * "Answer in the terminal" navigation CTA + the honesty line.
 *
 * Determinism: freezeClock pins the "2h ago" label; the seeded project colour is
 * fixed (FIXTURE_PROJECT_COLOR); the only non-deterministic region is the
 * server-generated session-UUID chip, which is MASKED.
 *
 * The A19 runner is on Windows, so the PNG is generated + committed by the
 * orchestrator's pinned-container run (the manifest lists this route `pending`
 * until then). See routes.ts.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { freezeClock, settle } from "./stabilize";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("visual: inbox populated", () => {
  let project: SeededProject;
  let taskId: string;
  let seededJsonlDir: string | undefined;

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
    if (seededJsonlDir) {
      try {
        rmSync(seededJsonlDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  test("inbox-populated", async ({ page, request }) => {
    const stamp = Date.now();
    const toolUseId = `vis-a19-${stamp}`;

    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-inbox-a19" });
    const task = await seedTask(request, {
      title: "Add password reset flow",
      projectId: project.projectId,
      cwd: homedir(),
    });
    taskId = task.taskId;

    const created = await request
      .get(apiUrl(`/api/external/tasks/${taskId}`))
      .then((r) => r.json() as Promise<{ task: { createdAt: string } }>);

    const encodedDir = path.join(PROJECTS_DIR, `vis-a19-${stamp}`);
    seededJsonlDir = encodedDir;
    mkdirSync(encodedDir, { recursive: true });
    writeFileSync(
      path.join(encodedDir, `${task.sessionUuid}.jsonl`),
      JSON.stringify({
        type: "assistant",
        sessionId: task.sessionUuid,
        message: {
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Reset link expiry — 1 hour or 24 hours?",
                    header: "Priority",
                    context:
                      "A shorter window is safer; a longer one is friendlier if the mail is delayed.",
                    options: [{ label: "1 hour" }, { label: "24 hours" }],
                  },
                ],
              },
            },
          ],
        },
      }) + "\n",
      "utf-8",
    );

    await freezeClock(page, created.task.createdAt);
    await setActiveProject(page, project.projectId);

    await page.goto("/");
    await page.getByRole("link", { name: /^inbox/i }).first().click();
    await expect(page.getByTestId("inbox-page")).toBeVisible();
    await expect(page.getByTestId(`inbox-card-${toolUseId}`)).toBeVisible({
      timeout: 25_000,
    });
    await settle(page);

    await expect(page).toHaveScreenshot("inbox-populated.png", {
      fullPage: true,
      // The only non-deterministic region: the server-generated session-UUID chip.
      mask: [page.locator('[data-testid^="inbox-group-project-label-"]')],
    });
  });
});
