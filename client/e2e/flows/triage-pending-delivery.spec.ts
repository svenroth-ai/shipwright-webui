import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Triage pending-delivery badge — F0.5 web-surface E2E
 * (iterate-2026-06-10-triage-pending-delivery-badge).
 *
 * End-to-end proof of the outbox-residence UX through the REAL stack: seeds a
 * fixture project whose `.shipwright/triage.jsonl` holds one tracked finding
 * and whose gitignored `.shipwright/triage.outbox.jsonl` buffer holds one
 * fresh background finding, then asserts the Triage tab renders BOTH (union
 * read), badges ONLY the outbox-only item "pending delivery" (the GET-route
 * enrichment mirroring `triage_cli.py list --json`), and that the existing
 * Fix-now CTA still acts on the pending item (spawns the NewIssueModal).
 *
 * Self-seeds via the real POST /api/projects + on-disk writes and cleans up
 * the registration + temp dir afterwards (mirrors
 * campaign-attached-run-guard.spec.ts).
 */

function appendLine(id: string, title: string): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-06-10T08:00:00Z",
    originalTs: "2026-06-10T08:00:00Z",
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

test.describe("Triage pending-delivery badge", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("outbox-only finding is badged pending-delivery; tracked finding is not; Fix-now works on the pending item", async ({
    page,
    request,
  }) => {
    // ── seed a fixture project on disk ──────────────────────────────────────
    projectDir = path.join(tmpdir(), `pending-delivery-${Date.now()}`);
    mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.jsonl"),
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine(
        "trg-aaaa0001",
        "Tracked finding",
      )}\n`,
      "utf-8",
    );
    // The fresh background finding a producer wrote on idle main — lives ONLY
    // in the gitignored per-tree outbox buffer (headerless).
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.outbox.jsonl"),
      appendLine("trg-bbbb0002", "Fresh outbox finding") + "\n",
      "utf-8",
    );

    // ── register the project via the REAL API ───────────────────────────────
    const created = await request.post("/api/projects", {
      data: {
        name: "pending-delivery-demo",
        path: projectDir.split(path.sep).join("/"),
      },
    });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;

    // ── drive the Triage tab ────────────────────────────────────────────────
    await page.goto("/triage");
    await expect(page.getByTestId("triage-page")).toBeVisible();

    const trackedCard = page.getByTestId("triage-item-trg-aaaa0001");
    const pendingCard = page.getByTestId("triage-item-trg-bbbb0002");
    await expect(trackedCard).toBeVisible({ timeout: 15000 });
    await expect(pendingCard).toBeVisible();

    // AC3 — only the outbox-only item carries the badge.
    await expect(
      pendingCard.getByTestId("triage-pending-delivery"),
    ).toBeVisible();
    await expect(
      trackedCard.getByTestId("triage-pending-delivery"),
    ).toHaveCount(0);

    // ── detail modal: badge + working Fix-now CTA (AC4) ─────────────────────
    await pendingCard.click();
    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("triage-pending-delivery")).toBeVisible();

    const fixNow = modal.getByTestId("triage-fix-now");
    await expect(fixNow).toBeEnabled();
    await fixNow.click();
    // The intent routed: TriagePage mounts the NewIssueModal prefilled from
    // the pending item (residence never gates the CTA; non-github source →
    // the new-iterate action, per fixNowIntent's source discriminator).
    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();
  });
});
