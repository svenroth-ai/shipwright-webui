/*
 * Decisions from decision-DROPS (FR-01.66, iterate-2026-07-19-mission-decisions-
 * drops-store-honesty).
 *
 * S2 shipped Decisions reading `decision_log.md` only. But an iterate's F3 does
 * not write that file — it writes `decision-drops/<run_id>_NNN.json`, and the
 * ADR number and log entry are assigned later, at release time. So between those
 * two moments the log is empty BY DESIGN and the artifact showed nothing.
 * Measured on this repository: 18 drops on disk, 166 run_ids in the log, ZERO in
 * both — every unreleased run's decision was invisible.
 *
 * These flows drive the real resolver end-to-end over REAL drop files on disk.
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
import { writeFiles } from "../helpers/temp-dir";
import {
  RUN_ID,
  OTHER_RUN_ID,
  decisionLog,
  eventsJsonl,
  pointer,
  seedRepoWithTestChanges,
} from "../helpers/mission-s2-fixtures";

const DROPS = ".shipwright/agent_docs/decision-drops";
/** The iterate document. Without it the Spec artifact legitimately HIDES, so
 *  every scenario seeds it — these flows are about Decisions, not about Spec. */
const MINI_PLAN = `.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`;

function drop(runId: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    run_id: runId,
    date: "2026-07-19",
    section: "Iterate — change",
    title: "Read the drops, not only the aggregated log",
    context: "The log is empty until a release aggregates the drops.",
    decision: "Resolve Decisions from drops union log, deduplicated by run_id.",
    consequences: "A run's decision is visible as soon as it is recorded.",
    rationale: "A source that is empty by design is not evidence of no decision.",
    commit: "",
    architecture_impact: "none",
    ...over,
  });
}

