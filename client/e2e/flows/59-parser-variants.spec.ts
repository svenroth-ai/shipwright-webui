/*
 * Spec 59 — Parser hardening for iterate 2 UAT regressions.
 *
 * Seeds a JSONL fixture with one of each new event type (custom-title,
 * agent-name, permission-mode, plus an unknown-future-type) and verifies
 * the BubbleTranscript renders proper chips — not the "Unknown event"
 * fallback card. `system` visibility is covered in spec 60.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Parser variants (FR-03.50 / 03.52)", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "59-parser-variants" });
    await setActiveProject(page, project.projectId);
    // A00 — the center tab is persisted and defaults to "terminal"
    // (TaskDetailPage.tsx), so the transcript pane is HIDDEN on a fresh profile.
    // These specs were inheriting the developer's selected tab.
    await seedLocalStorage(page, {
      "webui:embedded-terminal-default-tab": '"transcript"',
      // custom-title / agent-name / permission-mode are SYSTEM events, which the
      // transcript HIDES by default (that default is exactly what spec 60 guards).
      // This spec asserts they render as chips, so the toggle must be on — it was
      // inheriting the developer's own preference. Raw "true", not JSON-encoded
      // (BubbleTranscript/useSystemVisibility.ts reads it with a === "true" compare).
      "webui.transcript.showSystem": "true",
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("renders custom-title / agent-name / permission-mode as chips, not Unknown", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "parser-variants-spec", cwd: "C:/tmp/parser-variants" },
    });
    const { task } = (await create.json()) as { task: { taskId: string; sessionUuid: string } };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-parser-variants-${Date.now()}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    const lines = [
      JSON.stringify({
        type: "custom-title",
        sessionId: task.sessionUuid,
        customTitle: "Implement user auth",
      }),
      JSON.stringify({
        type: "agent-name",
        sessionId: task.sessionUuid,
        agentName: "Claude Sonnet 4.6",
      }),
      JSON.stringify({
        type: "permission-mode",
        sessionId: task.sessionUuid,
        permissionMode: "acceptEdits",
      }),
      // Regression: an invented future type should still fall through
      // to the unknown card (parser MUST NOT crash).
      JSON.stringify({
        type: "plugin-hook-v2",
        sessionId: task.sessionUuid,
        whatever: { foo: "bar" },
      }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf-8");

    await page.goto(`/tasks/${task.taskId}`);

    // Three proper chips appear with their payload text.
    const titleChip = page.getByTestId("bubble-custom-title");
    await expect(titleChip).toBeVisible({ timeout: 5000 });
    await expect(titleChip).toContainText("Implement user auth");

    const agentChip = page.getByTestId("bubble-agent-name");
    await expect(agentChip).toBeVisible();
    await expect(agentChip).toContainText("Claude Sonnet 4.6");

    const permChip = page.getByTestId("bubble-permission-mode");
    await expect(permChip).toBeVisible();
    await expect(permChip).toContainText("acceptEdits");

    // The invented type still falls through to the unknown card (fallback
    // invariant — external review-pinned).
    const unknown = page.getByTestId("bubble-unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown).toContainText("plugin-hook-v2");
  });
});
