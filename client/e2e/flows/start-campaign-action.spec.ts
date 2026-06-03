import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * FR-01.33 / ADR-148 — Triage "Start Campaign" action, F0.5 web E2E
 * (iterate-2026-06-03-start-campaign-action).
 *
 * Self-seeding (Node fs + the API), so it runs against any live stack: it
 * creates a temp fixture project holding ONE **draft** campaign whose
 * `expands_triage` points at a triage item, registers the project, then drives
 * the real flow:
 *   /triage → open the umbrella item → click "Start Campaign" (draft → active)
 *   → the Task Board shows that campaign as ACTIVE (it was HIDDEN while draft,
 *   proving the write landed + the board re-read it).
 *
 * The draft→hidden / active→shown asymmetry is the load-bearing assertion: a
 * lane card for the slug can only appear if the POST start actually flipped the
 * producer-owned status the board filters on.
 */

// Unique per run so the spec is idempotent against a persistent stack: a
// fixed id would collide with a prior run's still-registered project (the
// triage item isn't auto-dismissed on start), making `getByTestId` ambiguous.
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SLUG = `2026-06-03-e2e-${RUN}`;
const TRIAGE_ID = `trg-e2e${RUN}`;

test.describe("Triage Start Campaign action (FR-01.33)", () => {
  test("draft campaign-umbrella item → Start Campaign → board shows it active", async ({
    page,
    request,
  }) => {
    // 1. Seed a fixture project on disk (the stack runs on the same machine).
    const projectDir = mkdtempSync(path.join(tmpdir(), "sw-start-campaign-"));
    const campDir = path.join(
      projectDir,
      ".shipwright",
      "planning",
      "iterate",
      "campaigns",
      SLUG,
    );
    mkdirSync(path.join(campDir, "sub-iterates"), { recursive: true });
    // status.json: draft → the board hides it until it is started.
    writeFileSync(
      path.join(campDir, "status.json"),
      JSON.stringify(
        {
          campaign: SLUG,
          branch_strategy: "stacked",
          status: "draft",
          sub_iterates: [
            { id: "B0", slug: "alpha", status: "pending", commit: null, branch: null },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
    // campaign.md: `expands_triage` links the umbrella triage item; the
    // Sub-Iterates table gives ordering + titles.
    writeFileSync(
      path.join(campDir, "campaign.md"),
      `---\ncampaign: ${SLUG}\nbranch_strategy: stacked\nexpands_triage: ${TRIAGE_ID}\nstatus: draft\n---\n\n` +
        `# Campaign: ${SLUG}\n\n## Intent\n\nE2E fixture campaign.\n\n` +
        `## Sub-Iterates\n\n| ID | Slug | Title | Status |\n|---|---|---|---|\n| B0 | alpha | Alpha | pending |\n`,
      "utf-8",
    );
    writeFileSync(path.join(campDir, "sub-iterates", "B0-alpha.md"), "# B0\n", "utf-8");
    // triage.jsonl: an umbrella triage item whose id == the campaign's expands_triage.
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.jsonl"),
      [
        `{"v":1,"schema":"triage","created":"2026-06-03T08:00:00Z"}`,
        JSON.stringify({
          event: "append",
          id: TRIAGE_ID,
          ts: "2026-06-03T08:01:00Z",
          originalTs: "2026-06-03T08:01:00Z",
          source: "campaign",
          severity: "medium",
          kind: "improvement",
          title: "E2E umbrella campaign item",
          detail: "Start me from triage",
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: `campaign:${TRIAGE_ID}`,
          status: "triage",
          suggestedPriority: "P2",
          suggestedDomain: "engineering",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    // 2. Register the project via the API (server generates id/createdAt).
    const reg = await request.post("/api/projects", {
      data: { name: "E2E Start Campaign", path: projectDir, profile: "vite-hono" },
    });
    expect(reg.ok()).toBeTruthy();

    // 3. Triage: open the umbrella item's detail modal.
    await page.goto("/triage");
    const card = page.getByTestId(`triage-item-${TRIAGE_ID}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
    await expect(page.getByTestId("triage-detail-modal")).toBeVisible();

    // 4. Start Campaign (draft → active) + auto-navigate to the board.
    const startBtn = page.getByTestId("triage-start-campaign");
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 5. The board now shows the campaign that was hidden while draft.
    await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`campaign-lane-card-${SLUG}`)).toBeVisible({
      timeout: 15000,
    });
  });
});
