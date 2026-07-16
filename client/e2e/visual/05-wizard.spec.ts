/*
 * Visual baselines — the Intent Wizard (A08, FR-01.51; grade card wired to the
 * real route in A09b, FR-01.53). Three entry screens:
 *   /wizard        — the door picker (readiness pinned READY so the shot is not
 *                    hostage to whatever tools the CI runner happens to have)
 *   /wizard/adopt  — step 1, the repo pick (adopt)
 *   /wizard/grade  — the REAL Control-Grade result card, rendered from a
 *                    deterministic /api/wizard/grade fixture (A09b)
 *
 * The wizard renders STUB / fixture data (Spec/prototype-derived), so every
 * pixel here is deterministic and independent of the developer's machine — AC6
 * provenance honesty. Two machine-dependent inputs are intercepted to fixed
 * payloads: the readiness probe (→ READY) and, for grade, the grade route (→ a
 * fixed ReportModel). The FIXTURE is only for the stable screenshot; the real
 * route renders real output. The not-ready gate + honest grade error states are
 * covered by the unit suite, not a screenshot.
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

/* Deterministic grade fixture — a REMOTE cold-repo grade, shaped exactly like
 * grade.py's `--format json` output (schema 1.0, dimension score/weight as 0..1
 * fractions, n/a ⇒ score null). Two n/a dimensions exercise the honest-n/a
 * render; the network receipt exercises the remote path. */
const GRADE_FIXTURE = {
  status: "report-ready",
  model: {
    target_display: "github.com/acme/checkout",
    grade: "C",
    score: 61,
    gradeable: true,
    verdict: "Real code, thin evidence. Two of four dimensions cannot be derived at all.",
    band_label: "Partial control",
    mode: "cold repo (never adopted)",
    routing_state: "heuristic",
    routing_reason: "no Shipwright records found — graded from history + structure",
    verified_from: "shallow clone — fetched to a temp folder, deleted after grading",
    measurable_count: 2,
    na_count: 2,
    static_test_inventory: "84 test files (Vitest) · 71% of source files have a sibling test",
    honest_ceiling_note:
      "A cold repo can only be graded on what it can prove. Two dimensions have no evidence to read — that is a finding about the record, not a verdict on your code.",
    dimensions: [
      {
        key: "requirement_traceability",
        label: "Requirement traceability",
        weight: 0.3,
        score: null,
        status: "n/a",
        anchor: "trace",
        detail: "There is no spec, so no line of code can be traced back to a requirement.",
        provenance: {
          source: "Looked for: spec.md, requirements/, an FR index. None found.",
          mode: "unavailable",
          freshness: "n/a",
          sampled: false,
          truncated: false,
          disabled_enrichments: ["scorecard-fr-index"],
        },
        would_light_up: true,
      },
      {
        key: "test_health",
        label: "Test health",
        weight: 0.3,
        score: 0.71,
        status: "gap",
        anchor: "tests",
        detail: "84 real tests run and pass — but nothing records what they are supposed to protect.",
        provenance: {
          source: "Read: package.json scripts + the test-file inventory.",
          mode: "heuristic",
          freshness: "a1b2c3d4e5f6",
          sampled: false,
          truncated: false,
          disabled_enrichments: ["ci-junit-pass-ratio"],
        },
        would_light_up: true,
      },
      {
        key: "security",
        label: "Security",
        weight: 0.2,
        score: 1.0,
        status: "ok",
        anchor: "sec",
        detail: "No high or critical findings today. But nothing re-checks on every change.",
        provenance: {
          source: "Read: CI workflows. No security scan step found.",
          mode: "heuristic",
          freshness: "a1b2c3d4e5f6",
          sampled: false,
          truncated: false,
          disabled_enrichments: ["code-scanning-sarif"],
        },
        would_light_up: false,
      },
      {
        key: "change_traceability",
        label: "Change history",
        weight: 0.2,
        score: null,
        status: "n/a",
        anchor: "hist",
        detail:
          "412 commits record WHAT changed — but with no conventional commits, no PR/issue links and no decision log, nothing records WHY.",
        provenance: {
          source: "Read: git log (412 commits, 14 months). Found no PR/issue links or decision log.",
          mode: "unavailable",
          freshness: "n/a",
          sampled: false,
          truncated: false,
          disabled_enrichments: ["ci-run-per-sha", "conventional-commit-links"],
        },
        would_light_up: true,
      },
    ],
    reasons: [
      "No spec exists, so traceability has nothing to trace to.",
      "The tests pass, but they cannot say what they defend.",
      "Nothing scans for vulnerabilities when the code changes.",
      "The history says what happened, never why.",
    ],
    controls_shipwright_would_light: [
      "A spec written FROM your existing code — the 84 tests then prove something specific",
      "Test evidence: which requirement each test defends",
      "A security scan on every change, not once",
      "A decision log — the why, next to the what",
    ],
    network_enabled: true,
    network_note: "Nothing of yours was uploaded. Nothing was written to the repo.",
    network_enrichments: ["git clone --depth 1 (public repo)", "gh api — repository metadata (stars, default branch)"],
    schema_version: "1.0",
  },
};

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

  // Entry screens (step 1) — deterministic, machine-independent.
  const ENTRY_ROUTES = [
    { id: "wizard", path: "/wizard", ready: /What do you want to do\?/i },
    { id: "wizard-adopt", path: "/wizard/adopt", ready: /Where does the repo live\?/i },
  ] as const;

  for (const route of ENTRY_ROUTES) {
    test(route.id, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.ready }).first()).toBeVisible({
        timeout: 15_000,
      });
      await settle(page);
      await expect(page).toHaveScreenshot(`${route.id}.png`, { fullPage: true });
    });
  }

  // Grade: drive through to the REAL Control-Grade result card, fed by a fixed
  // /api/wizard/grade fixture so the card is deterministic (A09b, AC7).
  test("wizard-grade", async ({ page }) => {
    await page.route("**/api/wizard/grade", (route) => route.fulfill({ json: GRADE_FIXTURE }));
    await page.goto("/wizard/grade");
    await expect(page.getByRole("heading", { name: /Which repo should I grade\?/i })).toBeVisible({
      timeout: 15_000,
    });
    // Pick the github recent-path chip → runs the (intercepted) grade → result card.
    await page.getByTestId("wizard-repo-chip").nth(2).click();
    await expect(page.getByTestId("wizard-grade-result")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("wizard-grade-dimensions")).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("wizard-grade.png", { fullPage: true });
  });
});
