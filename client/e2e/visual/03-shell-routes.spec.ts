/*
 * Visual baselines — the remaining routes that exist today. A00, AC1 + AC4.
 *
 * projects · inbox · triage · settings · diagnostics (client/src/router.tsx).
 * Each is captured with the same seeded project active, so the sidebar chrome —
 * which the campaign also repaints — is inside every baseline, not just the
 * page body.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { settle } from "./stabilize";

/** Route id (== baseline filename, per the manifest) -> path + a landmark to await. */
const SHELL_ROUTES = [
  { id: "projects", path: "/projects", ready: /projects/i },
  { id: "inbox", path: "/inbox", ready: /inbox/i },
  { id: "triage", path: "/triage", ready: /triage/i },
  { id: "settings", path: "/settings", ready: /settings/i },
  { id: "diagnostics", path: "/diagnostics", ready: /diagnostics/i },
] as const;

test.describe("visual: shell routes", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  for (const route of SHELL_ROUTES) {
    test(route.id, async ({ page }) => {
      await page.goto(route.path);
      // Anchor on the route's own heading so we never shoot a half-rendered
      // page — a baseline containing a spinner is a baseline that can only be
      // matched by reproducing the spinner.
      await expect(
        page.getByRole("heading", { name: route.ready }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await settle(page);

      await expect(page).toHaveScreenshot(`${route.id}.png`, { fullPage: true });
    });
  }
});
