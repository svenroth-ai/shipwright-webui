/*
 * Spec 37b — Bubble layout + AskUserQuestion lifecycle.
 *
 * Seeds an assistant turn with an AskUserQuestion tool_use, then appends a
 * matching tool_result mid-flight. Asserts the amber pending banner flips
 * to green within one polling cycle (1 s + slack). Also confirms tool_use
 * and tool_result render as sibling chronological cards (not nested).
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Bubble lifecycle — AskUserQuestion pending → resolved", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "37b-bubble-lifecycle" });
    await setActiveProject(page, project.projectId);
    // A00 — the center tab is persisted and defaults to "terminal"
    // (TaskDetailPage.tsx), so the transcript pane is HIDDEN on a fresh profile.
    // These specs were inheriting the developer's selected tab.
    await seedLocalStorage(page, {
      "webui:embedded-terminal-default-tab": '"transcript"',
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("amber pending flips to green resolved within one polling cycle", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "lifecycle-spec", cwd: "C:/tmp/lifecycle" },
    });
    const { task } = (await create.json()) as { task: { taskId: string; sessionUuid: string } };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-lifecycle-${Date.now()}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    const askEvent = JSON.stringify({
      type: "assistant",
      sessionId: task.sessionUuid,
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_pending_q",
            name: "AskUserQuestion",
            input: {
              parts: [{ question: "Pick a stack?", options: ["Supabase", "Firebase"] }],
            },
          },
        ],
      },
    });
    writeFileSync(jsonlPath, askEvent + "\n", "utf-8");

    await page.goto(`/tasks/${task.taskId}`);

    // Pending banner appears; amber + question copy.
    const pending = page.getByTestId("askuser-pending");
    await expect(pending).toBeVisible({ timeout: 5000 });
    await expect(pending).toContainText("Pick a stack?");
    await expect(pending).toContainText("Supabase");
    await expect(pending).toContainText("Firebase");
    expect(await pending.getAttribute("data-tool-use-id")).toBe("tu_pending_q");

    // Append matching tool_result (the user answered in their terminal).
    const answer = JSON.stringify({
      type: "user",
      sessionId: task.sessionUuid,
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu_pending_q", content: "Supabase" }],
      },
    });
    appendFileSync(jsonlPath, answer + "\n", "utf-8");

    // Resolved banner appears; pending banner gone.
    await expect(page.getByTestId("askuser-resolved")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("askuser-pending")).toHaveCount(0);
  });

  test("a resolved tool_result FOLDS into its tool_use card (ADR-065), not a sibling", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "siblings-spec", cwd: "C:/tmp/siblings" },
    });
    const { task } = (await create.json()) as { task: { taskId: string; sessionUuid: string } };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-siblings-${Date.now()}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    const lines = [
      JSON.stringify({
        type: "assistant",
        sessionId: task.sessionUuid,
        message: {
          content: [
            { type: "text", text: "Running Bash" },
            { type: "tool_use", id: "tu_bash", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: task.sessionUuid,
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_bash", content: "file.ts\nREADME.md" }],
        },
      }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf-8");

    await page.goto(`/tasks/${task.taskId}`);

    // A00 — this spec used to assert tool_use + tool_result render as SIBLING cards.
    // ADR-065 changed that: when a tool_use is a visible card, its matching
    // tool_result is FOLDED into that card (rendered inside the `ToolOutputBlock`),
    // and the user turn carrying only that result is dropped from the transcript
    // entirely (filters.ts `filterEventsForRender`). So the correct rendering is:
    //   - one `bubble-assistant` card,
    //   - a `bubble-tool-use` block nested inside it (the folded ToolOutputBlock),
    //   - and NO separate sibling `bubble-tool-result` — that testid now appears only
    //     for an ORPHAN result whose tool_use isn't a visible card.
    const assistant = page.getByTestId("bubble-assistant");
    await expect(assistant).toBeVisible({ timeout: 5000 });

    const tu = page.getByTestId("bubble-tool-use");
    await expect(tu).toBeVisible({ timeout: 5000 });
    // The tool_use block is nested inside the assistant card (folded rendering).
    expect(await assistant.locator("[data-testid='bubble-tool-use']").count()).toBeGreaterThan(0);

    // The resolved result was folded in — it is NOT a separate sibling card.
    await expect(page.getByTestId("bubble-tool-result")).toHaveCount(0);
  });
});
