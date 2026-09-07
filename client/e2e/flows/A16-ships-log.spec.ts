/*
 * A16 — Ship's Log project home (FR-01.60). Seeds a graded project + one run on
 * disk (a real dashboard.md + shipwright_events.jsonl), then drives the real UI:
 * the Captain's Drawer argues its grade, the logbook shows the run as an entry,
 * the promptbox opens a scoped plan card whose unknown fields render "—", and
 * "Open board" escapes to the project-filtered board.
 *
 * Stops at the plan-card confirm — it does NOT click Go (that would create +
 * launch a real Claude session). The clickable entry→Mission navigation is
 * covered deterministically in LogEntryList.test.tsx (the join needs a task with
 * a matching runId, which the create API does not expose to a plain seed).
 */

import { test, expect, type Page } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const DASHBOARD_MD = [
  "# Compliance Dashboard",
  "",
  "Generated: 2026-07-14T12:00:00Z",
  "",
  "## ✅ Control Verdict",
  "",
  "> **Under full control.**",
  "",
  "### Control Grade: **A** (98/100) — Under full control.",
  "",
  "| | Dimension | Signal | Anchor |",
  "|---|-----------|--------|--------|",
  "| ✅ | Requirement traceability | 43/44 FRs covered | ISO/IEC/IEEE 29148 |",
  "| ✅ | Test health | latest full suite 2092/2093 | OpenSSF Scorecard |",
  "| ✅ | Security | 0 open high/critical | NIST SSDF |",
  "",
].join("\n");

const EVENT = JSON.stringify({
  type: "work_completed",
  adr_id: "run-a16-e2e",
  ts: "2026-07-13T12:00:00Z",
  intent: "feature",
  change_type: "feature",
  summary: "Ship's-Log project home",
  commit: "abc1234def5678",
  spec_impact: "add",
  affected_frs: ["FR-01.60"],
  tests: { passed: 12, total: 12 },
});

test.describe("A16 — Ship's Log home", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "Atlas",
      files: {
        ".shipwright/compliance/dashboard.md": DASHBOARD_MD,
        "shipwright_events.jsonl": EVENT + "\n",
      },
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  // @covers FR-01.59
  test("drawer + logbook + promptbox render; plan card confirms; open-board escapes", async ({ page }) => {
    await page.goto(`/projects/${project.projectId}/log`);

    // 1 — the Captain's Drawer argues its grade with parsed sub-scores.
    const drawer = page.getByTestId("captains-drawer");
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer).toHaveAttribute("data-graded", "true");
    await expect(page.getByTestId("captains-drawer-subs")).toBeVisible();

    // 2 — the promptbox auto-focuses on load (§5.2). Assert this BEFORE any
    //     focus-stealing interaction (the drawer modal restores focus to its
    //     own trigger on close).
    const input = page.getByTestId("shipslog-promptbox-input");
    await expect(input).toBeFocused();

    // 3 — "Why an A?" opens the real control record.
    await page.getByTestId("captains-drawer-why").click();
    await expect(page.getByTestId("compliance-detail-modal")).toBeVisible();
    await page.keyboard.press("Escape");

    // 4 — the logbook shows the seeded run as an entry. It has NO joined task, so
    //     it is a non-clickable entry (AC3 — never a dead click into a 404).
    const entry = page.getByTestId("shipslog-entry-run-a16-e2e");
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("data-clickable", "false");
    await expect(entry).toContainText("Ship's-Log project home");

    // 5 — the promptbox opens a scoped plan card whose unknown fields render "—".
    await input.fill("add rate-limit headers to the media route");
    await page.getByTestId("shipslog-promptbox-plan").click();
    await expect(page.getByTestId("shipslog-plan-card")).toBeVisible();
    await expect(page.getByTestId("shipslog-plan-complexity")).toHaveText("—");
    await expect(page.getByTestId("shipslog-plan-affected-frs")).toHaveText("—");
    // Stop at the confirm — Cancel, do NOT drive a real Claude session.
    await page.getByTestId("shipslog-plan-cancel").click();
    await expect(page.getByTestId("shipslog-plan-card")).toBeHidden();

    // 6 — "Open board" escapes to the board filtered by this project.
    await page.getByTestId("ships-log-open-board").click();
    await expect(page).toHaveURL(new RegExp(`projectId=${project.projectId}`));
  });
});

