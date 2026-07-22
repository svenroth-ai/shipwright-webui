/*
 * FR-01.66 — "Where it stands" derived from the iterate's REAL phase
 * (campaign 2026-07-18-mission-artifacts, S4).
 *
 * The regression this fences: `inferStage` was furthest-along-wins over COARSE
 * tool signals, so the FIRST `Edit`/`Write` to any non-spec file set Build — and
 * Build outranks Analyze. A scratchpad probe script written while the iterate was
 * still scouting was enough to jump the stepper off Analyze. Measured over 114
 * real iterate transcripts, 15% opened exactly that way.
 *
 * Seeded fixtures only (never operator UUIDs). WebUI is a READ-ONLY observer of
 * the JSONL (rule 1 / DO-NOT #1): the fixture writes the transcript,
 * impersonating *Claude*, and the server observes it through the production
 * transcript endpoint — so this runs on a CI runner with no `claude` binary.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

test.describe("FR-01.66 S4 — the stepper holds Analyze through scope", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Mission stage S4" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  const cmd = (name: string) => ({
    type: "user",
    message: {
      role: "user",
      content: `<command-message>${name}</command-message><command-name>/${name}</command-name>`,
    },
  });
  const tool = (id: string, name: string, input: Record<string, unknown>) => ({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  });

  async function createTask(
    page: import("@playwright/test").Page,
    title: string,
  ): Promise<{ taskId: string; sessionUuid: string; cwd: string }> {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("plain-claude-button").click();
    await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("new-issue-title-input").fill(title);
    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
    );
    await page.getByTestId("new-issue-save-btn").click();
    const body = (await (await createResp).json()) as {
      task: { taskId: string; sessionUuid: string; cwd: string };
    };
    return body.task;
  }

  test("a scouting iterate reads Analyze despite a scratch write, then advances (AC1/AC2)", async ({
    page,
  }) => {
    const task = await createTask(page, `mission-s4-${Date.now()}`);
    taskId = task.taskId;

    // Resolve this card as a REAL iterate (external code review, GPT finding 6).
    // A seeded harness task has no `iterate_active` pointer, so without this the
    // resolver returns `plain` and the assertion below would ride the
    // kickoff-evidence fallback instead of proving the scenario-gated iterate
    // branch. Only the discriminator is overridden — everything else is the real
    // server response.
    await page.route(
      (u) => u.pathname.endsWith(`/mission-context`),
      async (route) => {
        const res = await route.fetch();
        const body = await res.json().catch(() => null);
        if (body?.context) body.context.scenario = "iterate";
        await route.fulfill({ response: res, json: body ?? {} });
      },
    );

    // SCOPE / CALIBRATION: the kickoff, the iterate's own classify step, reads,
    // searches, a todo list — and one incidental scratchpad write. Pre-S4 that
    // last event alone flipped the stepper to Build.
    const scope = [
      cmd("shipwright-iterate"),
      tool("b1", "Bash", { command: 'uv run ".../setup_iterate_worktree.py" --slug s4' }),
      tool("b2", "Bash", { command: 'uv run ".../classify_complexity.py" --message x' }),
      tool("t1", "Read", { file_path: "/repo/client/src/lib/narrator-transcript.ts" }),
      tool("t2", "Grep", { pattern: "inferStage" }),
      tool("t3", "TodoWrite", {}),
      tool("t4", "Write", { file_path: "/tmp/claude/abc/scratchpad/probe.mjs" }),
    ];
    seedClaudeJsonlEvents({ sessionUuid: task.sessionUuid, cwd: task.cwd, events: scope });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();

    const stepper = page.getByTestId("mission-stage");
    await expect(stepper).toHaveAttribute("data-stage", "Analyze", { timeout: 15_000 });
    // FR-01.68: the narration reports SCOUTING, and a scratch probe is not the
    // work — it is neither counted as a change nor named. S4 stopped the scratch
    // write from faking the Build STAGE; this stops it from posing as the story.
    const narration = page.getByTestId("mission-narration");
    await expect(narration).toContainText("getting its bearings", { timeout: 15_000 });
    await expect(narration).not.toContainText("probe.mjs");
    await expect(narration).not.toContainText("files were then changed");

    // SPEC: the iterate spec is actually written. Only now does the stepper move,
    // and it moves to Spec — not to the Build the scratch write would have faked.
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        ...scope,
        tool("t5", "Write", {
          file_path: "/repo/.shipwright/planning/iterate/run/iterate-spec.md",
        }),
      ],
    });
    await expect(stepper).toHaveAttribute("data-stage", "Spec", { timeout: 15_000 });

    // BUILD: a real product edit. No refresh anywhere in this test — the same
    // single transcript poll drives every transition.
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        ...scope,
        tool("t5", "Write", {
          file_path: "/repo/.shipwright/planning/iterate/run/iterate-spec.md",
        }),
        tool("t6", "Edit", { file_path: "/repo/client/src/lib/stage-derivation.ts" }),
      ],
    });
    await expect(stepper).toHaveAttribute("data-stage", "Build", { timeout: 15_000 });
  });

  test("a plain session claims no lifecycle position, just what it is doing (AC5)", async ({
    page,
  }) => {
    const task = await createTask(page, `mission-s4-plain-${Date.now()}`);
    taskId = task.taskId;

    // A card the resolver positively resolves as `plain` — the negative case for
    // the iterate branch (external code review, GPT finding 6).
    await page.route(
      (u) => u.pathname.endsWith(`/mission-context`),
      async (route) => {
        const res = await route.fetch();
        const body = await res.json().catch(() => null);
        if (body?.context) body.context.scenario = "plain";
        await route.fulfill({ response: res, json: body ?? {} });
      },
    );

    // No `/shipwright-iterate` kickoff anywhere: a genuinely plain session. The
    // same scratch write that sticks to Analyze for an iterate must NOT get the
    // sticky treatment here — the iterate branch is gated off entirely.
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "Have a look at the config" } },
        tool("t1", "Read", { file_path: "/repo/README.md" }),
        tool("t2", "Write", { file_path: "/tmp/claude/abc/scratchpad/probe.mjs" }),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();

    // Neither "Analyze" (the sticky iterate answer) nor "Build" (the pre-S4
    // answer) — an honest coarse read with no lifecycle claim at all.
    await expect(page.getByTestId("mission-stage")).toHaveAttribute("data-stage", "none", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("mission-stage-none")).toContainText("Editing files");
  });
});
