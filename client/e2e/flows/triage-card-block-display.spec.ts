/*
 * Spec — triage-card-block-display (iterate-2026-10-10-triage-card-block-display).
 * Sven (iPad/iPhone Safari, 2026-10-10): after some Triage cards a 170px+
 * empty gap appeared; Edge/Chromium laid the same list out tight. Cause: the
 * card <button> is `inline-block`, so it sits on a line box and WebKit adds
 * baseline/descender space under a card whose line-clamped text sets the
 * baseline. Real-browser geometry — jsdom has no layout engine.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

let project: SeededProject;
test.beforeEach(async ({ page, request }) => {
  project = await seedProject(request, { name: `triage-block-${Date.now()}` });
  await setActiveProject(page, project.projectId);
  const dir = path.join(project.path, ".shipwright");
  mkdirSync(dir, { recursive: true });
  const long = "Long body text that wraps over several lines so the two-line clamp engages. ".repeat(8);
  const line = (n: number, status = "triage") =>
    JSON.stringify({
      event: "append", id: `trg-blk0000${n}`, ts: "2026-09-12T08:00:00Z", originalTs: "2026-09-12T08:00:00Z",
      source: "manual", severity: "medium", kind: "bug", title: `Card ${n}`, detail: long, evidencePath: null,
      runId: null, commit: null, dedupKey: null, status, suggestedPriority: "P2",
      suggestedDomain: "engineering", statusBy: null, statusReason: null, promotedTaskId: null,
      revisitAt: null, revisitDue: false, amendedBy: null, amendedAt: null,
    });
  writeFileSync(
    path.join(dir, "triage.jsonl"),
    [JSON.stringify({ v: 1, schema: "triage", created: "2026-09-12T08:00:00Z" }), line(1), line(2), line(3), line(4), line(5, "snoozed"), line(6, "snoozed")].join("\n") + "\n",
    "utf-8",
  );
});
test.afterEach(async ({ request }) => {
  await cleanupProject(request, project);
});

// @covers FR-01.38
test("triage cards are block-level and stack with only the list gap between them", async ({ page }) => {
  await page.goto("/triage");
  const cards = page.locator('button[data-testid^="triage-item-trg-blk"]');
  await expect(cards).toHaveCount(4, { timeout: 35_000 });
  const rows = await cards.evaluateAll((els) =>
    els.map((e) => ({ display: getComputedStyle(e).display, top: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height })),
  );
  for (const r of rows) expect(r.display, "card must not sit on a line box").toBe("block");
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].top - (rows[i - 1].top + rows[i - 1].h);
    expect(gap, `gap before card ${i + 1}`).toBeLessThanOrEqual(12);
  }
  // Deferred (parked) cards share the same <button> markup.
  const parked = page.locator('button[data-testid^="triage-deferred-item-trg-blk"]');
  await expect(parked).toHaveCount(2);
  const pr = await parked.evaluateAll((els) =>
    els.map((e) => ({ display: getComputedStyle(e).display, top: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height })),
  );
  for (const r of pr) expect(r.display).toBe("block");
  expect(pr[1].top - (pr[0].top + pr[0].h), "gap between parked cards").toBeLessThanOrEqual(12);
});
