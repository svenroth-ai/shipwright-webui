/*
 * Mission Tests artifact + Record rail — a POST-reversal `skipped` run renders
 * as genuinely green (iterate-2026-08-08-tests-total-skip-contract).
 *
 * `passed:9, total:10, skipped:1` is the exact regression shape this run
 * exists to fix: numerically `passed !== total`, but under the new convention
 * (`total` = collected) it is a genuinely green run — `deriveTestsGate`
 * resolves it server-side and every consumer must render it as such, never
 * fall back to the old `passed === total` reading. Real browser, real
 * resolver, real event log — proves the whole chain end to end.
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
import { seedRepoWithTestChanges } from "../helpers/mission-s2-fixtures";

const RUN_ID = "iterate-2026-08-08-mission-skipped-gate-e2e";

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-skipped-gate-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-08-08T10:00:00Z",
  });
}

/** POST-reversal (>= 2026-08-08T00:00:00Z): `total` = collected. */
function eventsJsonl(commit: string): string {
  return (
    JSON.stringify({
      id: "evt-skipped-gate-e2e-0001",
      type: "work_completed",
      ts: "2026-08-08T12:00:00Z",
      adr_id: RUN_ID,
      commit,
      summary: "A run with one host-gated skip, genuinely green.",
      spec_impact: "modify",
      affected_frs: ["FR-01.66"],
      tests: { passed: 9, total: 10, skipped: 1 },
    }) + "\n"
  );
}

test.describe("Mission — POST-reversal skipped run reads as genuinely green", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("the artifact link + detail headline both read genuinely green", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionSkippedGate",
      dirName: "sw-skipped-gate",
      adopted: true,
    });
    const commit = seedRepoWithTestChanges(project.path);
    const task = await seedTask(request, { title: "MissionSkippedGate", projectId: project.projectId });
    taskId = task.taskId;

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: "# Skipped-gate E2E fixture\n",
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // The top Instruments chip renders the honest raw count — never masked
    // by the green verdict.
    await expect(page.getByTestId("instr-tests")).toContainText("9/10");

    // The artifact-link receipt is the honest count too (9/10 passing), not a
    // green claim by itself.
    const link = page.getByTestId("artifact-link-tests");
    await expect(link).toBeVisible();
    await expect(link).toContainText("9/10 passing");

    // The detail headline discloses the skip rather than rounding up to "All
    // 10 tests passing" — that would overstate what ran, right next to the
    // honest "9/10" receipt above (code review, MEDIUM). The gate still
    // decides that this is a PASS phrasing, not a "9 of 10" that would read
    // identically to a real failure.
    await page.getByTestId("artifact-link-tests").click();
    const result = page.getByTestId("artifact-tests-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("9 of 10 tests passing (1 skipped)");
  });
});
