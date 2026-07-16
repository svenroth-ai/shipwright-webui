/*
 * Visual baselines — the Intent Wizard (A08, FR-01.51). Three entry screens:
 *   /wizard        — the door picker (readiness pinned READY so the shot is not
 *                    hostage to whatever tools the CI runner happens to have)
 *   /wizard/adopt  — step 1, the repo pick (adopt)
 *   /wizard/grade  — step 1, the repo pick (grade)
 *
 * The wizard renders STUB data (Spec/prototype-derived), so every pixel here is
 * deterministic and independent of the developer's machine — AC6 provenance
 * honesty. The readiness probe is the one machine-dependent input, so it is
 * intercepted to a fixed READY payload; the not-ready gate is covered by the
 * unit suite, not a screenshot.
 *
 * These routes are `pending` in routes.ts until CI writes the first baseline
 * (the visual gate uploads it as `visual-baselines`); the owning PR then commits
 * the PNGs and flips them to `baselined`.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { settle } from "./stabilize";

const READY = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [
    { key: "claude", label: "Claude CLI", ok: true, detail: "2.1.9", why: "", critical: true },
    { key: "plugins", label: "Shipwright plugins", ok: true, detail: "8 installed", why: "", critical: true },
    { key: "cache", label: "Plugin cache", ok: true, detail: "shared/ present", why: "", critical: true },
    { key: "uv", label: "uv", ok: true, detail: "0.5.11", why: "", critical: true },
    { key: "python", label: "Python", ok: true, detail: "3.13 (python3)", why: "", critical: true },
    { key: "git", label: "git", ok: true, detail: "2.47", why: "", critical: true },
  ],
};

const WIZARD_ROUTES = [
  { id: "wizard", path: "/wizard", ready: /What do you want to do\?/i },
  { id: "wizard-adopt", path: "/wizard/adopt", ready: /Where does the repo live\?/i },
  { id: "wizard-grade", path: "/wizard/grade", ready: /Which repo should I grade\?/i },
] as const;

test.describe("visual: intent wizard", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas" });
    await setActiveProject(page, project.projectId);
    // Pin readiness so the door picker is not hostage to the runner's toolchain.
    await page.route("**/api/readiness", (route) => route.fulfill({ json: READY }));
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  for (const route of WIZARD_ROUTES) {
    test(route.id, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.ready }).first()).toBeVisible({
        timeout: 15_000,
      });
      await settle(page);
      await expect(page).toHaveScreenshot(`${route.id}.png`, { fullPage: true });
    });
  }
});
