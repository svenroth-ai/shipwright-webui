/*
 * A16b — Ship's-Log Documents panel (iterate-2026-08-31-shipslog-documents-
 * panel). Real files on disk at the exact curated paths the server route
 * discovers (no API mocking — this is the server's own fs discovery,
 * not just client rendering): a Requirements spec.md, one Iterate
 * mini-spec, one Agent Doc, one Compliance doc. Drives the real UI:
 * two-column layout, Specs tabs (Requirements/Iterate + search), each
 * group opens the real SmartViewerModal, and Edit inside that overlay
 * reaches the real TipTap editor with the new "saved to disk only" notice.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const REQUIREMENTS_PATH = ".shipwright/planning/01-adopted/spec.md";
const ITERATE_PATH = ".shipwright/planning/iterate/2026-08-31-shipslog-documents-panel.md";
const AGENT_DOC_PATH = ".shipwright/agent_docs/architecture.md";
const COMPLIANCE_PATH = ".shipwright/compliance/dashboard.md";

test.describe("A16b — Ship's-Log Documents panel", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "Atlas Docs",
      files: {
        [REQUIREMENTS_PATH]: "# Adopted requirements\n\nThe committed scope for section 01.\n",
        [ITERATE_PATH]: "# Ship's-Log Documents panel\n\nThe iterate mini-spec.\n",
        [AGENT_DOC_PATH]: "# Architecture\n\nHow the pieces fit together.\n",
        [COMPLIANCE_PATH]: "# Compliance Dashboard\n\nGrade A.\n",
      },
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("Specs tabs, Agent Docs and Compliance rows each open the real overlay; Edit reaches the TipTap editor with the uncommitted-changes notice", async ({ page }) => {
    await page.goto(`/projects/${project.projectId}/log`);

    const panel = page.getByTestId("shipslog-docs-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 2, name: "Project documents" })).toBeVisible();

    // 1 — Requirements tab is the default; the seeded section's spec.md opens
    //     the real SmartViewerModal with its real content.
    await page.getByTestId(`shipslog-doc-${REQUIREMENTS_PATH}`).click();
    await expect(page.getByTestId("smart-viewer-modal")).toBeVisible();
    await expect(page.getByTestId("smart-viewer-modal-path")).toHaveText(REQUIREMENTS_PATH);
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("Adopted requirements");
    await page.getByTestId("smart-viewer-modal-close").click();
    await expect(page.getByTestId("smart-viewer-modal")).toBeHidden();

    // 2 — Iterate tab: search narrows the ~1-file seeded list, and the match opens.
    await page.getByTestId("shipslog-specs-tab-iterate").click();
    await page.getByTestId("shipslog-iterate-search").fill("documents-panel");
    const iterateRow = page.getByTestId(`shipslog-doc-${ITERATE_PATH}`);
    await expect(iterateRow).toBeVisible();
    await iterateRow.click();
    await expect(page.getByTestId("smart-viewer-modal-path")).toHaveText(ITERATE_PATH);

    // 3 — Edit inside the overlay reaches the REAL TipTap editor (decoupled
    //     from popOut — iterate-2026-08-31), showing the new global notice.
    await page.getByTestId("smart-viewer-edit").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();
    await expect(page.getByTestId("md-editor-surface")).toBeVisible();
    await expect(page.getByTestId("md-editor-uncommitted-note")).toBeVisible();
    await page.getByTestId("md-editor-cancel").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();
    await page.getByTestId("smart-viewer-modal-close").click();
    await expect(page.getByTestId("smart-viewer-modal")).toBeHidden();

    // 4 — Agent Docs row opens with its real path + content.
    await page.getByTestId(`shipslog-doc-${AGENT_DOC_PATH}`).click();
    await expect(page.getByTestId("smart-viewer-modal-path")).toHaveText(AGENT_DOC_PATH);
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("How the pieces fit together");
    await page.getByTestId("smart-viewer-modal-close").click();

    // 5 — Compliance row opens with its real path + content.
    await page.getByTestId(`shipslog-doc-${COMPLIANCE_PATH}`).click();
    await expect(page.getByTestId("smart-viewer-modal-path")).toHaveText(COMPLIANCE_PATH);
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("Grade A");
    await page.getByTestId("smart-viewer-modal-close").click();
  });
});

test.describe("A16b — Documents panel geometry (external review, iterate-2026-08-31)", () => {
  let project: SeededProject;

  // A project with NO runs (short left column: CaptainsDrawer + promptbox
  // only, GraduationCard/LogEntryList render their empty states) next to a
  // FULLY-populated Documents panel (both curated 5-item lists, several
  // Requirements sections, several Iterate specs) — the exact "right panel
  // taller than left column" shape an external code review flagged as
  // untested: does `.sl-docs` scroll internally and stay bounded to the
  // viewport, or does it grow the grid row past the left column?
  test.beforeEach(async ({ page, request }) => {
    const files: Record<string, string> = {};
    for (const section of ["01-adopted", "02-planned", "03-future"]) {
      files[`.shipwright/planning/${section}/spec.md`] = `# Section ${section}\n\nBody.\n`;
    }
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      files[`.shipwright/planning/iterate/2026-08-${name}-filler.md`] = `# Filler ${name}\n`;
    }
    for (const f of ["build_dashboard.md", "architecture.md", "decision_log.md", "conventions.md", "design_tokens.md"]) {
      files[`.shipwright/agent_docs/${f}`] = `# ${f}\n\nBody.\n`;
    }
    for (const f of ["dashboard.md", "traceability-matrix.md", "test-evidence.md", "change-history.md", "sbom.md"]) {
      files[`.shipwright/compliance/${f}`] = `# ${f}\n\nBody.\n`;
    }
    project = await seedProject(request, { name: "Atlas Docs Tall", files });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("a fully-populated panel next to an empty logbook stays capped to the viewport and scrolls internally, instead of stretching the grid row", async ({ page }) => {
    // A short viewport, not just a short left column, guarantees the panel's
    // own (already fairly compact — three <=280px capped sub-lists) content
    // exceeds the visible area, so the internal-scroll assertion below is
    // actually exercised rather than vacuously true.
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto(`/projects/${project.projectId}/log`);

    const panel = page.getByTestId("shipslog-docs-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("shipslog-doc-.shipwright/compliance/sbom.md")).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    // The panel must never grow past the viewport height (position: sticky +
    // max-height: calc(100vh - 120px)) — the bug this test guards against is
    // exactly an unbounded grid row stretched to the panel's content height.
    expect(box!.height).toBeLessThan(500);
    expect(box!.y + box!.height).toBeLessThanOrEqual(500 + 1);

    // Its own scroll container must actually be scrollable (content taller
    // than the box) — proving the cap is doing real work, not just never
    // being exercised by this fixture's content volume. (This caught a
    // real bug during review: without `flex-shrink: 0` on .sl-docs's direct
    // children, each group's own overflow:auto list silently shrank to fit
    // instead of the panel overflowing — CLAUDE.md rule 24 — so scrollHeight
    // and clientHeight came back equal even though content was being
    // squeezed, not scrolled.)
    const overflowing = await panel.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(overflowing).toBe(true);
  });
});
