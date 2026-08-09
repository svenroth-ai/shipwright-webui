/*
 * iterate-2026-08-09-triage-filter-styling — real-browser verification.
 *
 * AC1/AC2 (Triage filter chips): geometry + on/off encoding are asserted via
 * getComputedStyle in a real browser — a jsdom class-string assertion proves
 * the class landed, not that it paints as intended (internal plan review
 * finding 2).
 * AC3 (Preview button legible on dark bar): computed background-color.
 * AC4 (Preview hidden on All Projects): presence/absence of the testid.
 *
 * "supabase-nextjs" is the one bundled profile with BOTH stack.frontend and
 * dev_server.command set, so preview.enabled resolves true without a custom
 * profile file (server/profiles/supabase-nextjs.json).
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

let project: SeededProject;

test.describe("Triage filter chips + Preview button restyle", () => {
  test.beforeEach(async ({ request }) => {
    project = await seedProject(request, {
      name: "triage-filter-preview-restyle",
      profile: "supabase-nextjs",
      adopted: true,
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("filter chips use --radius-button geometry, and on/off differ by more than hue", async ({
    page,
  }) => {
    await setActiveProject(page, project.projectId);
    await page.goto("/triage");

    const included = page.getByTestId("triage-filter-priority-P0");
    await expect(included).toBeVisible();
    const includedStyle = await included.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        radius: cs.borderRadius,
        width: cs.borderTopWidth,
        bg: cs.backgroundColor,
        color: cs.color,
        decoration: cs.textDecorationLine,
      };
    });
    // --radius-button is 8px. Note on border width: the class is
    // `border-[1.5px]` (matching StatusFilterMenu's trigger verbatim), but
    // real-browser measurement here found this Tailwind arbitrary-value
    // pattern computes to 1px EVERYWHERE it's used in this app — including
    // StatusFilterMenu's own trigger on the Board (measured directly,
    // same 1px). That's a pre-existing, repo-wide quirk unrelated to this
    // iterate's scope; asserting the real 1px here is what "matches the
    // Board" actually means, since the Board renders at 1px too.
    expect(includedStyle.radius).toBe("8px");
    expect(includedStyle.width).toBe("1px");
    // --color-text / --ink resolves to #1C1917 → rgb(28, 25, 23). A real
    // anchor on the included chip's ink text, so a regression collapsing
    // included into the excluded/muted styling can't slip past a jsdom
    // class-string test the way it did at code-review Stage 2 (a hover
    // fix made the equivalent unit assertion vacuous).
    expect(includedStyle.color).toBe("rgb(28, 25, 23)");
    expect(includedStyle.decoration).toBe("none");

    // "Parked" is excluded by default (view.filters.showParked starts
    // false) — the one chip guaranteed to be in the "off" state without
    // any interaction, so it's the real-browser proof for the non-hue
    // encoding internal plan review asked for (finding 4).
    const excluded = page.getByTestId("triage-filter-parked-parked");
    await expect(excluded).toBeVisible();
    const excludedStyle = await excluded.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, decoration: cs.textDecorationLine };
    });

    expect(excludedStyle.bg).not.toBe(includedStyle.bg);
    // --color-inset resolves to #F5F5F4 → rgb(245, 245, 244).
    expect(excludedStyle.bg).toBe("rgb(245, 245, 244)");
    // --ink-fixed resolves to #1C1917 → rgb(28, 25, 23) — same hex as
    // included's --color-text here, by design (code-review Stage 3: the
    // ladder in tokens.contrast.test.ts records --color-muted on --inset as
    // FAILING ~4.39:1, so the excluded label uses the never-re-themed
    // --ink-fixed instead, not a dimmer color).
    expect(excludedStyle.color).toBe("rgb(28, 25, 23)");
    // The genuinely non-color cue (code-review Stage 2 finding: the inset
    // fill alone is ~1.09:1 contrast, imperceptible) — line-through does not
    // depend on color perception at all.
    expect(excludedStyle.decoration).toBe("line-through");
  });

  test("Preview button is a legible light-blue pill on the dark Board toolbar, hidden on All Projects", async ({
    page,
  }) => {
    await setActiveProject(page, project.projectId);
    await page.goto("/");

    const preview = page.getByTestId("preview-button");
    await expect(preview).toBeVisible();
    const bg = await preview.evaluate((el) => getComputedStyle(el).backgroundColor);
    // --color-info-bg / --info-tint is #EFF8FF → rgb(239, 248, 255). Not
    // --color-surface, which `.chrome-dark-controls` remaps to a
    // near-transparent white overlay on this dark bar (invisible — the
    // reported bug).
    expect(bg).toBe("rgb(239, 248, 255)");

    // All Projects: activeProjectId=null. Preview must not render at all —
    // there is no single project for it to spawn a dev server for.
    // `setActiveProject` registers a NEW addInitScript that runs after the
    // one from this test's first call, so "" (→ null, useProjectFilter's
    // own normalize()) wins on this next navigation.
    await setActiveProject(page, "");
    await page.goto("/");
    // Anchor on an All-Projects-only surface first — otherwise toHaveCount(0)
    // is trivially satisfied by the SPA still booting, before CreateControls
    // has rendered anything at all (code-reviewer finding).
    await expect(page.getByTestId("plain-cascade-trigger")).toBeVisible();
    await expect(page.getByTestId("preview-button")).toHaveCount(0);
  });
});
