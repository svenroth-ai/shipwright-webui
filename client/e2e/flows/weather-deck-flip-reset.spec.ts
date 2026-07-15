/*
 * Weather-Deck .on-photo FLIP + solid-surface RESET (A03, FR-01.48, AC2).
 *
 * A reset that silently stops applying is invisible in a screenshot review and
 * lethal in a repaint: bare chrome would go light-on-photo AND the cards would
 * inherit the photo treatment (white-on-white). So we assert the cascade as
 * COMPUTED STYLE on real routes:
 *
 *   - bare chrome inside `.scene-fore.on-photo` computes to LIGHT text and keeps
 *     the inherited legibility text-shadow;
 *   - text inside a `.card` on the SAME route resets to DARK and the card's
 *     text-shadow is `none`.
 *
 * The probes are appended into the live `.on-photo` container so they exercise
 * the real ported cascade (the current pages predate the .card token system).
 */
import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "../helpers/fixtures";

interface Flip {
  bareColor: string;
  bareShadow: string;
  cardColor: string;
  cardShadow: string;
}

/** Inject a bare-chrome node and a `.card`-descendant node into the on-photo
 *  scroller, then read their computed styles. */
async function probeFlip(page: import("@playwright/test").Page): Promise<Flip> {
  return page.evaluate(() => {
    const fore = document.querySelector('[data-testid="main-scroll-container"]');
    if (!fore) throw new Error("scene-fore (.on-photo) not found");
    const bare = document.createElement("span");
    bare.style.color = "var(--ink)";
    bare.textContent = "bare";
    const card = document.createElement("div");
    card.className = "card";
    const inner = document.createElement("span");
    inner.style.color = "var(--body)";
    inner.textContent = "card";
    card.appendChild(inner);
    fore.appendChild(bare);
    fore.appendChild(card);
    const r = {
      bareColor: getComputedStyle(bare).color,
      bareShadow: getComputedStyle(bare).textShadow,
      cardColor: getComputedStyle(inner).color,
      cardShadow: getComputedStyle(card).textShadow,
    };
    bare.remove();
    card.remove();
    return r;
  });
}

function rgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`unparseable colour: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function assertFlip(flip: Flip) {
  const bare = rgb(flip.bareColor);
  const card = rgb(flip.cardColor);
  expect(bare.every((c) => c >= 240), `bare chrome must be LIGHT, got ${flip.bareColor}`).toBe(true);
  expect(card.every((c) => c <= 90), `card text must be DARK (reset), got ${flip.cardColor}`).toBe(true);
  expect(flip.cardShadow, "card text-shadow must be cancelled by the reset").toBe("none");
  expect(flip.bareShadow, "bare chrome keeps the inherited legibility shadow").not.toBe("none");
}

test.describe("@smoke Weather-Deck flip + reset (AC2)", () => {
  let project: SeededProject;
  let taskFx: SeededTask;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Deck", dirName: "sw-wd-flip" });
    taskFx = await seedTask(request, { projectId: project.projectId, title: "Flip probe" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskFx);
    await cleanupProject(request, project);
  });

  test("board: bare chrome is light, .card text is dark, card shadow cancelled", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("scene-backdrop")).toBeVisible({ timeout: 15_000 });
    assertFlip(await probeFlip(page));
  });

  test("task detail: the same flip + reset hold on a second route", async ({ page }) => {
    await page.goto(`/tasks/${taskFx.taskId}`);
    await expect(page.getByTestId("scene-backdrop")).toBeVisible({ timeout: 15_000 });
    assertFlip(await probeFlip(page));
  });
});