test.describe("Mission Decisions — the unnumbered half of the source", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  async function seed(
    request: Parameters<typeof seedProject>[0],
    name: string,
    dirName: string,
  ): Promise<{ sessionUuid: string; commit: string }> {
    project = await seedProject(request, { name, dirName, adopted: true });
    const commit = seedRepoWithTestChanges(project.path);
    const task = await seedTask(request, { title: name, projectId: project.projectId });
    taskId = task.taskId;
    return { sessionUuid: task.sessionUuid, commit };
  }

  async function openDecisions(page: import("@playwright/test").Page): Promise<void> {
    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
  }

  test("a run whose decision exists ONLY as a drop renders it, unnumbered", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionDropOnly", "sw-drop-only");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# Decisions-drops fixture — the plan.",
      // NO decision_log.md at all — the state of a project that never released.
      [`${DROPS}/${RUN_ID}_001.json`]: drop(RUN_ID),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await openDecisions(page);

    // Before this change the artifact was HIDDEN here: the log was the only
    // source and it was empty, which read as "this run decided nothing".
    await expect(page.getByTestId("artifact-link-decisions")).toBeVisible();
    await page.getByTestId("artifact-link-decisions").click();

    const entries = page.getByTestId("artifact-decision-entry");
    await expect(entries).toHaveCount(1);
    // Real and recorded, but not yet numbered — and no number invented for it.
    await expect(page.getByTestId("artifact-decision-unnumbered")).toContainText(
      "not yet published in a release",
    );
    await expect(entries.first()).toHaveAttribute("data-adr", "");
    await expect(entries.first()).toHaveAttribute("data-source", "drop");
    await expect(page.getByTestId("mission-artifact-panel")).toContainText(
      "Read the drops, not only the aggregated log",
    );
  });

  test("the NUMBERED log entry wins when a run is in both sources", async ({ page, request }) => {
    const { sessionUuid, commit } = await seed(request, "MissionBothSources", "sw-drop-both");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# Decisions-drops fixture — the plan.",
      // Aggregation ran (the log has the ADR) but the drop's unlink failed, so
      // the SAME decision is on disk twice. The drop carries the title the
      // aggregator rendered into the ADR heading — that title is the join.
      ".shipwright/agent_docs/decision_log.md": decisionLog(),
      [`${DROPS}/${RUN_ID}_001.json`]: drop(RUN_ID, {
        title: "Read the review state from the external markers",
      }),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await openDecisions(page);
    await page.getByTestId("artifact-link-decisions").click();

    const entries = page.getByTestId("artifact-decision-entry");
    await expect(entries).toHaveCount(1);
    // The numbered record wins; the same decision must not appear twice under
    // two different identities.
    await expect(entries.first()).toHaveAttribute("data-adr", "ADR-900");
    await expect(entries.first()).toHaveAttribute("data-source", "decision_log");
    await expect(page.getByTestId("artifact-decision-unnumbered")).toHaveCount(0);
  });

  test("a PARTIALLY folded run shows the published AND the still-pending decision", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionPartialFold", "sw-drop-partial");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# Decisions-drops fixture — the plan.",
      // The log holds ADR-900 ("Read the review state from the external
      // markers"); this drop is a DIFFERENT decision that no release folded in.
      ".shipwright/agent_docs/decision_log.md": decisionLog(),
      [`${DROPS}/${RUN_ID}_002.json`]: drop(RUN_ID, { title: "Still pending decision" }),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await openDecisions(page);
    await page.getByTestId("artifact-link-decisions").click();

    // The run-level short-circuit rendered ONLY the numbered entry here, and
    // the second decision disappeared with no disclosure at all.
    await expect(page.getByTestId("artifact-decision-entry")).toHaveCount(2);
    await expect(page.getByTestId("artifact-decision-unnumbered")).toHaveCount(1);

    const panel = page.getByTestId("mission-artifact-panel");
    await expect(panel).toContainText("Read the review state from the external markers");
    await expect(panel).toContainText("Still pending decision");
  });

  test("another run's drop never leaks into this run's Decisions", async ({ page, request }) => {
    const { sessionUuid, commit } = await seed(request, "MissionDropIsolation", "sw-drop-iso");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# Decisions-drops fixture — the plan.",
      [`${DROPS}/${RUN_ID}_001.json`]: drop(RUN_ID, { title: "Ours" }),
      [`${DROPS}/${OTHER_RUN_ID}_001.json`]: drop(OTHER_RUN_ID, { title: "A concurrent run's" }),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await openDecisions(page);
    await page.getByTestId("artifact-link-decisions").click();

    await expect(page.getByTestId("artifact-decision-entry")).toHaveCount(1);
    const panel = page.getByTestId("mission-artifact-panel");
    await expect(panel).toContainText("Ours");
    await expect(panel).not.toContainText("A concurrent run's");
  });

  test("a malformed drop is disclosed, and never hides the valid one", async ({ page, request }) => {
    const { sessionUuid, commit } = await seed(request, "MissionDropMalformed", "sw-drop-bad");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# Decisions-drops fixture — the plan.",
      [`${DROPS}/${RUN_ID}_001.json`]: drop(RUN_ID, { title: "Survives" }),
      [`${DROPS}/${RUN_ID}_002.json`]: "{ half-written",
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await openDecisions(page);
    await page.getByTestId("artifact-link-decisions").click();

    await expect(page.getByTestId("artifact-decision-entry")).toHaveCount(1);
    await expect(page.getByTestId("mission-artifact-panel")).toContainText("Survives");
    // The damaged record must not vanish just because a good one rendered.
    await expect(page.getByTestId("artifact-decisions-malformed")).toContainText(
      "could not be read",
    );
  });

  test("a run with NO drop and NO log entry hides — an absence may be one", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionNoDecisions", "sw-drop-none");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# Decisions-drops fixture — the plan.",
      // Only a CONCURRENT run's drop exists, so this run genuinely has none.
      [`${DROPS}/${OTHER_RUN_ID}_001.json`]: drop(OTHER_RUN_ID),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await openDecisions(page);

    // The other five artifacts still resolve; only Decisions is absent, and it
    // is allowed to be — nothing failed to read.
    await expect(page.getByTestId("artifact-link-spec")).toBeVisible();
    await expect(page.getByTestId("artifact-link-decisions")).toHaveCount(0);
  });
});
