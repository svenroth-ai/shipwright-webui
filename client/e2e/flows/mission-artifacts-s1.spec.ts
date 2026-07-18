/*
 * S1 — Mission artifacts for a STANDALONE ITERATE
 * (campaign 2026-07-18-mission-artifacts; FR-01.66).
 *
 * The bug this slice fixes: a standalone iterate showed a standing "No run data
 * yet" because every Mission data path joined on `task.runId`, which an iterate
 * never has. These flows drive the real resolver end-to-end through seeded
 * fixtures — a real `.shipwright/iterate_active/<sessionUuid>.json` pointer, a
 * real spec document, and a real `work_completed` row.
 *
 * Seeded fixtures only, never operator UUIDs. The pointer's `session_id` MUST
 * be the task's SERVER-GENERATED sessionUuid and its `main_root` MUST be the
 * seeded project dir — the resolver rejects the pointer otherwise (§5.1), which
 * is itself asserted in the last case.
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

const RUN_ID = "iterate-2026-07-18-mission-e2e";

/** The iterate spec the resolver resolves from the KNOWN layout. */
const SPEC_DOC = `# Mission artifacts — E2E fixture

This iterate touches FR-01.66 (the Mission view) and nothing else.

## Affected Boundaries

The mission-context resolver response shape.
`;

/** A finalized run: work_completed keyed \`adr_id == run_id\`. */
function eventsJsonl(): string {
  return (
    JSON.stringify({
      id: "evt-e2e-0001",
      type: "work_completed",
      ts: "2026-07-18T12:00:00Z",
      adr_id: RUN_ID,
      commit: "abc1234def5678",
      summary: "Wire the Mission tab to the iterate resolver.",
      spec_impact: "modify",
      // A FOLDED id on purpose: the rail must display its surviving parent.
      affected_frs: ["FR-01.44"],
      tests: { passed: 12, total: 12 },
    }) + "\n"
  );
}

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-e2e",
    branch: "iterate/mission-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-07-18T10:00:00Z",
  });
}

test.describe("S1 — Mission artifacts for a standalone iterate", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("a LIVE iterate shows Spec + Requirement, and never 'No run data yet' (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionS1Live",
      dirName: "sw-s1-live",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Resolve the mission artifacts",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // The bridge + the spec, exactly where the producer writes them.
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(
        task.sessionUuid,
        project.path,
      ),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // The rail is the resolver's, not the legacy one.
    await expect(page.getByTestId("artifact-link-spec")).toBeVisible();
    await expect(page.getByTestId("artifact-link-requirement")).toBeVisible();

    // Mid-run there is no commit — hide-empty removes it entirely.
    await expect(page.getByTestId("artifact-link-commit")).toHaveCount(0);

    // The regression this whole slice exists to kill.
    await expect(page.getByTestId("record-rail")).not.toContainText("No run data yet");
  });

  test("clicking Spec opens summary-over-document, and Esc closes it (AC3)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionS1Doc",
      dirName: "sw-s1-doc",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Open the spec artifact",
      projectId: project.projectId,
    });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(
        task.sessionUuid,
        project.path,
      ),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    await page.getByTestId("artifact-link-spec").click();
    const panel = page.getByTestId("mission-artifact-panel");
    await expect(panel).toBeVisible();

    // Region 1 (summary) and region 2 (the rendered document) are BOTH present,
    // and the document body is the real file the resolver read.
    await expect(page.getByTestId("artifact-summary")).toBeVisible();
    await expect(page.getByTestId("artifact-doc-body")).toContainText(
      "Mission artifacts — E2E fixture",
    );

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("a FINALIZED iterate shows fold-resolved FRs + the commit (AC2)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionS1Done",
      dirName: "sw-s1-done",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Finalized iterate",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(
        task.sessionUuid,
        project.path,
      ),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
      "shipwright_events.jsonl": eventsJsonl(),
      // A minimal Fold-Map so FR-01.44 resolves to its surviving parent.
      ".shipwright/planning/01-adopted/spec.md": [
        "| ID | Area | Name | Priority | Description | Origin |",
        "|----|------|------|----------|-------------|--------|",
        "| FR-01.28 | TRM | Embedded terminal | Must | A real terminal | x |",
        "",
        "## FR-Fold-Map",
        "",
        "| `FR-01.44` | `FR-01.28` | delta | Embedded terminal appearance |",
        "",
      ].join("\n"),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // The commit artifact now exists (the run completed).
    await expect(page.getByTestId("artifact-link-commit")).toBeVisible();

    // The Requirement rail shows the SURVIVING parent, not the folded id.
    const requirement = page.getByTestId("artifact-link-requirement");
    await expect(requirement).toBeVisible();
    await expect(requirement).toContainText("FR-01.28");

    // …and the detail keeps the provenance of where it came from.
    await requirement.click();
    await expect(page.getByTestId("artifact-req-rows")).toContainText("mapped from FR-01.44");

    await expect(page.getByTestId("record-rail")).not.toContainText("No run data yet");
  });

  test("a pointer bound to ANOTHER session never resurrects Mission (AC5)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionS1Stale",
      dirName: "sw-s1-stale",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Stale pointer task",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    // A pointer whose session_id belongs to a DIFFERENT session — the exact
    // stale-pointer case §5.1(a) rejects. The filename matches this task so the
    // file IS found; only the binding check saves us.
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: JSON.stringify({
        run_id: RUN_ID,
        slug: "mission-e2e",
        main_root: project.path,
        session_id: "00000000-0000-4000-8000-000000000000",
        created_at: "2026-07-18T10:00:00Z",
      }),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // No resolver rail — the session falls back to the legacy Record rail.
    await expect(page.getByTestId("artifact-link-spec")).toHaveCount(0);
    await expect(page.getByTestId("record-node-spec")).toBeVisible();
  });
});
