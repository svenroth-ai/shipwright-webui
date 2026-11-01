/*
 * M4 - Mission Agents window (campaign mission-desktop-style).
 *
 * Real browser + real server + REAL files: the session JSONL and the subagent
 * JSONL / meta files are written into the isolated Claude home, so the real
 * session-info scan AND the new read-only subagent-transcript route are what the
 * UI talks to (nothing is mocked). A running depth-1 runner with a running
 * depth-2 reviewer, plus one finished agent whose subrunner card sits in chat.
 * @covers FR-01.66
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const tool = (id: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name: "Agent", input }] },
});
const ack = (id: string, agentId: string) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `Async agent launched successfully. agentId: ${agentId}` }] },
});
const notif = (agentId: string, toolUseId: string, result = "REPORT-FIN") => ({
  type: "user",
  message: {
    role: "user",
    content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n<result>${result}</result>\n</task-notification>`,
  },
  origin: { kind: "task-notification" },
});

function writeAgent(dir: string, id: string, meta: Record<string, unknown>, events: Record<string, unknown>[]) {
  const now = new Date().toISOString();
  const rows = events.map((e) => JSON.stringify({ isSidechain: true, agentId: id, timestamp: now, ...e }));
  fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), rows.join("\n") + "\n", "utf-8");
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta), "utf-8");
}
const text = (role: "user" | "assistant", t: string) => ({ type: role, message: { role, content: role === "user" ? t : [{ type: "text", text: t }] } });

test.describe("M4 - Agents window", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "AgentsWin", dirName: "sw-m4-agents" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("bar -> window -> tree -> prompt/answer/transcript, and the chat card opens the same detail", async ({ page, request }) => {
    const task = await seedTask(request, { title: "Agents run", projectId: project.projectId });
    taskId = task.taskId;
    const file = seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        tool("t1", { description: "Build the thing", prompt: "BUILD-PROMPT", run_in_background: true }),
        ack("t1", "run1"),
        tool("t3", { description: "Old research", prompt: "FIN-PROMPT", run_in_background: true }),
        ack("t3", "fin1"),
        notif("fin1", "t3"),
        tool("t4", { description: "Ghost audit", prompt: "GHOST-PROMPT", run_in_background: true }),
        ack("t4", "ghost1"),
        notif("ghost1", "t4", "This agent's report was delivered to you as a message from \"fin1\" (its SubagentHandback call). Read it there; it is not repeated here."),
      ],
    });
    const dir = path.join(path.dirname(file), task.sessionUuid, "subagents");
    fs.mkdirSync(dir, { recursive: true });
    writeAgent(dir, "run1", { agentType: "sub-iterate-runner", description: "Build the thing", toolUseId: "t1", spawnDepth: 1 }, [
      text("user", "BUILD-PROMPT"),
      tool("t2", { description: "Review it", prompt: "REVIEW-PROMPT", run_in_background: true }),
    ]);
    writeAgent(dir, "rev1", { agentType: "code-reviewer", description: "Review it", toolUseId: "t2", spawnDepth: 2, parentAgentId: "run1" }, [
      text("user", "REVIEW-PROMPT"),
      text("assistant", "reviewing"),
    ]);
    writeAgent(dir, "fin1", { agentType: "researcher", description: "Old research", toolUseId: "t3", spawnDepth: 1 }, [
      text("user", "FIN-PROMPT"),
      text("user", "The coordinator sent a message while you were working:\nCOORD-MARK please double-check.\n\nAddress this before completing your current task."),
      text("assistant", "TRANSCRIPT-MARK fin1 answer"),
    ]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    const chip = page.getByTestId("agents-bar-button");
    await expect(chip).toContainText("2 agents running", { timeout: 20_000 });
    await chip.click();

    const win = page.getByTestId("agents-window");
    await expect(win).toBeVisible();
    await expect(win.getByTestId("agents-section-active")).toBeVisible();
    await expect(win.getByTestId("agents-section-finished")).toBeVisible();
    await expect(win.getByTestId("agent-row-run1")).toHaveAttribute("data-depth", "0");
    await expect(win.getByTestId("agent-row-rev1")).toHaveAttribute("data-depth", "1");
    await expect(win.getByTestId("agents-section-finished").getByTestId("agent-row-fin1")).toBeVisible();

    await win.getByTestId("agent-row-fin1").click();
    await expect(win.getByTestId("agent-prompt")).toContainText("FIN-PROMPT");
    await expect(win.getByTestId("agent-answer")).toContainText("TRANSCRIPT-MARK fin1 answer");
    await win.getByTestId("agent-tab-transcript").click();
    await expect(win.getByTestId("agent-transcript")).toContainText("TRANSCRIPT-MARK fin1 answer", { timeout: 15_000 });
    // V3: the transcript uses the chat's own feed; the prompt is a labelled card and the coordinator's message is
    // a hand-back card - neither is a right-hand human bubble.
    await expect(win.getByTestId("agent-prompt-card")).toContainText("Prompt from the session");
    await expect(win.getByTestId("agent-prompt-card")).toContainText("FIN-PROMPT");
    await expect(win.getByTestId("handback-card")).toContainText("COORD-MARK");
    await expect(win.getByTestId("agent-feed")).not.toContainText("The coordinator sent a message");
    await expect(win.locator('[data-entry-kind="user"]')).toHaveCount(0);
    await expect(win.getByTestId("agent-feed")).not.toContainText("Unknown event");
    // V3: only a RUNNING agent carries a status dot.
    await expect(win.getByTestId("agent-row-fin1").locator(".ag-dot")).toHaveCount(0);
    await expect(win.getByTestId("agent-row-run1").locator(".ag-dot")).toHaveCount(1);
    await expect(win.locator("textarea")).toHaveCount(0);
    await expect(win.locator('[data-testid^="chat-"]')).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(win).toBeHidden();
    await expect(chip).toBeFocused();

    // The finished subrunner card in the chat opens the SAME detail.
    const card = page.getByTestId("mission-activity-feed").locator('[data-kind="subrunner"]', { hasText: "Old research" });
    await card.getByRole("button", { name: /View subrunner report/ }).click();
    await expect(page.getByTestId("agents-window")).toBeVisible();
    await expect(page.getByTestId("agent-detail")).toHaveAttribute("data-agent-id", "fin1");
    await expect(page.getByTestId("agent-prompt")).toContainText("FIN-PROMPT");

    // V3: an agent session-info does not know falls back to the subrunner panel, which never shows the
    // "delivered to you as a message" pointer as if it were the report.
    await page.keyboard.press("Escape");
    const ghost = page.getByTestId("mission-activity-feed").locator('[data-kind="subrunner"]', { hasText: "Ghost audit" });
    await ghost.getByRole("button", { name: /View subrunner report/ }).click();
    const panel = page.getByTestId("subrunner-panel");
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText("delivered to you");
    await expect(panel.getByTestId("subrunner-no-report")).toBeVisible();

    // A malformed id is refused by the real route.
    const bad = await request.get(`/api/external/tasks/${taskId}/subagents/..%2Fx/transcript`);
    expect(bad.status()).toBe(400);
  });
});
