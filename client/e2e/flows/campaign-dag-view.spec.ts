import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Campaign dependency-graph view — F0.5 web-surface E2E
 * (iterate-2026-09-29-campaign-dag-view, card trg-e542ce03).
 *
 * The card RENDERS the monorepo scheduler's verdict and never derives readiness.
 * The first test drives the REAL pipeline end to end: a fixture campaign whose
 * own worktree (`.worktrees/campaign-<slug>`) holds a `loop_state.json`, the real
 * `GET /api/campaigns/:p/:slug/readiness` route, the real `loop_claim.py
 * readiness` command (via the harness' uv shim → python), and the real
 * `POST /launch` guard. It needs the scheduler script: set
 * SHIPWRIGHT_LOOP_CLAIM_SCRIPT (the isolated stack has an ephemeral HOME, so the
 * plugin cache is not at its default location there). Without it the test is
 * SKIPPED loudly, not silently passed.
 *
 * The second test (always runs) stubs the endpoint to prove the degraded paths
 * render honestly and keep the pre-existing "Launch next" fallback.
 */

const SLUG = "2026-09-29-dag-view-demo";
const SCRIPT = process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT ?? "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...args], { cwd, encoding: "utf8" }).trim();
}

test.describe("Campaign dependency-graph view", () => {
  let projectDir = "";
  let projectId = "";
  const taskIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of taskIds.splice(0)) await request.delete(`/api/external/tasks/${id}`).catch(() => {});
    if (projectId) await request.delete(`/api/projects/${projectId}`).catch(() => {});
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = "";
    projectId = "";
  });

  /** Seed a project + campaign (A merged → B ready → C waits on B) and register it. */
  async function seed(request: import("@playwright/test").APIRequestContext, opts: { worktreeState: boolean }) {
    projectDir = realpathSync(mkdtempSync(path.join(tmpdir(), "dag-view-")));
    const campaignDir = path.join(projectDir, ".shipwright", "planning", "iterate", "campaigns", SLUG);
    const subDir = path.join(campaignDir, "sub-iterates");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(campaignDir, "campaign.md"),
      `---\ncampaign: ${SLUG}\nbranch_strategy: independent\nstatus: active\n---\n\n# Campaign: ${SLUG}\n\n## Intent\n\nDAG view.\n\n## Sub-Iterates\n\n| ID | Slug | Title | Depends on | Status |\n|---|---|---|---|---|\n| A | alpha | Alpha | | complete |\n| B | beta | Beta | A | pending |\n| C | gamma | Gamma | B | pending |\n`,
      "utf-8",
    );
    writeFileSync(
      path.join(campaignDir, "status.json"),
      JSON.stringify({
        status: "active",
        branch_strategy: "independent",
        sub_iterates: [
          { id: "A", slug: "alpha", status: "complete", depends_on: [] },
          { id: "B", slug: "beta", status: "pending", depends_on: ["A"] },
          { id: "C", slug: "gamma", status: "pending", depends_on: ["B"] },
        ],
      }),
      "utf-8",
    );
    for (const [id, s] of [["A", "alpha"], ["B", "beta"], ["C", "gamma"]]) writeFileSync(path.join(subDir, `${id}-${s}.md`), `# ${id}\n`, "utf-8");

    if (opts.worktreeState) {
      // The campaign's OWN worktree — a real git repo so the scheduler's ancestry
      // check has a base ("independent" → main) to compare against.
      const wt = path.join(projectDir, ".worktrees", `campaign-${SLUG}`);
      mkdirSync(path.join(wt, ".shipwright"), { recursive: true });
      git(wt, "init", "-q", "-b", "main");
      git(wt, "commit", "-q", "--allow-empty", "-m", "init");
      const sha = git(wt, "rev-parse", "HEAD");
      const spec = (id: string, s: string) => `.shipwright/planning/iterate/campaigns/${SLUG}/sub-iterates/${id}-${s}.md`;
      writeFileSync(
        path.join(wt, ".shipwright", "loop_state.json"),
        JSON.stringify({
          loop_id: "dag-e2e",
          kind: "sub_iterate",
          branch_strategy: "independent",
          finalized: false,
          units: [
            { id: "A", status: "merged", merged_commit: sha, depends_on: [], spec_path: spec("A", "alpha") },
            { id: "B", status: "pending", depends_on: ["A"], spec_path: spec("B", "beta") },
            { id: "C", status: "pending", depends_on: ["B"], spec_path: spec("C", "gamma") },
          ],
        }),
        "utf-8",
      );
    }

    const created = await request.post("/api/projects", { data: { name: "dag-view-demo", path: projectDir.split(path.sep).join("/") } });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;
  }

  async function openCard(page: import("@playwright/test").Page) {
    await page.goto(`/?projectId=${encodeURIComponent(projectId)}`);
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId(`campaign-lane-card-${SLUG}`)).toBeVisible({ timeout: 15000 });
    await page.getByTestId(`campaign-toggle-${SLUG}`).click();
  }

  test("real scheduler verdict: A done, B ready with a guided Launch, C waits on B — and the server refuses C", async ({ page, request }) => {
    test.skip(!SCRIPT || !existsSync(SCRIPT), "SHIPWRIGHT_LOOP_CLAIM_SCRIPT must point at the monorepo's loop_claim.py (real-pipeline test)");
    await seed(request, { worktreeState: true });

    // The route itself: the scheduler's verdict, verbatim.
    const res = await request.get(`/api/campaigns/${encodeURIComponent(projectId)}/${SLUG}/readiness`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; report?: { ready_ids: string[]; units: Array<{ id: string; ready: boolean }> } };
    expect(body.status).toBe("report");
    expect(body.report?.ready_ids).toEqual(["B"]);

    await openCard(page);
    await expect(page.getByTestId("campaign-unit-ready-B")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("campaign-step-A")).toHaveAttribute("data-dag-kind", "complete");
    await expect(page.getByTestId("campaign-step-C")).toHaveAttribute("data-dag-kind", "waiting");
    await expect(page.getByTestId("campaign-unit-blocker-C")).toHaveText(/waiting for B to merge/);
    await expect(page.getByTestId("campaign-unit-deps-C")).toHaveText(/after B/);

    // Guided Launch only where the scheduler says ready.
    await expect(page.getByTestId(`campaign-step-launch-${SLUG}-B`)).toBeVisible();
    await expect(page.getByTestId(`campaign-step-launch-${SLUG}-C`)).toHaveCount(0);
    await expect(page.getByTestId(`campaign-step-launch-${SLUG}`)).toHaveCount(0);
    await expect(page.getByTestId(`campaign-autonomous-launch-${SLUG}`)).toBeVisible();

    // The confirm dialog shows the exact command for THAT unit; cancel creates nothing.
    await page.getByTestId(`campaign-step-launch-${SLUG}-B`).click();
    await expect(page.getByTestId(`campaign-step-command-${SLUG}`)).toContainText("B-beta.md");
    await expect(page.getByTestId(`campaign-step-notice-${SLUG}`)).toHaveCount(0); // verdict present → nothing unchecked
    await page.getByTestId(`campaign-step-cancel-${SLUG}`).click();

    // Server-side enforcement (a direct API launch of a blocked unit is refused).
    const mk = async () => {
      const c = await request.post("/api/external/tasks", { data: { title: `dag-${Date.now()}`, cwd: projectDir, projectId } });
      expect(c.status()).toBe(200);
      const id = ((await c.json()) as { task: { taskId: string } }).task.taskId;
      taskIds.push(id);
      return id;
    };
    const blocked = await request.post(`/api/external/tasks/${await mk()}/launch`, { data: { campaignStep: { slug: SLUG, stepId: "C" } } });
    expect(blocked.status()).toBe(409);
    const blockedBody = (await blocked.json()) as { error: string; blocked_by: Array<{ id: string; reason: string }> };
    expect(blockedBody.error).toBe("campaign_step_not_ready");
    expect(blockedBody.blocked_by[0]).toMatchObject({ id: "B", reason: "not_merged" });

    const ok = await request.post(`/api/external/tasks/${await mk()}/launch`, { data: { campaignStep: { slug: SLUG, stepId: "B" }, dryRun: true } });
    expect(ok.status()).toBe(200);
    const okBody = (await ok.json()) as { commands: { posix: string }; readinessChecked?: false };
    expect(okBody.commands.posix).toContain("B-beta.md");
    expect(okBody.readinessChecked).toBeUndefined(); // it WAS checked
  });

  test("a wave run (unit 'running' in the campaign's own worktree) blocks a hand-launch: 'Run attached'", async ({ page, request }) => {
    test.skip(!SCRIPT || !existsSync(SCRIPT), "SHIPWRIGHT_LOOP_CLAIM_SCRIPT must point at the monorepo's loop_claim.py (real-pipeline test)");
    await seed(request, { worktreeState: true });
    const statePath = path.join(projectDir, ".worktrees", `campaign-${SLUG}`, ".shipwright", "loop_state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as { units: Array<Record<string, unknown>> };
    state.units[1] = { ...state.units[1], status: "running", claimed_at: new Date().toISOString() };
    writeFileSync(statePath, JSON.stringify(state), "utf-8");

    await openCard(page);
    await expect(page.getByTestId(`campaign-autonomous-launch-${SLUG}`)).toHaveText(/Run attached/, { timeout: 15000 });
    await expect(page.getByTestId(`campaign-autonomous-launch-${SLUG}`)).toBeDisabled();
  });

  test("no loop / scheduler down: edges + banner shown, card-level 'Launch next' is the fallback", async ({ page, request }) => {
    await seed(request, { worktreeState: false });
    await page.route("**/api/campaigns/*/*/readiness", (route) =>
      route.fulfill({ json: { status: "engine-unavailable", reason: "uv isn't installed" } }),
    );
    await openCard(page);
    await expect(page.getByTestId(`campaign-readiness-banner-${SLUG}`)).toHaveText(/Readiness unavailable: uv isn't installed/, { timeout: 15000 });
    await expect(page.getByTestId("campaign-unit-deps-B")).toHaveText(/after A/);
    await expect(page.getByTestId(`campaign-step-launch-${SLUG}`)).toBeVisible();
    await expect(page.getByTestId(`campaign-step-launch-${SLUG}-B`)).toHaveCount(0);
  });
});
