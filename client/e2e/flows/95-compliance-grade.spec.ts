/*
 * 95-compliance-grade.spec.ts — FR-01.43 end-to-end.
 *
 * Seeds two real (temp) projects — one WITH a
 * `.shipwright/compliance/dashboard.md`, one WITHOUT — registers them via
 * POST /api/projects, then drives the UI through the full read → route →
 * reader → DOM chain:
 *   - Projects table: the dashboard project shows the parsed Grade badge and
 *     opens the detail modal (Control-Verdict + CI-Security tables); the
 *     no-dashboard project shows NO badge (graceful absence).
 *   - Task Board header: with the dashboard project selected, the same Grade
 *     pill renders + opens the modal (the second render site).
 *
 * Self-contained: inlines a representative dashboard.md so the spec doesn't
 * depend on a cross-workspace fixture path. Cleans up both projects + temp dirs.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DASHBOARD = [
  "# Compliance Dashboard",
  "",
  "Generated: 2026-06-28T21:55:11.404445+00:00",
  "Profile: vite-hono",
  "",
  "## ✅ Control Verdict",
  "",
  "> **Under full control. Primarily capped by requirement traceability.**",
  "",
  "### Control Grade: **A** (99/100) — Under full control.",
  "",
  "| | Dimension | Signal | Anchor |",
  "|---|-----------|--------|--------|",
  "| ✅ | Requirement traceability | 41/41 FRs covered | DO-178C |",
  "| ✅ | Test health | 3464/3464 | OpenSSF |",
  "",
  "## 🛡️ CI Security (fail-closed gate)",
  "",
  "| Severity | Count |",
  "|----------|-------|",
  "| Critical | 0 |",
  "| High | 0 |",
  "",
  "## Compliance Artifacts",
  "",
  "| Document | Path |",
  "|----------|------|",
  "| Event Log | [events](../../shipwright_events.jsonl) |",
].join("\n");

async function seedProject(
  request: APIRequestContext,
  name: string,
  withDashboard: boolean,
): Promise<{ id: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compliance-e2e-"));
  if (withDashboard) {
    await fs.mkdir(path.join(dir, ".shipwright", "compliance"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".shipwright", "compliance", "dashboard.md"),
      DASHBOARD,
      "utf-8",
    );
  }
  const res = await request.post("/api/projects", { data: { name, path: dir } });
  if (!res.ok()) {
    throw new Error(`POST /api/projects: HTTP ${res.status()} — ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { id: string } };
  return { id: body.data.id, dir };
}

test.describe("FR-01.43 compliance grade", () => {
  let withId = "";
  let withDir = "";
  let withoutId = "";
  let withoutDir = "";

  test.beforeAll(async ({ request }) => {
    const a = await seedProject(request, "Compliance E2E (graded)", true);
    withId = a.id;
    withDir = a.dir;
    const b = await seedProject(request, "Compliance E2E (no dashboard)", false);
    withoutId = b.id;
    withoutDir = b.dir;
  });

  test.afterAll(async ({ request }) => {
    for (const id of [withId, withoutId]) {
      if (id) {
        await request.delete(`/api/projects/${encodeURIComponent(id)}`).catch(() => {});
      }
    }
    for (const dir of [withDir, withoutDir]) {
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("Projects table: graded project shows the badge + modal, no-dashboard project shows none", async ({
    page,
  }) => {
    await page.goto("/projects");

    // AC-F: the Grade column renders the parsed grade for the dashboard project.
    const badge = page.getByTestId(`compliance-grade-${withId}`);
    await expect(badge).toHaveText("A", { timeout: 15_000 });
    await expect(badge).toHaveAttribute("title", /Under full control/);

    // AC-B graceful absence: the no-dashboard project renders NO badge. (Its
    // /compliance read returns {status:"missing"} → the badge is null. Asserted
    // AFTER the graded badge resolves, so both queries have settled.)
    await expect(page.getByTestId(`compliance-grade-${withoutId}`)).toHaveCount(0);

    // AC-G: clicking opens the detail modal with the dimension + CI tables.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await badge.click();
    const modal = page.getByTestId("compliance-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Grade A (99/100)");
    await expect(modal).toContainText("Requirement traceability");
    await expect(modal).toContainText("CI Security");
    // The trailing "Compliance Artifacts" section is sliced out (AC-E).
    await expect(modal).not.toContainText("Compliance Artifacts");
  });

  test("Task Board header: the Grade pill renders for the selected project + opens the modal", async ({
    page,
  }) => {
    // ?projectId wins in useProjectFilter → the board header pill renders for
    // the single selected project (AC-H, second render site).
    await page.goto(`/?projectId=${encodeURIComponent(withId)}`);

    const header = page.getByTestId("task-board-header");
    const pill = header.getByTestId(`compliance-grade-${withId}`);
    await expect(pill).toHaveText("A", { timeout: 15_000 });

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await pill.click();
    const modal = page.getByTestId("compliance-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Grade A (99/100)");
    await expect(modal).toContainText("Requirement traceability");
  });
});
