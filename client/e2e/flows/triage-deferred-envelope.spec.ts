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

// @covers FR-01.30
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

    // AC6 — iterate-2026-11-08-triage-page-redesign: parked items live in a
    // read-only Parked section. The Show-parked switch defaults to OFF, so
    // the dated park (future003) starts hidden and the undated one
    // (nodate004) stays visible via its own exception.
    const parked = page.getByTestId("triage-parked-section");
    await expect(parked).toBeVisible();
    await expect(parked).toContainText("Parked");
    await expect(parked.locator("li[data-testid^=\"triage-item-\"]")).toHaveCount(1);
    await expect(page.getByTestId("triage-item-trg-future003")).toHaveCount(0);
    await page.getByTestId("triage-filter-menu-trigger").click();
    await page.getByTestId("triage-filter-show-parked").click();
    await page.keyboard.press("Escape");
    await expect(parked.locator("li[data-testid^=\"triage-item-\"]")).toHaveCount(2);

    const futureCard = page.getByTestId("triage-item-trg-future003");
    await expect(futureCard).toBeVisible();
    await expect(
      page.getByTestId("triage-deferred-item-trg-future003-revisit"),
    ).toHaveText("Parked — returns on 2099-06-01");

    const undatedCard = page.getByTestId("triage-item-trg-nodate004");
    await expect(undatedCard).toBeVisible();
    await expect(
      page.getByTestId("triage-deferred-item-trg-nodate004-revisit"),
    ).toHaveText("Parked — no revisit date set");

    // Parked is read-only — the card has no action buttons, and opening it
    // shows the detail view with no action row (item.status !== "triage").
    await expect(page.getByTestId("triage-card-fix-now-trg-future003")).toHaveCount(0);
    await page.getByTestId("triage-item-trg-future003-title").click();
    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("triage-snooze-menu-trg-future003")).toHaveCount(0);
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
    await expect(page.getByTestId("triage-item-trg-a0000001")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-a0000001-title").click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    // The Snooze menu is a portaled popover (never clipped by the dialog).
    await modal.getByTestId("triage-snooze-menu-trg-a0000001").click();
    await page.getByTestId("triage-snooze-date").fill("2099-12-25");
    await page.getByTestId("triage-snooze-date-go").click();
    await expect(modal).toBeHidden();

    // The newly-snoozed item is a DATED park, hidden by the Show-parked
    // default (off) — switch it on to see it, same as any other dated park.
    await page.getByTestId("triage-filter-menu-trigger").click();
    await page.getByTestId("triage-filter-show-parked").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("triage-parked-section")).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByTestId("triage-deferred-item-trg-a0000001-revisit"),
    ).toHaveText("Parked — returns on 2099-12-25");
    await expect(page.getByTestId("triage-open-items").getByTestId("triage-item-trg-a0000001")).toHaveCount(0);
  });
});
