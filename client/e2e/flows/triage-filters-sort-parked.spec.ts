import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Triage filters, two-level sort, and Parked filter — F0.5 web-surface E2E
 * (iterate-2026-08-08-triage-filters-sort-parked).
 *
 * End-to-end proof through the REAL stack (server + client + real triage.jsonl
 * on disk) of what unit tests cannot: that the pieces compose as rendered —
 * a chip click actually removes/restores a card, a sort-key change actually
 * reorders the DOM, the Parked filter's default-hidden state and its two
 * escape hatches (AC8 due-parked, AC9 dateless-park) hold up against the
 * real server-computed `revisitDue`, and the all-filtered-out banner's
 * Clear-filters button actually restores a filtered-away card.
 *
 * Self-seeds via the real POST /api/projects + on-disk triage.jsonl writes
 * and cleans up the registration + temp dir afterwards (mirrors
 * triage-deferred-envelope.spec.ts / triage-pending-delivery.spec.ts).
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

async function seedProject(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  lines: string[],
): Promise<{ projectDir: string; projectId: string }> {
  const projectDir = path.join(tmpdir(), `${slug}-${Date.now()}`);
  mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
  writeFileSync(
    path.join(projectDir, ".shipwright", "triage.jsonl"),
    [`{"v":1,"schema":"triage","created":"2026-06-01T00:00:00Z"}`, ...lines].join("\n") + "\n",
    "utf-8",
  );
  const created = await request.post("/api/projects", {
    data: { name: slug, path: projectDir.split(path.sep).join("/") },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { data: { id: string } }).data.id;
  return { projectDir, projectId };
}

test.describe("Triage filters, sort, and Parked filter", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = "";
    projectId = "";
  });

  test("AC1/AC2/AC5: excluding a Priority chip hides matching items and shows the all-filtered-out banner; Clear filters restores them", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(request, "triage-filters-priority", [
      appendLine("trg-p1item001", "P1 item", { suggestedPriority: "P1", suggestedDomain: "engineering" }),
      appendLine("trg-p2item002", "P2 item", { suggestedPriority: "P2", suggestedDomain: "security" }),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-p1item001")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("triage-item-trg-p2item002")).toBeVisible();

    // AC1: chips start active (nothing excluded) — clicking P1 excludes it.
    await expect(page.getByTestId("triage-filter-priority-P1")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("triage-filter-priority-P1").click();
    await expect(page.getByTestId("triage-filter-priority-P1")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("triage-item-trg-p1item001")).toHaveCount(0);
    await expect(page.getByTestId("triage-item-trg-p2item002")).toBeVisible();

    // AC2: excluding P2 on top hides the last remaining item -> AC5 banner.
    await page.getByTestId("triage-filter-priority-P2").click();
    const banner = page.getByTestId("triage-all-filtered-out");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("hidden by the active filters");
    await expect(page.getByTestId("triage-item-trg-p1item001")).toHaveCount(0);
    await expect(page.getByTestId("triage-item-trg-p2item002")).toHaveCount(0);

    // Clear filters restores both — the button, not just the copy (AC5/AC8).
    await page.getByTestId("triage-all-filtered-out-clear").click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("triage-item-trg-p1item001")).toBeVisible();
    await expect(page.getByTestId("triage-item-trg-p2item002")).toBeVisible();
  });

  test("AC4: two-level sort (Name asc) actually reorders the rendered cards through the real stack", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(request, "triage-filters-sort", [
      appendLine("trg-zzzz9999", "Zulu item"),
      appendLine("trg-aaaa1111", "Alpha item"),
      appendLine("trg-mmmm5555", "Mike item"),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-aaaa1111")).toBeVisible({ timeout: 15000 });

    const container = page.getByTestId(`triage-open-items-${projectId}`);
    // `[data-nav-item]` scopes to the card `<button>` itself — a bare
    // `[data-testid^="triage-item-"]` selector also matches the card's own
    // nested `-relative-ts` span, which carries the same prefix.
    const cardTestId = async (index: number): Promise<string | null> =>
      container.locator("[data-nav-item]").nth(index).getAttribute("data-testid");

    // Set primary sort to Name, ascending — the two-level control, not a
    // hardcoded default. DEFAULT_SORT_STATE is Modified desc; switch key
    // first, then confirm/flip direction to ascending.
    await page.getByTestId("triage-sort-primary-key").selectOption("name");
    const directionBtn = page.getByTestId("triage-sort-primary-direction");
    if ((await directionBtn.getAttribute("aria-label"))?.includes("Descending")) {
      await directionBtn.click();
    }
    await expect(directionBtn).toHaveAttribute("aria-label", /Ascending/);

    await expect(async () => {
      expect(await cardTestId(0)).toBe("triage-item-trg-aaaa1111");
      expect(await cardTestId(1)).toBe("triage-item-trg-mmmm5555");
      expect(await cardTestId(2)).toBe("triage-item-trg-zzzz9999");
    }).toPass({ timeout: 10000 });

    // Flip to descending — the SAME control, order reverses.
    await directionBtn.click();
    await expect(async () => {
      expect(await cardTestId(0)).toBe("triage-item-trg-zzzz9999");
      expect(await cardTestId(1)).toBe("triage-item-trg-mmmm5555");
      expect(await cardTestId(2)).toBe("triage-item-trg-aaaa1111");
    }).toPass({ timeout: 10000 });
  });

  test("Parked filter defaults hidden; AC8 a due park survives regardless; AC9 a dateless park stays visible without toggling Parked; toggling Parked reveals the dated-not-due park", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(request, "triage-filters-parked", [
      // Dated, not due — hidden by the Parked filter's own default.
      appendLine("trg-future0001", "Future park"),
      statusLine("trg-future0001", "snoozed", { revisitAt: "2099-06-01" }),
      // Past date — server auto-resolves to status:triage, revisitDue:true
      // (same mechanism triage-deferred-envelope.spec.ts exercises) — must
      // survive the Priority filter below (AC8).
      appendLine("trg-due00002", "Due park", { suggestedPriority: "P2" }),
      statusLine("trg-due00002", "snoozed", { revisitAt: "2020-01-01" }),
      // No date at all — never becomes due, stays visible permanently (AC9).
      appendLine("trg-nodate003", "Undated park"),
      statusLine("trg-nodate003", "snoozed"),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-due00002")).toBeVisible({ timeout: 15000 });

    // AC8 — the due park is already OPEN (status:triage), not gated by the
    // Parked filter at all; it survives even when its own Priority (P2) is
    // actively excluded.
    await page.getByTestId("triage-filter-priority-P2").click();
    await expect(page.getByTestId("triage-item-trg-due00002")).toBeVisible();

    // AC9 — the undated park renders in Deferred without ever toggling
    // Parked on.
    await expect(page.getByTestId("triage-filter-parked-parked")).toHaveAttribute("aria-pressed", "false");
    const deferred = page.getByTestId("triage-deferred-section");
    await expect(deferred).toBeVisible();
    await expect(page.getByTestId("triage-deferred-item-trg-nodate003")).toBeVisible();
    await expect(
      page.getByTestId("triage-deferred-item-trg-nodate003-revisit"),
    ).toHaveText("No revisit date set");

    // The dated-not-due park is hidden by the Parked default, and the
    // hidden-count hint says so.
    await expect(page.getByTestId("triage-deferred-item-trg-future0001")).toHaveCount(0);
    await expect(page.getByTestId("triage-deferred-hidden-count")).toContainText("1 parked item");

    // Toggling Parked on reveals it.
    await page.getByTestId("triage-filter-parked-parked").click();
    await expect(page.getByTestId("triage-deferred-item-trg-future0001")).toBeVisible();
    await expect(
      page.getByTestId("triage-deferred-item-trg-future0001-revisit"),
    ).toHaveText("Returns on 2099-06-01");
  });
});
