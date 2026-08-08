import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Triage Edit-in-place (amend) — F0.5 web-surface E2E
 * (iterate-2026-08-08-triage-amend-reader).
 *
 * End-to-end proof through the REAL stack (server + client + real
 * triage.jsonl on disk) that the pencil Edit toggle actually writes an
 * `amend` event and the resolved card reflects it — the piece unit tests
 * (which mock useAmendTriageItem) cannot prove: that the delta round-trips
 * through the real HTTP route, the real file write, and back through the
 * real read path into the DOM.
 *
 * Self-seeds via the real POST /api/projects + on-disk triage.jsonl writes
 * and cleans up afterwards (mirrors triage-filters-sort-parked.spec.ts).
 */

function appendLine(id: string, title: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-08-08T08:00:00Z",
    originalTs: "2026-08-08T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title,
    detail: "Original detail",
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

async function seedProject(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  lines: string[],
): Promise<{ projectDir: string; projectId: string; triagePath: string }> {
  const projectDir = path.join(tmpdir(), `${slug}-${Date.now()}`);
  mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
  const triagePath = path.join(projectDir, ".shipwright", "triage.jsonl");
  writeFileSync(
    triagePath,
    [`{"v":1,"schema":"triage","created":"2026-08-08T00:00:00Z"}`, ...lines].join("\n") + "\n",
    "utf-8",
  );
  const created = await request.post("/api/projects", {
    data: { name: slug, path: projectDir.split(path.sep).join("/") },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { data: { id: string } }).data.id;
  return { projectDir, projectId, triagePath };
}

test.describe("Triage Edit-in-place (amend)", () => {
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

  test("editing title + severity writes an amend event and the resolved card + provenance update", async ({
    page,
    request,
  }) => {
    let triagePath = "";
    ({ projectDir, projectId, triagePath } = await seedProject(request, "triage-amend", [
      appendLine("trg-a3e0d001", "Original title"),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-a3e0d001")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-a3e0d001").click();
    await expect(page.getByTestId("triage-detail-modal")).toBeVisible();

    await page.getByTestId("triage-edit-toggle").click();
    await expect(page.getByTestId("triage-amend-form")).toBeVisible();

    const titleInput = page.getByTestId("triage-amend-title");
    await titleInput.fill("");
    await titleInput.fill("Corrected title");
    await page.getByTestId("triage-amend-severity").selectOption("critical");
    await page.getByTestId("triage-amend-save").click();

    // Edit mode closes; the resolved card shows the correction in place.
    await expect(page.getByTestId("triage-amend-form")).toHaveCount(0);
    await expect(page.getByTestId("triage-detail-modal")).toContainText("Corrected title");
    await expect(page.getByTestId("triage-amend-provenance")).toContainText("Last edited by webui");

    // Close and re-open from the list — the list card itself reflects the
    // amend too, not just the still-open modal instance.
    await page.getByTestId("triage-detail-modal").getByLabel("Close").click();
    await expect(page.getByTestId("triage-item-trg-a3e0d001")).toContainText("Corrected title", {
      timeout: 15000,
    });

    // Root-cause proof: an `amend` event landed on disk, delta-only.
    await expect(async () => {
      const lines = readFileSync(triagePath, "utf-8").split("\n").filter(Boolean);
      const amendLine = lines.map((l) => JSON.parse(l)).find((e) => e.event === "amend");
      expect(amendLine).toMatchObject({
        id: "trg-a3e0d001",
        by: "webui",
        title: "Corrected title",
        severity: "critical",
      });
      expect(amendLine.detail).toBeUndefined();
    }).toPass({ timeout: 10000 });
  });

  test("Cancel discards edits — no amend event is written and the original title stays", async ({
    page,
    request,
  }) => {
    let triagePath = "";
    ({ projectDir, projectId, triagePath } = await seedProject(request, "triage-amend-cancel", [
      appendLine("trg-ca4ce001", "Untouched title"),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-ca4ce001")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-ca4ce001").click();
    await page.getByTestId("triage-edit-toggle").click();

    const titleInput = page.getByTestId("triage-amend-title");
    await titleInput.fill("");
    await titleInput.fill("Should not be saved");
    await page.getByTestId("triage-amend-cancel").click();

    await expect(page.getByTestId("triage-amend-form")).toHaveCount(0);
    await expect(page.getByTestId("triage-detail-modal")).toContainText("Untouched title");

    const lines = readFileSync(triagePath, "utf-8").split("\n").filter(Boolean);
    expect(lines.some((l) => JSON.parse(l).event === "amend")).toBe(false);
  });
});