/*
 * AC-6 (iterate-2026-09-06-tablet-ipad-ux-pass) — `.sl-main` (the logbook)
 * and `.sl-docs` (the Documents panel) are independently bounded scrollers,
 * not one shared page scroll. Before this iterate the Documents column used
 * a `position: sticky` hack that silently degraded to `position: static`
 * below 900px, merging it into the single-column page scroll — the reported
 * "Project Documents doesn't scroll along, only the Log does" defect. This
 * proves the mechanical fact (scrolling one side leaves the other's
 * `scrollTop` untouched) at both the previously-broken ≤900px band and the
 * desktop side-by-side band, in both scroll directions.
 */
test.describe("A16 — Ship's Log independent scroll (AC-6)", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    const files: Record<string, string> = {};
    // Enough logbook rows that `.sl-main` genuinely overflows at any tested
    // viewport height — otherwise "it didn't move" would be vacuously true.
    const events = Array.from({ length: 30 }, (_, i) =>
      JSON.stringify({
        type: "work_completed",
        adr_id: `run-scroll-${i}`,
        ts: `2026-07-${String((i % 27) + 1).padStart(2, "0")}T12:00:00Z`,
        intent: "feature",
        change_type: "feature",
        summary: `Scroll-independence fixture entry ${i}`,
        commit: `abc${i}def5678`,
        spec_impact: "none",
        affected_frs: [],
        tests: { passed: 1, total: 1 },
      }),
    ).join("\n") + "\n";
    files["shipwright_events.jsonl"] = events;
    // Enough Documents-panel content (mirrors A16b's "Tall" geometry fixture)
    // that `.sl-docs` genuinely overflows too.
    for (const section of ["01-adopted", "02-planned", "03-future"]) {
      files[`.shipwright/planning/${section}/spec.md`] = `# Section ${section}\n\nBody.\n`;
    }
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      files[`.shipwright/planning/iterate/2026-08-${name}-scroll-filler.md`] = `# Filler ${name}\n`;
    }
    for (const f of ["build_dashboard.md", "architecture.md", "decision_log.md", "conventions.md", "design_tokens.md"]) {
      files[`.shipwright/agent_docs/${f}`] = `# ${f}\n\nBody.\n`;
    }
    for (const f of ["dashboard.md", "traceability-matrix.md", "test-evidence.md", "change-history.md", "sbom.md"]) {
      files[`.shipwright/compliance/${f}`] = `# ${f}\n\nBody.\n`;
    }
    project = await seedProject(request, { name: "Atlas Scroll", files });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  async function assertIndependentScroll(page: Page) {
    await page.goto(`/projects/${project.projectId}/log`);
    const main = page.locator(".sl-main");
    const docs = page.locator(".sl-docs");
    await expect(main).toBeVisible({ timeout: 15_000 });
    await expect(docs).toBeVisible();

    // Both sides must genuinely overflow at this viewport, or the "it didn't
    // move" assertions below would pass vacuously.
    await expect
      .poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(20);
    await expect
      .poll(() => docs.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(20);

    // Scrolling the log column leaves the Documents panel untouched.
    await main.evaluate((el) => {
      el.scrollTop = 150;
    });
    expect(await docs.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await main.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // …and the reverse: scrolling Documents leaves the log column untouched.
    const mainScrollTopBefore = await main.evaluate((el) => el.scrollTop);
    await docs.evaluate((el) => {
      el.scrollTop = 100;
    });
    expect(await main.evaluate((el) => el.scrollTop)).toBe(mainScrollTopBefore);
    expect(await docs.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  }

  // @covers FR-01.59
  test("desktop (>900px, side-by-side grid): scrolling one column never moves the other", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await assertIndependentScroll(page);
  });

  // @covers FR-01.59
  test("tablet (≤900px, stacked grid rows): scrolling one region never moves the other", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await assertIndependentScroll(page);
  });
});
