/*
 * Spec - inbox-reminders follow-ups (FR-01.76), real browser + REAL server.
 *
 *   1. "Open in Triage" on a parked row opens THAT item's detail in Triage (not just the
 *      list), and the link is consumed: closing the dialog leaves a clean /triage.
 *   2. The sidebar Inbox badge carries a "!" when some project's reminders could not be
 *      read (also with nothing counted), so the problem is visible on every page.
 *
 * The project and its triage.jsonl are REAL (written to disk, read back through the real
 * Triage routes). Only the reminder routes are answered by a small stand-in for the
 * Shipwright reminder tool (the server bridge has its own unit + integration tests, and the
 * isolated stack has no plugin cache). The "no triage log is not an error" rule is the
 * server's contract parse: it is proven by reminder-contract.test.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TODAY = new Date().toISOString().slice(0, 10);
const TRG = "trg-1a2b3c4d";

async function seedProjectWithTriage(request: import("@playwright/test").APIRequestContext) {
  const projectDir = path.join(tmpdir(), `inbox-followups-${Date.now()}`);
  mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
  const line = JSON.stringify({
    event: "append",
    id: TRG,
    ts: "2026-11-01T08:00:00Z",
    originalTs: "2026-11-01T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: "Flaky Windows runner",
    detail: "Fails one run in ten.",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `phaseQuality:${TRG}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
  writeFileSync(
    path.join(projectDir, ".shipwright", "triage.jsonl"),
    [`{"v":1,"schema":"triage","created":"2026-11-01T00:00:00Z"}`, line].join("\n") + "\n",
    "utf-8",
  );
  const created = await request.post("/api/projects", { data: { name: "followups", path: projectDir.split(path.sep).join("/") } });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { data: { id: string } }).data.id;
  return { projectDir, projectId };
}

async function mockDue(page: Page, projects: unknown[]) {
  await page.route("**/api/reminders/due", (route) => route.fulfill({ json: { projects } }));
}

const parkedItem = {
  kind: "triage",
  id: TRG,
  title: "Revisit: flaky Windows runner",
  due: TODAY,
  why: null,
  decided: null,
  open: null,
  command: null,
  links: [],
  severity: null,
};

// @covers FR-01.76
test.describe("Inbox reminders follow-ups", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) await request.delete(`/api/projects/${projectId}`).catch(() => {});
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = "";
    projectId = "";
  });

  test("Open in Triage opens that very item, and the link is used up", async ({ page, request }) => {
    ({ projectDir, projectId } = await seedProjectWithTriage(request));
    await mockDue(page, [
      { projectId, state: "ok", contractVersion: 1, on: TODAY, reminderCorruptLines: 0, triageError: null, items: [parkedItem] },
    ]);
    await page.goto("/inbox");
    const row = page.getByTestId(`inbox-card-triage-${projectId}-${TRG}`);
    await expect(row).toBeVisible();
    await row.hover();
    await row.getByTestId(/reminder-open-triage-/).click();

    await expect(page).toHaveURL(/\/triage$/); // landed on Triage and the query was consumed
    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal).toContainText("Flaky Windows runner");

    await modal.getByLabel("Close").click();
    await expect(modal).toHaveCount(0);
    await expect(page).toHaveURL(/\/triage$/); // closing does not re-open it
  });

  test("an unreadable project puts a '!' on the sidebar badge, also with nothing counted", async ({ page }) => {
    await mockDue(page, [{ projectId: "ghost-project", state: "failed", reason: "The reminder tool could not be started." }]);
    await page.goto("/");
    const badge = page.getByTestId("inbox-badge-problem").first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("!");
    await expect(page.getByRole("link", { name: /Inbox.*could not be read/ }).first()).toBeVisible();
  });

  test("a clean answer has no '!'", async ({ page }) => {
    await mockDue(page, [
      { projectId: "clean-project", state: "ok", contractVersion: 1, on: TODAY, reminderCorruptLines: 0, triageError: null, items: [] },
    ]);
    await page.goto("/");
    await expect(page.getByTestId("inbox-badge-problem")).toHaveCount(0);
  });
});
