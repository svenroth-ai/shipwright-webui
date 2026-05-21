/*
 * Spec — triage-fix-now
 *
 * iterate-2026-05-21-triage-fix-now-and-phase-slash replaced the
 * iterate-2026-05-20 clipboard-copy semantics with "open NewIssueModal
 * pre-populated". This spec is the F0.5 web-surface gate for that
 * rewire — the unit tests stub `NewIssueModal` away, only a real-stack
 * run can prove the modal actually mounts with the right action + phase
 * + pre-fill values once TriageDetailModal closes.
 *
 * Two scenarios in one spec — github-source maps to new-task with
 * phase=security; iterate-source (or any non-github source) maps to
 * new-iterate without phase pre-fill.
 *
 * Strategy:
 *  1. Create a real on-disk directory `<tmp>/triage-fix-now-{stamp}`
 *  2. Write `.shipwright/triage.jsonl` with two items (one github, one
 *     iterate) BEFORE registering the project — the 5 s mtime-keyed
 *     cache in `core/triage-store.ts` cannot return a stale-empty array
 *     this way.
 *  3. POST /api/projects to register it.
 *  4. Navigate to /triage in-app, open the github item, click Fix-now,
 *     assert the new-task modal mounts with phase=security pre-filled.
 *  5. Repeat for the iterate item — assert new-iterate modal with no
 *     phase picker.
 *  6. Cleanup: DELETE the project + rm the tmp dir.
 *
 * The legacy clipboard-copy test from iterate-2026-05-20 is removed
 * along with its `data-testid="triage-fix-now-confirmation"` /
 * navigator.clipboard.readText() assertions — both refer to behaviour
 * that no longer exists.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

test.describe("Triage tab — Fix-now opens NewIssueModal (iterate-2026-05-21)", () => {
  let tmpDir = "";
  let projectId = "";

  test.beforeEach(async ({ request }) => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "triage-fix-now-"));
    const triageDir = path.join(tmpDir, ".shipwright");
    mkdirSync(triageDir, { recursive: true });
    writeFileSync(
      path.join(triageDir, "triage.jsonl"),
      [
        JSON.stringify({
          v: 1,
          schema: "triage",
          created: "2026-05-21T08:00:00Z",
        }),
        // github-source item — exercises AC-8 (new-task + phase=security).
        JSON.stringify({
          event: "append",
          id: "trg-fixghub1",
          ts: "2026-05-21T08:01:00Z",
          originalTs: "2026-05-21T08:01:00Z",
          source: "github",
          severity: "high",
          kind: "bug",
          title: "GitHub security: 35 shipwright-security finding(s) (high)",
          detail: "Repo example/repo | code-scanning: 5 high",
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: "e2e:fix-now:github",
          status: "triage",
          suggestedPriority: "P1",
          suggestedDomain: "engineering",
        }),
        // iterate-source item — exercises AC-9 (new-iterate, no phase).
        JSON.stringify({
          event: "append",
          id: "trg-fixiter1",
          ts: "2026-05-21T08:02:00Z",
          originalTs: "2026-05-21T08:02:00Z",
          source: "iterate",
          severity: "medium",
          kind: "improvement",
          title: "Re-open a Done/Closed task — counterpart to Move-to-Backlog",
          detail: "Counterpart direction to iterate-2026-05-17-move-to-backlog",
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: "e2e:fix-now:iterate",
          status: "triage",
          suggestedPriority: "P3",
          suggestedDomain: "engineering",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const createRes = await request.post("/api/projects", {
      data: { name: `triage-fix-now-e2e-${Date.now()}`, path: tmpDir },
    });
    expect(createRes.status()).toBeLessThan(300);
    const body = (await createRes.json()) as { data: { id: string } };
    projectId = body.data.id;
  });

  test.afterEach(async ({ request }) => {
    if (projectId) {
      try {
        await request.delete(`/api/projects/${projectId}`);
      } catch {
        // Best-effort cleanup; do not fail the test on teardown.
      }
    }
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  test("github source: Fix-now opens new-task modal pre-filled with phase=security", async ({
    page,
  }) => {
    // SPA-fallback gotcha (see CLAUDE.md learning) — production
    // `node dist/index.js` 404s on direct /triage. Land at "/" then
    // navigate in-app via the sidebar link.
    await page.goto("/");
    const sidebarTriage = page.getByRole("link", { name: /Triage/i }).first();
    await sidebarTriage.click();
    await expect(page).toHaveURL("/triage");

    const itemCard = page.getByTestId("triage-item-trg-fixghub1");
    await expect(itemCard).toBeVisible({ timeout: 35_000 });
    await itemCard.click();

    await expect(page.getByTestId("triage-detail-modal")).toBeVisible();

    // Fix-now click: TriageDetailModal closes (AC-10), NewIssueModal
    // opens in new-task mode (AC-8).
    await page.getByTestId("triage-fix-now").click();

    const newTaskModal = page.getByTestId("new-issue-modal-new-task");
    await expect(newTaskModal).toBeVisible();
    await expect(page.getByTestId("triage-detail-modal")).not.toBeVisible();

    // Title prefill: "Fix for <triage.title>".
    const titleInput = page.getByTestId("new-issue-title-input");
    await expect(titleInput).toHaveValue(
      "Fix for GitHub security: 35 shipwright-security finding(s) (high)",
    );

    // Description prefill: triage.detail verbatim.
    const descInput = page.getByTestId("new-issue-description-input");
    await expect(descInput).toHaveValue(
      "Repo example/repo | code-scanning: 5 high",
    );

    // Phase pre-selected to Security. The dropdown trigger renders the
    // selected phase label inside it.
    await expect(page.getByTestId("new-issue-phase-select")).toContainText(
      /Security/i,
    );

    // Priority + Domain pre-fill from suggestedPriority / suggestedDomain.
    await expect(page.getByTestId("new-issue-priority-select")).toHaveValue("P1");
    await expect(page.getByTestId("new-issue-domain-input")).toHaveValue(
      "engineering",
    );
  });

  test("iterate source: Fix-now opens new-iterate modal (no phase picker)", async ({
    page,
  }) => {
    await page.goto("/");
    const sidebarTriage = page.getByRole("link", { name: /Triage/i }).first();
    await sidebarTriage.click();
    await expect(page).toHaveURL("/triage");

    const itemCard = page.getByTestId("triage-item-trg-fixiter1");
    await expect(itemCard).toBeVisible({ timeout: 35_000 });
    await itemCard.click();

    await expect(page.getByTestId("triage-detail-modal")).toBeVisible();
    await page.getByTestId("triage-fix-now").click();

    const newIterateModal = page.getByTestId("new-issue-modal-new-iterate");
    await expect(newIterateModal).toBeVisible();
    await expect(page.getByTestId("triage-detail-modal")).not.toBeVisible();

    await expect(page.getByTestId("new-issue-title-input")).toHaveValue(
      "Fix for Re-open a Done/Closed task — counterpart to Move-to-Backlog",
    );
    await expect(page.getByTestId("new-issue-description-input")).toHaveValue(
      "Counterpart direction to iterate-2026-05-17-move-to-backlog",
    );
    // new-iterate has no phase picker (AC-9).
    await expect(page.getByTestId("new-issue-phase-select")).toHaveCount(0);

    // Priority + Domain still pre-fill (both modes opted in via modal_fields).
    await expect(page.getByTestId("new-issue-priority-select")).toHaveValue("P3");
    await expect(page.getByTestId("new-issue-domain-input")).toHaveValue(
      "engineering",
    );
  });
});
