/*
 * Flow 100 — single-session design-gate mockup review hosting (FR-01.45,
 * iterate-2026-07-10-design-gate-review-host).
 *
 * Proves the whole chain against the REAL dev stack (real Hono design-gate /
 * designs-serve / design-feedback routes + real on-disk run_config +
 * run_loop_state + designs/index.html — no route interception, per the
 * Backend-affects-Frontend gate):
 *
 *   1. paused-at-design run → the SingleSessionRunCard renders a DesignGatePanel
 *      with a "Review mockups" button.
 *   2. Click it → the full-bleed MockupReviewOverlay opens hosting the emitted
 *      viewer in a sandboxed iframe.
 *   3. Clicking the viewer's own Export (which calls window.showSaveFilePicker,
 *      overridden by the injected host bridge) writes
 *      .shipwright/designs/design-feedback-round1.md into the worktree and the
 *      overlay shows "Saved — Round 1".
 *   4. The written file re-reads to the contract shape (AC4) and the round is
 *      disk-derived (AC3).
 */

import { seedLocalStorage } from "../helpers/fixtures";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN_ID = "run-a1b2c3d4";
const DESIGN_PTK = "ptk-bbbb";
const EM_DASH = String.fromCharCode(0x2014); // — (avoid escape-mangling)

function runConfig(): string {
  return JSON.stringify({
    schemaVersion: 2,
    runId: RUN_ID,
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
    deploy_target: "none",
    pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status: "in_progress",
    completed_phase_task_ids: ["ptk-aaaa"],
    phase_tasks: [
      {
        phaseTaskId: "ptk-aaaa",
        phase: "project",
        splitId: null,
        sessionUuid: "11111111-2222-4333-8444-555555555555",
        version: 1,
        status: "done",
        title: "Run-a1b2 / project",
        slashCommand: "/shipwright-project",
        prerequisites: [],
        executionCount: 1,
        createdAt: "2026-07-10T08:00:00.000Z",
      },
      {
        phaseTaskId: DESIGN_PTK,
        phase: "design",
        splitId: null,
        sessionUuid: "22222222-3333-4444-8555-666666666666",
        version: 1,
        status: "in_progress",
        title: "Run-a1b2 / design",
        slashCommand: "/shipwright-design",
        prerequisites: ["ptk-aaaa"],
        executionCount: 1,
        createdAt: "2026-07-10T09:00:00.000Z",
      },
    ],
    created_at: "2026-07-10T08:00:00.000Z",
    updated_at: new Date().toISOString(),
  });
}

/** A minimal viewer that reproduces the emitted viewer's EXPORT SEAM: an Export
 *  button whose click builds contract-shaped markdown and calls
 *  window.showSaveFilePicker (Strategy 1) exactly as the real viewer does. The
 *  server injects the host bridge that overrides showSaveFilePicker. */
function viewerHtml(): string {
  const dash = "—";
  const md = [
    "# Design Feedback " + dash + " Round 1",
    "",
    "## Summary",
    "",
    "| Status | Count |",
    "|--------|-------|",
    "| Approved | 1 |",
    "| Changes Requested | 1 |",
    "| Rejected | 0 |",
    "| Total Reviewed | 2 / 2 |",
    "",
    "## Core",
    "",
    "### #01 Dashboard " + dash + " CHANGES",
    "",
    "**File:** screens/01-dashboard.html  ",
    "**FRs:** FR-01.09",
    "",
    "Tighten the header spacing.",
    "",
    "---",
    "",
    "### #02 Settings " + dash + " APPROVED",
    "",
    "**File:** screens/02-settings.html  ",
    "**FRs:** FR-01.10",
    "",
    "---",
    "",
  ].join("\n");
  const mdJson = JSON.stringify(md);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Viewer</title></head>
<body>
<h1>Mock Review Viewer</h1>
<button data-testid="fixture-export" onclick="exportFeedback()">Export</button>
<script>
async function exportFeedback() {
  var md = ${mdJson};
  var blob = new Blob([md], { type: 'text/markdown' });
  if (window.showSaveFilePicker) {
    var handle = await window.showSaveFilePicker({ suggestedName: 'design-feedback-round1.md' });
    var w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
}
</script>
</body></html>`;
}

async function makeProjectDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "designgate-e2e-"));
  await fs.writeFile(path.join(dir, "shipwright_run_config.json"), runConfig(), "utf-8");
  const shipwright = path.join(dir, ".shipwright");
  const designs = path.join(shipwright, "designs");
  await fs.mkdir(designs, { recursive: true });
  await fs.writeFile(
    path.join(shipwright, "run_loop_state.json"),
    JSON.stringify({
      schemaVersion: 1,
      runId: RUN_ID,
      currentPhaseTaskId: DESIGN_PTK,
      status: "paused_human_gate",
    }),
    "utf-8",
  );
  await fs.writeFile(path.join(designs, "index.html"), viewerHtml(), "utf-8");
  return dir;
}

async function registerProject(request: APIRequestContext, dir: string): Promise<string> {
  const res = await request.post("/api/projects", {
    data: { name: `designgate-e2e-${path.basename(dir)}`, path: dir },
  });
  if (!res.ok()) throw new Error(`POST /api/projects: HTTP ${res.status()} — ${await res.text()}`);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

async function openBoard(page: Page, projectId: string): Promise<void> {
  await seedLocalStorage(page, { "webui.activeProjectId": projectId });
  await page.goto("/");
  await expect(page.getByTestId("task-board-page")).toBeVisible();
}

test.describe("Flow 100 — design-gate mockup review (FR-01.45)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  test.afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
  });

  test("paused-at-design → Review mockups → Export writes the round file", async ({
    page,
    request,
  }) => {
    const dir = await makeProjectDir();
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const projectId = await registerProject(request, dir);
    cleanups.push(async () => void (await request.delete(`/api/projects/${encodeURIComponent(projectId)}`)));

    await openBoard(page, projectId);

    // 1. The single-session card + the paused-design affordance.
    await expect(page.getByTestId(`single-session-run-card-${RUN_ID}`)).toBeVisible();
    await expect(page.getByTestId("design-gate-panel")).toBeVisible();
    const reviewBtn = page.getByTestId("design-gate-review-button");
    await expect(reviewBtn).toBeVisible();

    // 2. Open the full-bleed overlay hosting the emitted viewer.
    await reviewBtn.click();
    await expect(page.getByTestId("mockup-review-overlay")).toBeVisible();
    const frame = page.frameLocator('[data-testid="mockup-review-iframe"]');
    await expect(frame.getByTestId("fixture-export")).toBeVisible();

    // 3. Click the viewer's own Export → injected bridge → host write.
    await frame.getByTestId("fixture-export").click();
    await expect(page.getByTestId("mockup-review-saved")).toHaveText(/Saved\s*—\s*Round 1/);

    // 4. The round file exists on disk with the contract shape (AC3/AC4).
    const roundFile = path.join(dir, ".shipwright", "designs", "design-feedback-round1.md");
    const written = await fs.readFile(roundFile, "utf-8");
    expect(written).toContain("# Design Feedback " + EM_DASH + " Round 1");
    expect(written).toContain("## Summary");
    expect(written).toContain("## Core");
    expect(written).toContain("### #01 Dashboard " + EM_DASH + " CHANGES");
    expect(written).toContain("**File:** screens/01-dashboard.html");
    expect(written).toContain("Tighten the header spacing.");
  });
});
