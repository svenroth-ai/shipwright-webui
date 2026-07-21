/*
 * The Mission tab must not go blank when the run's bridge is gone
 * (iterate-2026-07-21-mission-run-identity-recovery; FR-01.66).
 *
 * Three MEASURED production failures, each driven end-to-end here:
 *
 *   1. The `iterate_active` pointer is deleted at Finalize and the durable
 *      association was only ever written while the tab happened to be open, so
 *      a finished iterate answered `plain` forever (1 of 416 real tasks carried
 *      an association). The run signs its own commit with `Run-ID:` — this
 *      seeds a REAL synthetic transcript carrying that footer and expects the
 *      rail back.
 *   2. A pointer naming a worktree git no longer registers (20 of 20 real
 *      pointers) erased ALL SIX artifacts behind "not a registered worktree",
 *      although every artifact was in the main root.
 *   3. A run IN FLIGHT has written nothing yet, and hide-empty removed the
 *      whole rail for that entire phase.
 *
 * Fixtures only, never operator UUIDs; the transcript seeder self-locks to an
 * isolated temp HOME.
 *
 * @covers FR-01.66
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
import { writeFiles } from "../helpers/temp-dir";

const RUN_ID = "iterate-2026-07-21-recovery-e2e";

const SPEC_DOC = `# Run-identity recovery — E2E fixture

This iterate touches FR-01.66 (the Mission view).

## Affected Boundaries

The mission-context resolver response shape.
`;

/** A finalized run — the corroboration the transcript recovery requires. */
function eventsJsonl(): string {
  return `${JSON.stringify({
    id: "evt-recovery-0001",
    type: "work_completed",
    ts: "2026-07-21T12:00:00Z",
    adr_id: RUN_ID,
    commit: "beef1234cafe5678",
    summary: "Recover the run identity from the session's own commit footer.",
    spec_impact: "modify",
    affected_frs: ["FR-01.66"],
    tests: { passed: 9, total: 9 },
  })}\n`;
}

/** The transcript the SESSION itself wrote — a commit carrying the F6 footer. */
function footerTranscript(sessionUuid: string, cwd: string): void {
  seedClaudeJsonlEvents({
    sessionUuid,
    cwd,
    events: [
      { type: "user", message: { role: "user", content: "run the iterate" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: [
                "F6 — committing:",
                "",
                "feat(mission): recover the run identity",
                "",
                `Run-ID: ${RUN_ID}`,
                "Co-Authored-By: Claude <noreply@anthropic.com>",
              ].join("\n"),
            },
          ],
        },
      },
    ],
  });
}

function pointer(sessionUuid: string, mainRoot: string, worktreePath?: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "recovery-e2e",
    branch: "iterate/recovery-e2e",
    ...(worktreePath ? { worktree_path: worktreePath } : {}),
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-07-21T10:00:00Z",
  });
}

test.describe("Mission — the run identity survives the bridge", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("a PRUNED pointer still resolves, from the session's own Run-ID footer", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionRecovery",
      dirName: "sw-recovery",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Finished iterate whose pointer was pruned",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // NO pointer at all — this is life after Finalize.
    await writeFiles(project.path, {
      "shipwright_events.jsonl": eventsJsonl(),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    footerTranscript(task.sessionUuid, task.cwd);

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // The resolver-driven rail is back — this used to be "No run data yet".
    await expect(page.getByTestId("artifact-link-spec")).toBeVisible();
    await expect(page.getByTestId("artifact-link-commit")).toBeVisible();
    await expect(page.getByTestId("record-rail")).not.toContainText("No run data yet");
  });

  test("a transcript with NO footer stays plain — no guessed identity", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionNoFooter",
      dirName: "sw-no-footer",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "An ordinary conversation",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // The run EXISTS in this project — only this session never ran it.
    await writeFiles(project.path, {
      "shipwright_events.jsonl": eventsJsonl(),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "what does the spec say?" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            // A MENTION is not a claim — inline prose must never be adopted.
            content: [{ type: "text", text: `see decision_log.md (ADR via Run-ID: ${RUN_ID})` }],
          },
        },
      ],
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    await expect(page.getByTestId("record-rail")).toBeVisible();
    await expect(page.getByTestId("artifact-link-spec")).toHaveCount(0);
    await expect(page.getByTestId("artifact-link-commit")).toHaveCount(0);
  });

  test("a pointer naming an UNREGISTERED worktree shows the real rail, not six errors", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionStaleWorktree",
      dirName: "sw-stale-wt",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Finished iterate, worktree removed",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // The directory git no longer registers, left behind by `worktree remove`.
    const stale = join(project.path, ".worktrees", "recovery-e2e");
    mkdirSync(stale, { recursive: true });

    await writeFiles(project.path, {
      "shipwright_events.jsonl": eventsJsonl(),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(
        task.sessionUuid,
        project.path,
        stale,
      ),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    const spec = page.getByTestId("artifact-link-spec");
    await expect(spec).toBeVisible();
    await expect(spec).toHaveAttribute("data-state", "available");
    await expect(page.getByTestId("record-rail")).not.toContainText(
      "not a registered worktree",
    );
  });

  test("a run IN FLIGHT lists its not-yet-written artifacts as pending", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionInFlight",
      dirName: "sw-in-flight",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Iterate that just started",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // A REAL git worktree: `runLive` is git's answer, so a mocked one would only
    // prove the mock agrees with itself (CONTRACT §11).
    const git = (args: string[], cwd: string): void => {
      execFileSync("git", args, { cwd, windowsHide: true, stdio: "ignore" });
    };
    git(["init", "-q", "-b", "main"], project.path);
    git(["config", "user.email", "e2e@example.com"], project.path);
    git(["config", "user.name", "E2E"], project.path);
    writeFileSync(join(project.path, "seed.txt"), "seed\n", "utf-8");
    git(["add", "-A"], project.path);
    git(["commit", "-qm", "seed"], project.path);
    const worktree = join(project.path, ".worktrees", "in-flight");
    git(["worktree", "add", "-q", "-b", "iterate/in-flight", worktree], project.path);

    // Nothing written yet: no spec, no event log — the whole point.
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(
        task.sessionUuid,
        project.path,
        worktree,
      ),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // Visible, plainly worded, and INERT — never a link that opens nothing.
    const spec = page.getByTestId("artifact-link-spec");
    await expect(spec).toBeVisible();
    await expect(spec).toHaveAttribute("data-state", "not_yet_created");
    await expect(spec).toContainText("Not written yet");
    await expect(spec).not.toHaveJSProperty("tagName", "BUTTON");
    await expect(page.getByTestId("artifact-link-commit")).toBeVisible();
  });
});
