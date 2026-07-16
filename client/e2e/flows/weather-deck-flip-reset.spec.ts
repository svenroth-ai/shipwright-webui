/*
 * Weather-Deck .on-photo — the token FLIP holds, and NO text-shadow leaks onto
 * real solid-surface components (bug fix 2026-07-15, FR-01.48).
 *
 * WHY THIS SPEC WAS REWRITTEN. The prior version INJECTED a synthetic
 * `<div class="card">` into the scroller and asserted the rule-2 reset on IT.
 * That hid a shipped bug: no real webui component carries the literal `.card`
 * token — cards render `bg-[var(--color-surface)]`, title bars render
 * `className="page-head"` / `.mc-top`, none of which are in the rule-2
 * `:is(.card, .tcard, …)` reset list. So the reset never matched a real surface,
 * and the INHERITED `.on-photo` legibility text-shadow LEAKED onto every card
 * title, the anthracite title bars and body prose. A synthetic `.card` probe is
 * the one element on the page that DID match the reset, so the old assertion
 * passed while the real UI was shadowed.
 *
 * The fix removed the inherited shadow outright (solid surfaces are reading
 * surfaces → NO text-shadow; legibility over the photo is carried by the scene
 * scrim + the AA contrast ladder, never a per-glyph shadow). This spec now
 * asserts COMPUTED STYLE on REAL rendered components on real routes:
 *   - the token FLIP still renders bare chrome over the photo LIGHT (the flip was
 *     never the bug — it stays asserted, via a bare probe node);
 *   - a real anthracite title bar (.page-head / .mc-top) computes text-shadow
 *     `none`;
 *   - a real task card (bg-[var(--color-surface)], NOT .card) computes
 *     text-shadow `none`.
 *
 * PROOF IT BITES: text-shadow inherits, so restoring `text-shadow: …` on the
 * `.on-photo` root re-fails the title-bar + card rungs here (a real element that
 * sets no shadow of its own inherits the leak). Verified in the iterate ADR.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  cleanupProject,
  cleanupTaskCwd,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "../helpers/fixtures";

function rgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`unparseable colour: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** FLIP (retained): inject a bare-chrome node into the live `.on-photo` scroller
 *  and read its computed colour. The token flip (`--ink: #fff`) is what turns
 *  bare text riding the photo light; that mechanism was never the bug. */
async function bareChromeColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fore = document.querySelector('[data-testid="main-scroll-container"]');
    if (!fore) throw new Error("scene-fore (.on-photo) not found");
    const bare = document.createElement("span");
    bare.style.color = "var(--ink)";
    bare.textContent = "bare";
    fore.appendChild(bare);
    const colour = getComputedStyle(bare).color;
    bare.remove();
    return colour;
  });
}

/** Computed `text-shadow` of a REAL rendered element. text-shadow inherits, so a
 *  leak on the `.on-photo` root surfaces here even though the element itself sets
 *  no shadow — which is exactly why a synthetic-`.card` probe could not catch it. */
function textShadowOf(locator: Locator): Promise<string> {
  return locator.evaluate((node: Element) => getComputedStyle(node).textShadow);
}

test.describe("@smoke Weather-Deck flip holds + NO text-shadow leak on real surfaces (FR-01.48)", () => {
  let project: SeededProject;
  let taskFx: SeededTask;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "Deck",
      dirName: "sw-wd-flip",
      adopted: true,
    });
    taskFx = await seedTask(request, { projectId: project.projectId, title: "Flip probe" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, taskFx);
    await cleanupProject(request, project);
  });

  test("board: bare chrome flips LIGHT; the title bar + a real task card have NO text-shadow", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("scene-backdrop")).toBeVisible({ timeout: 15_000 });

    // INVARIANT: the `.on-photo` ROOT — where the leak lived — carries no shadow.
    // This guards the broad rule (no inherited shadow anywhere) even if a future
    // edit re-adds a root shadow while locally resetting the named surfaces below.
    const fore = page.getByTestId("main-scroll-container");
    await expect(fore).toBeVisible();
    expect(await textShadowOf(fore), ".on-photo root text-shadow must be none").toBe("none");

    // FLIP (retained): bare chrome riding the photo computes to light text.
    const bare = rgb(await bareChromeColour(page));
    expect(bare.every((c) => c >= 240), `bare chrome must be LIGHT, got ${bare}`).toBe(true);

    // NO LEAK on a REAL solid surface — the anthracite title bar (.page-head).
    // This is exactly the surface Sven reported the leak on. `.page-head` is NOT
    // in the rule-2 reset `:is()` list, so before the fix it inherited the shadow.
    const header = page.getByTestId("task-board-header");
    await expect(header).toBeVisible();
    expect(await textShadowOf(header), "title bar text-shadow must be none").toBe("none");

    // NO LEAK on a REAL card — `bg-[var(--color-surface)]`, NOT the literal
    // `.card` token, so the old reset never matched it. This is where the bug
    // lived; the synthetic `.card` probe never rendered a real card.
    const card = page.getByTestId(`task-card-${taskFx.taskId}`);
    await expect(card).toBeVisible();
    expect(await textShadowOf(card), "real task-card text-shadow must be none").toBe("none");
  });

  test("task detail: the same flip + no-leak hold on a second route", async ({ page }) => {
    await page.goto(`/tasks/${taskFx.taskId}`);
    await expect(page.getByTestId("scene-backdrop")).toBeVisible({ timeout: 15_000 });

    const bare = rgb(await bareChromeColour(page));
    expect(bare.every((c) => c >= 240), `bare chrome must be LIGHT, got ${bare}`).toBe(true);

    // The Mission-Control title bar (.mc-top) — a real solid anthracite surface,
    // likewise not in the reset list — must be shadow-free too.
    const mcTop = page.getByTestId("task-detail-header");
    await expect(mcTop).toBeVisible();
    expect(await textShadowOf(mcTop), "mc-top title bar text-shadow must be none").toBe("none");
  });
});
