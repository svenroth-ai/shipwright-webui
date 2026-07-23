/*
 * Mission viewer — internal scroll + pop-out
 * (iterate-2026-07-23-mission-viewer-scroll-popout).
 *
 * The defect: the Mission tab's right artifact card did not scroll — a long
 * Requirement / Spec pushed the whole page instead, because `.mc-body`'s
 * `flex:1; min-height:0` was inert under a bare-block wrapper, so the shell
 * scroller (`.scene-fore` / `main-scroll-container`) took the overflow. This
 * drives the real resolver (same seeded fixtures as mission-artifacts-s1) with a
 * DELIBERATELY LONG spec document and asserts, in a real browser:
 *   - the artifact card scrolls INTERNALLY (scrollHeight > clientHeight),
 *   - the shell scroller does NOT scroll (scrollHeight ≈ clientHeight),
 *   - "Pop out" opens a viewport-centered modal showing the same document,
 *   - ESC + the close X dismiss the modal, and the panel stays open (AC4).
 *
 * jsdom cannot measure any of this geometry — it must be a real browser
 * (the "jsdom can't see layout" rule). Seeded fixtures only, never operator UUIDs.
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

const RUN_ID = "iterate-2026-07-23-mission-scroll-e2e";

/** A spec long enough that its rendered body overflows the ~540px card at 1280×720. */
const LONG_SPEC = [
  "# Mission viewer — long spec fixture",
  "",
  "This iterate touches FR-01.66 (the Mission view) and nothing else.",
  "",
  ...Array.from(
    { length: 160 },
    (_, i) =>
      `${i + 1}. Requirement line ${i + 1} — the reader must be able to scroll ` +
      "the card itself to reach this, without the whole page moving.",
  ),
].join("\n");

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-scroll-e2e",
    branch: "iterate/mission-scroll-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-07-23T10:00:00Z",
  });
}

test.describe("Mission viewer — internal scroll + pop-out", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("the card scrolls internally, the page does not, and Pop out opens a centered modal", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, {
      name: "MissionScroll",
      dirName: "sw-mission-scroll",
      adopted: true,
    });
    const task = await seedTask(request, {
      title: "Read the long spec",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(
        task.sessionUuid,
        project.path,
      ),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: LONG_SPEC,
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // Open the Spec artifact — the resolver's rail, not the legacy one.
    await page.getByTestId("artifact-link-spec").click();
    const panel = page.getByTestId("mission-artifact-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("artifact-doc-body")).toContainText(
      "Mission viewer — long spec fixture",
    );

    // --- AC1: the CARD scrolls, the PAGE does not ---------------------------
    const cardScroll = await panel.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    }));
    // The long body overflows the fixed-height card.
    expect(cardScroll.scrollH).toBeGreaterThan(cardScroll.clientH + 50);

    const shell = page.getByTestId("main-scroll-container");
    const shellScroll = await shell.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    }));
    // The shell scroller must NOT have grown past its viewport — the whole
    // point of the fix. A few px of sub-pixel rounding is tolerated.
    expect(shellScroll.scrollH).toBeLessThanOrEqual(shellScroll.clientH + 4);

    // …and the card can actually be scrolled (not merely clipped).
    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // --- AC2/AC3: Pop out opens a viewport-centered modal -------------------
    const popout = page.getByTestId("artifact-popout");
    await expect(popout).toBeVisible();
    await popout.click();

    const modal = page.getByTestId("mission-artifact-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("mission-artifact-modal-label")).toHaveText("Spec");
    await expect(modal.getByTestId("artifact-doc-body")).toContainText(
      "Mission viewer — long spec fixture",
    );

    // Portalled to body → centered on the VIEWPORT, not the 400px card.
    const box = await modal.boundingBox();
    const vw = page.viewportSize();
    expect(box).not.toBeNull();
    expect(vw).not.toBeNull();
    if (box && vw) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      expect(Math.abs(cx - vw.width / 2)).toBeLessThan(8);
      expect(Math.abs(cy - vw.height / 2)).toBeLessThan(8);
    }

    // The modal body has its own scroll for the long document.
    const modalBody = page.getByTestId("mission-artifact-modal-body");
    const bodyScroll = await modalBody.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    }));
    expect(bodyScroll.scrollH).toBeGreaterThan(bodyScroll.clientH + 50);
    // …and it actually scrolls (not merely clipped) — the AC3 "own internal
    // scroll" requirement, distinguished from a clipped `overflow:hidden` body.
    await modalBody.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await modalBody.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // --- AC4: ESC closes the modal, the panel stays open --------------------
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(panel).toBeVisible();

    // Re-open, then close via the X.
    await popout.click();
    await expect(modal).toBeVisible();
    await page.getByTestId("mission-artifact-modal-close").click();
    await expect(modal).toBeHidden();
    await expect(panel).toBeVisible();

    // Re-open, then close via a BACKDROP click (AC3) — a point on the overlay
    // outside the centered content. The panel stays open behind it.
    await popout.click();
    await expect(modal).toBeVisible();
    await page.mouse.click(6, 6);
    await expect(modal).toBeHidden();
    await expect(panel).toBeVisible();
  });
});
