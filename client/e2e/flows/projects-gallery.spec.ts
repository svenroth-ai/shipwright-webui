/*
 * projects-gallery.spec.ts — A15 (campaign webui-wow-usability-2026-07-10,
 * FR-01.59). The Projects registry now renders as a Ship's-Log GALLERY of
 * preview cards instead of a table. This drives the three real states through a
 * real browser + the real API:
 *
 *   - a GRADED project (a `shipwright_events.jsonl` with completed runs → A02
 *     returns runCount > 0) renders the sparkline + stats + last-proof quote;
 *   - an UNGRADED project (registered, no run history) renders the honest
 *     ".lc-empty" sentence and NO sparkline;
 *   - the graded card sorts BEFORE the ungraded one (graded-first);
 *   - "Open board" routes through openProjectLog() to the interim board
 *     destination (/?projectId=…) — the surface that exists TODAY (A16 will
 *     re-point it at /projects/:id/log).
 *
 * No hardcoded ports, no operator UUIDs — everything is seeded and read back
 * through helpers/fixtures.ts (A00).
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  type SeededProject,
} from "../helpers/fixtures";

// Two completed runs so runCount = 2 and the sparkline has real (test-ratio)
// points. The most-recent (by ts) summary becomes the last-proof quote.
const EVENTS_JSONL =
  [
    JSON.stringify({
      type: "work_completed",
      adr_id: "iterate-2026-07-01-gallery-a",
      ts: "2026-07-01T10:00:00Z",
      summary: "Older gallery run",
      commit: "aaa1110",
      spec_impact: "add",
      affected_frs: ["FR-01.01"],
      tests: { passed: 8, total: 10 },
    }),
    JSON.stringify({
      type: "work_completed",
      adr_id: "iterate-2026-07-05-gallery-b",
      ts: "2026-07-05T10:00:00Z",
      summary: "The most recent proof quote",
      commit: "bbb2220",
      spec_impact: "modify",
      affected_frs: ["FR-01.02"],
      tests: { passed: 12, total: 12 },
    }),
  ].join("\n") + "\n";

test.describe("Projects → Ship's-Log gallery (A15)", () => {
  let graded: SeededProject;
  let ungraded: SeededProject;

  test.beforeEach(async ({ request }) => {
    graded = await seedProject(request, {
      name: "Gallery Graded",
      adopted: true,
      files: { "shipwright_events.jsonl": EVENTS_JSONL },
    });
    ungraded = await seedProject(request, {
      name: "Gallery Ungraded",
      adopted: true,
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, graded);
    await cleanupProject(request, ungraded);
  });

  test("graded body shows sparkline + stats + proof; ungraded shows the empty sentence; graded sorts first", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(page.getByTestId("projects-gallery")).toBeVisible();

    const gradedCard = page.getByTestId(`projects-card-${graded.projectId}`);
    const ungradedCard = page.getByTestId(`projects-card-${ungraded.projectId}`);
    await expect(gradedCard).toBeVisible();
    await expect(ungradedCard).toBeVisible();

    // GRADED body — real sparkline + stats + last-proof quote from A02.
    await expect(gradedCard.getByTestId("lc-spark")).toBeVisible();
    await expect(
      page.getByTestId(`projects-card-${graded.projectId}-stats`),
    ).toContainText("2 runs");
    await expect(gradedCard).toContainText("The most recent proof quote");

    // UNGRADED body — the honest sentence, and NO sparkline.
    await expect(
      page.getByTestId(`projects-card-${ungraded.projectId}-empty`),
    ).toContainText("No runs yet");
    await expect(ungradedCard.getByTestId("lc-spark")).toHaveCount(0);

    // Graded-first: the graded card precedes the ungraded card in the DOM.
    const gradedFirst = await page.evaluate(
      ([g, u]) => {
        const gEl = document.querySelector(`[data-testid="projects-card-${g}"]`);
        const uEl = document.querySelector(`[data-testid="projects-card-${u}"]`);
        if (!gEl || !uEl) return null;
        return (
          (uEl.compareDocumentPosition(gEl) &
            Node.DOCUMENT_POSITION_PRECEDING) !==
          0
        );
      },
      [graded.projectId, ungraded.projectId],
    );
    expect(gradedFirst).toBe(true);
  });

  test("'Open log' routes through the single seam to the Ship's Log home (/projects/:id/log)", async ({
    page,
  }) => {
    // A16 re-pointed openProjectLog() from the interim board destination
    // (/?projectId=…) to the real Ship's Log home. This spec was stale — it
    // still asserted the interim board URL (fixed 2026-07-17 alongside the
    // ship-log iterate).
    await page.goto("/projects");
    await page.getByTestId(`projects-open-${graded.projectId}`).click();
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/projects/${graded.projectId}/log`);
  });
});
