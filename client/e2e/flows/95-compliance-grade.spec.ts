/*
 * 95-compliance-grade.spec.ts — FR-01.43 end-to-end.
 *
 * Seeds a real (temp) project dir containing a
 * `.shipwright/compliance/dashboard.md`, registers it via POST /api/projects,
 * then drives the UI: the Projects-table Grade badge must render the parsed
 * grade, and clicking it must open the detail modal rendering the dashboard's
 * dimension + CI-Security tables (the full read → route → reader → DOM chain).
 *
 * Self-contained: inlines a representative dashboard.md so the spec doesn't
 * depend on a cross-workspace fixture path. Cleans up the project + temp dir.
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
): Promise<{ id: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compliance-e2e-"));
  await fs.mkdir(path.join(dir, ".shipwright", "compliance"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".shipwright", "compliance", "dashboard.md"),
    DASHBOARD,
    "utf-8",
  );
  const res = await request.post("/api/projects", {
    data: { name: "Compliance E2E", path: dir },
  });
  if (!res.ok()) {
    throw new Error(`POST /api/projects: HTTP ${res.status()} — ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { id: string } };
  return { id: body.data.id, dir };
}

test.describe("FR-01.43 compliance grade", () => {
  let projectId = "";
  let projectDir = "";

  test.beforeAll(async ({ request }) => {
    const seeded = await seedProject(request);
    projectId = seeded.id;
    projectDir = seeded.dir;
  });

  test.afterAll(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${encodeURIComponent(projectId)}`).catch(() => {});
    }
    if (projectDir) {
      await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("shows the grade badge on the Projects page and opens the detail modal", async ({
    page,
  }) => {
    await page.goto("/projects");

    // AC-F: the Grade column renders the parsed grade for the seeded project.
    const badge = page.getByTestId(`compliance-grade-${projectId}`);
    await expect(badge).toHaveText("A", { timeout: 15_000 });
    await expect(badge).toHaveAttribute("title", /Under full control/);

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
});
