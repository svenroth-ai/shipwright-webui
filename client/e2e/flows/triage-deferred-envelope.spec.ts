import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Triage Deferred section — F0.5 web-surface E2E
 * (monorepo P2.03 parity, iterate-2026-08-05-triage-deferred-envelope).
 *
 * End-to-end proof through the REAL stack that:
 *   AC2/AC6 — a parked (snoozed) item whose revisit date has already passed
 *     auto-resolves back to the OPEN list (server-side `applyDeferOverlay`,
 *     never a client-side flag), while a future-dated park renders in its
 *     own Deferred section with the correct revisit date.
 *   AC6    — an undated park ("parked-not-due") shows in Deferred with no
 *     revisit date, never auto-resolving.
 *   AC7    — the Snooze action's optional revisit-date field actually moves
 *     an open item into Deferred through the real POST /snooze route.
 *
 * Self-seeds via the real POST /api/projects + on-disk writes and cleans up
 * the registration + temp dir afterwards (mirrors
 * triage-pending-delivery.spec.ts).
 */

function appendLine(id: string, title: string, extra: Record<string, unknown> = {}): string {
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
    ...extra,
  });
}

function statusLine(
  id: string,
  newStatus: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    event: "status",
    id,
    ts: "2026-06-10T09:00:00Z",
    newStatus,
    by: "webui",
    reason: null,
    promotedTaskId: null,
    ...extra,
  });
}

test.describe("Triage Deferred section", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("expired park auto-reopens; future-dated + undated parks render in Deferred with the right revisit info", async ({
    page,
    request,
  }) => {
    projectDir = path.join(tmpdir(), `triage-deferred-${Date.now()}`);
    mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
    const lines = [
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}`,
      appendLine("trg-open0001", "Open finding"),
      appendLine("trg-past0002", "Expired park (auto-reopens)"),
      statusLine("trg-past0002", "snoozed", { revisitAt: "2020-01-01" }),
      appendLine("trg-future003", "Future park"),
      statusLine("trg-future003", "snoozed", { revisitAt: "2099-06-01" }),
      appendLine("trg-nodate004", "Undated park"),
      statusLine("trg-nodate004", "snoozed"),
    ];
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.jsonl"),
      lines.join("\n") + "\n",
      "utf-8",
    );

    const created = await request.post("/api/projects", {
      data: {
        name: "triage-deferred-demo",
        path: projectDir.split(path.sep).join("/"),
      },
    });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;

    await page.goto("/triage");
    await expect(page.getByTestId("triage-page")).toBeVisible();

    // AC2 — the expired park is already OPEN, not in Deferred.
    await expect(page.getByTestId("triage-item-trg-open0001")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("triage-item-trg-past0002")).toBeVisible();

    // AC6 — the Deferred section carries exactly the two still-parked items.
    const deferred = page.getByTestId("triage-deferred-section");
    await expect(deferred).toBeVisible();
    await expect(deferred).toContainText("Deferred (2)");

    const futureCard = page.getByTestId("triage-deferred-item-trg-future003");
    await expect(futureCard).toBeVisible();
    await expect(
      page.getByTestId("triage-deferred-item-trg-future003-revisit"),
    ).toHaveText("Returns on 2099-06-01");
    await expect(
      page.getByTestId("triage-deferred-item-trg-future003-state"),
    ).toHaveText("Parked");

    const undatedCard = page.getByTestId("triage-deferred-item-trg-nodate004");
    await expect(undatedCard).toBeVisible();
    await expect(
      page.getByTestId("triage-deferred-item-trg-nodate004-revisit"),
    ).toHaveText("No revisit date set");
    await expect(
      page.getByTestId("triage-deferred-item-trg-nodate004-state"),
    ).toHaveText("Parked — not due");

    // Deferred is read-only — clicking it opens the detail view with no
    // action row (item.status !== "triage").
    await futureCard.click();
    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("triage-snooze")).toHaveCount(0);
  });

  test("Snooze with a revisit date moves the item into Deferred (AC7)", async ({
    page,
    request,
  }) => {
    projectDir = path.join(tmpdir(), `triage-deferred-snooze-${Date.now()}`);
    mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.jsonl"),
      `{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}\n${appendLine(
        "trg-a0000001",
        "About to be parked",
      )}\n`,
      "utf-8",
    );

    const created = await request.post("/api/projects", {
      data: {
        name: "triage-snooze-demo",
        path: projectDir.split(path.sep).join("/"),
      },
    });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;

    await page.goto("/triage");
    const card = page.getByTestId("triage-item-trg-a0000001");
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await modal.getByTestId("triage-snooze-revisit-date").fill("2099-12-25");
    await modal.getByTestId("triage-snooze").click();
    await expect(modal).toBeHidden();

    const deferredCard = page.getByTestId("triage-deferred-item-trg-a0000001");
    await expect(deferredCard).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByTestId("triage-deferred-item-trg-a0000001-revisit"),
    ).toHaveText("Returns on 2099-12-25");
    await expect(page.getByTestId("triage-item-trg-a0000001")).toHaveCount(0);
  });
});
