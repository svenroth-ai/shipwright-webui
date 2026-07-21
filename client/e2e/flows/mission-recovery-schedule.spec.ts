/*
 * The recovered rail SURVIVES repeated polls
 * (iterate-2026-07-21-mission-recovery-memo-perf; FR-01.66).
 *
 * This run made the mission-context endpoint stop re-reading a 1 MB transcript
 * tail on every poll: the wide "reach-back" window is now requested once per
 * task and then only when the transcript has changed. Measured on the real
 * machine, the old rule was permanent for 412 of 419 tasks over transcripts 78 %
 * of which exceed 1 MB.
 *
 * The risk that buys is precise and worth an END-TO-END gate: a window that
 * narrows could serve the rail on the first view and lose it on the next. The
 * unit tests observe byte budgets against a test double; only this exercises the
 * real `wire.ts` → `SessionWatcher` path that computes the revision the schedule
 * is keyed on — the one composition no unit test covers.
 *
 * Fixtures only, never operator UUIDs; the transcript seeder self-locks to an
 * isolated temp HOME.
 *
 * @covers FR-01.66
 */

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

const RUN_ID = "iterate-2026-07-21-schedule-e2e";

const SPEC_DOC = `# Reach-back schedule — E2E fixture

This iterate touches FR-01.66 (the Mission view).

## Affected Boundaries

The mission-context read schedule.
`;

/** A finalized run — the corroboration the transcript recovery requires. */
function eventsJsonl(): string {
  return `${JSON.stringify({
    id: "evt-schedule-0001",
    type: "work_completed",
    ts: "2026-07-21T12:00:00Z",
    adr_id: RUN_ID,
    commit: "beef1234cafe5678",
    summary: "Pay the transcript scan once per task, not once per poll.",
    spec_impact: "none",
    affected_frs: ["FR-01.66"],
    tests: { passed: 11, total: 11 },
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
                "perf(mission): pay the transcript scan once per task",
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

test.describe("Mission — the reach-back schedule keeps the rail", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("a recovered rail is still there on the SECOND and THIRD read", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionSchedule",
      dirName: "sw-schedule",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Finished iterate, viewed more than once",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // No pointer — life after Finalize, so only the footer can identify the run.
    await writeFiles(project.path, {
      "shipwright_events.jsonl": eventsJsonl(),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    footerTranscript(task.sessionUuid, task.cwd);

    await setActiveProject(page, project.projectId);

    // Read 1 — the reach-back finds the footer and the association is persisted.
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("artifact-link-spec")).toBeVisible();
    await expect(page.getByTestId("artifact-link-commit")).toBeVisible();

    // Reads 2 and 3 — served from the ordinary window now. If the narrowing were
    // wrong, THIS is where the rail would collapse back to "No run data yet".
    for (let view = 0; view < 2; view++) {
      await page.reload();
      await page.getByTestId("mission-tab-mission").click();
      await expect(page.getByTestId("artifact-link-spec")).toBeVisible();
      await expect(page.getByTestId("artifact-link-commit")).toBeVisible();
      await expect(page.getByTestId("record-rail")).not.toContainText("No run data yet");
    }
  });

  test("a session with no footer stays plain across repeated reads", async ({ page, request }) => {
    project = await seedProject(request, {
      name: "MissionSchedulePlain",
      dirName: "sw-schedule-plain",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "An ordinary conversation, viewed twice",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    await writeFiles(project.path, { "shipwright_events.jsonl": eventsJsonl() });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [{ type: "user", message: { role: "user", content: "what does this repo do?" } }],
    });

    await setActiveProject(page, project.projectId);

    // The narrowed window must not turn "we found nothing" into a guess on the
    // second look either — no rail, both times.
    for (let view = 0; view < 2; view++) {
      await page.goto(`/tasks/${taskId}`);
      await page.getByTestId("mission-tab-mission").click();
      await expect(page.getByTestId("artifact-link-spec")).toHaveCount(0);
      await expect(page.getByTestId("artifact-link-commit")).toHaveCount(0);
    }
  });
});
