/*
 * QUARANTINED — v0.9.3 AC-2 (Resume CTA hides within 2.5s of the click).
 *
 * Runs only in the `quarantine` Playwright project: `npm run test:e2e:quarantine`.
 * NOT in CI, NOT in the default suite, and deliberately NOT deleted.
 *
 * ── Why it cannot run on an isolated stack ──────────────────────────────────
 * The assertion is that the Resume CTA STAYS hidden after the click. Measured
 * behaviour on an isolated stack: it hides at ~270 ms and REAPPEARS at ~1060 ms,
 * every time. That is the server being right, not wrong. A resumed session only
 * stays "live" because a real `claude` process keeps writing its JSONL and holds
 * the pty in the foreground; the CTA's visibility is derived from that liveness.
 * An isolated stack has no `claude` binary at all. The fixture can seed and even
 * keep the transcript fresh (helpers/claude-jsonl.ts), and AC-1 — the actual
 * ping-pong regression fence — passes on that basis. But CTA visibility depends on
 * live-session detection, which cannot be faithfully impersonated by touching a
 * file.
 *
 * The honest options were: weaken the assertion until it passes, or quarantine it.
 * Weakening it would leave a green test that checks nothing, which is the exact
 * failure mode this whole sub-iterate (A00) exists to eliminate. So: quarantined,
 * counted, and runnable by hand on a machine that HAS the Claude CLI.
 *
 * A00 (iterate-2026-07-10-harness-hardening). Sibling: AC-1 lives on (and now
 * actually runs) in e2e/flows/v0-9-3-resume-state-machine.spec.ts.
 */

import { test, expect } from "@playwright/test";
import { apiUrl } from "../helpers/env";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { backdateJsonl, seedClaudeJsonl, touchJsonl } from "../helpers/claude-jsonl";

const AGED_MS = 30 * 60 * 1000;

async function settleToIdle(
  request: import("@playwright/test").APIRequestContext,
  taskId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await request.get(apiUrl(`/api/external/tasks/${taskId}/transcript?fromByte=0`));
        const t = await request
          .get(apiUrl(`/api/external/tasks/${taskId}`))
          .then((r) => r.json() as Promise<{ task: { state: string } }>);
        return t.task.state;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe("idle");
}

test.describe("v0.9.3 AC-2 (QUARANTINED — needs a real Claude CLI)", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;
  let jsonlPath: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "v0.9.3 resume ac2" });
    await setActiveProject(page, project.projectId);

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("plain-claude-button").click();
    await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("new-issue-title-input").fill(`v093-ac2-${Date.now()}`);

    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
    );
    await page.getByTestId("new-issue-save-btn").click();
    const created = await createResp;
    const body = (await created.json()) as {
      task: { taskId: string; sessionUuid: string; cwd: string };
    };
    taskId = body.task.taskId;

    jsonlPath = seedClaudeJsonl({
      sessionUuid: body.task.sessionUuid,
      cwd: body.task.cwd,
      turns: 2,
    });
    backdateJsonl(jsonlPath, AGED_MS);
    await settleToIdle(request, taskId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("AC-2: Resume button hides within 2.5s of clicking it on idle new-plain", async ({
    page,
  }) => {
    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // LOCATOR FIX (A00). The original targeted `getByRole("button", {name:
    // /resume|launch/i})`. The header renders TWO mutex CTAs — ResumeCTA
    // (`cta-copy-resume-command`, aria-label "Resume — …") and LaunchCTA
    // (`cta-launch-in-terminal`, aria-label "Launch — …") — so that regex matches
    // BOTH, and once the resumed task goes active and the header swaps to the
    // Launch CTA the old locator reports "still visible" and the assertion below
    // could never pass. Nobody noticed because the spec always skipped.
    //
    // The ASSERTION is untouched: the Resume affordance must be gone. Only the
    // locator changes, so that it finally addresses the button the test names.
    const resumeBtn = page.getByTestId("cta-copy-resume-command");
    await expect(resumeBtn).toBeVisible({ timeout: 10_000 });
    await resumeBtn.click();

    // A resumed session stays active because CLAUDE keeps writing its transcript.
    // There is no `claude` on an isolated stack, so the fixture keeps playing that
    // part; otherwise the transcript stays stale, the task correctly decays back to
    // idle, and the Resume button reappears — the server being right, not wrong.
    touchJsonl(jsonlPath);

    // Tightened to the spec's "at most 2 transcript-poll cycles (~2s at 1s polling)":
    // poll every 250ms for 2.5s = 10 samples. After the 5th sample (1.25s mark, ~1.5
    // poll cycles into the awaiting → active flip) the button MUST be hidden.
    const visibilitySamples: { tMs: number; visible: boolean }[] = [];
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
        const visible = await resumeBtn.isVisible({ timeout: 200 }).catch(() => false);
      visibilitySamples.push({ tMs: Date.now() - start, visible });
      if (i < 9) await page.waitForTimeout(250);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[v0.9.3 AC-2] Resume button visibility over 2.5s after click: ${JSON.stringify(visibilitySamples)}`,
    );

    const stableSamples = visibilitySamples.slice(5);
    const lateVisible = stableSamples.filter((s) => s.visible);
    expect(lateVisible.length).toBe(0);
  });
});
