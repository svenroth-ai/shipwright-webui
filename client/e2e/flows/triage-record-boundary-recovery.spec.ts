import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Triage record-boundary recovery — F0.5 web-surface E2E
 * (iterate-2026-07-18-triage-jsonl-record-boundary).
 *
 * End-to-end proof through the REAL stack that a damaged append-only log no
 * longer reads as an EMPTY one. Seeds a fixture project whose
 * `.shipwright/triage.jsonl` holds two findings CONCATENATED onto a single
 * physical line — what an unterminated predecessor produces when the next
 * writer appends onto it — and asserts the Triage tab renders BOTH.
 *
 * Before the fix that line failed `JSON.parse` as a whole, the reader skipped
 * it, and both findings vanished from the Inbox with no error anywhere: the
 * operator simply saw fewer items than the log contained. That is the failure
 * mode this drives, and it is only observable at the UI — which is why this
 * runs on the web surface rather than stopping at the route test.
 *
 * Also covers PARTIAL recovery (a valid record followed by unrecoverable
 * text still yields the valid record), because all-or-nothing recovery would
 * reproduce the very bug it fixes.
 *
 * Self-seeds via the real POST /api/projects + on-disk writes and cleans up
 * the registration + temp dir afterwards (mirrors triage-pending-delivery).
 */

const LF = String.fromCharCode(10);
const HEADER = '{"v":1,"schema":"triage","created":"2026-07-18T00:00:00Z"}';

function appendLine(id: string, title: string): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-07-18T08:00:00Z",
    originalTs: "2026-07-18T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title,
    detail: `Detail for ${id}`,
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `phaseQuality:${id}`,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

test.describe("Triage record-boundary recovery", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("both findings on one concatenated line reach the Inbox, and a partial line keeps its valid record", async ({
    page,
    request,
  }) => {
    // ── seed a fixture project with a DAMAGED triage log ────────────────────
    projectDir = path.join(tmpdir(), `record-boundary-${Date.now()}`);
    mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });

    // Line 2: two records, NO separating newline between them.
    // Line 3: a valid record followed by text that cannot be decoded.
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.jsonl"),
      HEADER +
        LF +
        appendLine("trg-aaaa0001", "First of a concatenated pair") +
        appendLine("trg-bbbb0002", "Second of a concatenated pair") +
        LF +
        appendLine("trg-cccc0003", "Survivor of a partial line") +
        "UNRECOVERABLE-TAIL" +
        LF,
      "utf-8",
    );

    // ── register the project via the REAL API ───────────────────────────────
    const created = await request.post("/api/projects", {
      data: {
        name: "record-boundary-demo",
        path: projectDir.split(path.sep).join("/"),
      },
    });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;

    // ── drive the Triage tab ────────────────────────────────────────────────
    await page.goto("/triage");
    await expect(page.getByTestId("triage-page")).toBeVisible();

    // BOTH halves of the concatenated line are present. Before the fix this
    // line contributed ZERO items.
    await expect(page.getByTestId("triage-item-trg-aaaa0001")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("triage-item-trg-bbbb0002")).toBeVisible();

    // Partial recovery: the valid record on the damaged line survives.
    await expect(page.getByTestId("triage-item-trg-cccc0003")).toBeVisible();

    // The recovered items are real, interactive cards — not empty shells.
    await page.getByTestId("triage-item-trg-bbbb0002").click();
    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Second of a concatenated pair");
  });
});
