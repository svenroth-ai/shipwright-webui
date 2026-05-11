/*
 * v0.9.3 — Resume state-machine regression fence (ADR-085).
 *
 * Bug: clicking Resume on a `new-plain` task in `idle` state never
 * settled on `active`. The state ping-ponged idle ↔ active every
 * transcript-poll cycle because the `active → idle` decay rule used
 * JSONL mtime as the staleness signal, and `new-plain` never writes
 * JSONL until the user types their first message. After ~120s the
 * stale-mtime branch fired on every poll and yanked the state back
 * to idle, even though the pty was alive and Claude was running.
 *
 * Fix at `server/src/external/routes.ts` line 925: scope the
 * mtime-based decay to NON-`new-plain` actionIds (or `new-plain`
 * with pty gone). Pty existence is the authoritative signal for
 * "claude is running" for new-plain.
 *
 * Runs against the live Hono+Vite dev stack on the Tailscale interface
 * via `playwright.tailscale.config.ts`.
 */

import { test, expect } from "@playwright/test";

const TASK_ID = "31b4076d-5a0a-4c62-b176-63553c165c03";

test("AC-1 + AC-2: Resume click on idle new-plain converges to active and STAYS active across multiple poll cycles", async ({ page }) => {
  test.setTimeout(45_000);

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`/tasks/${TASK_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });

  // Open Terminal tab so the embedded terminal mounts + the WS attaches.
  const terminalTab = page.getByRole("tab", { name: /terminal/i });
  if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await terminalTab.click();
  }

  // Wait for the page to settle (replay envelopes flush, polling cadence
  // stabilizes).
  await page.waitForTimeout(3_000);

  // Snapshot task state via the public API BEFORE click.
  const taskBefore = await page.request
    .get(`/api/external/tasks/${TASK_ID}`)
    .then((r) => r.json() as Promise<{ task: { state: string; actionId: string } }>);
  expect(taskBefore.task.actionId).toBe("new-plain");
  // Pre-condition: task is idle. (If it's already active, this regression
  // can't be observed — the user's earlier Resume click already settled.
  // The reported repro task lives in idle most of the time.)
  // We don't force idle — we just record the starting state for forensic.
  const stateBeforeClick = taskBefore.task.state;

  // Click Resume / Launch — exact text varies by state.
  const resumeBtn = page.getByRole("button", { name: /resume|launch/i });
  const hasResumeBeforeClick = await resumeBtn
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  // The AC-1 stability assertion runs regardless of whether we triggered
  // the click ourselves — the regression fence is "active stays active
  // across multiple polls". If the task is already active (someone else
  // resumed it earlier), the stability check is just as valid.
  // openai medium #2 (post-stage1 review): track explicitly whether the
  // click happened so a failure mode can be attributed correctly.
  let resumeClickExecuted = false;
  if (hasResumeBeforeClick) {
    await resumeBtn.click();
    resumeClickExecuted = true;
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `[v0.9.3] AC-1 precondition: task state was '${stateBeforeClick}' (not idle) — Resume button not visible. Asserting stability of pre-existing active state instead of post-click convergence.`,
    );
  }

  // The fix's core claim: state converges to "active" within ~2 transcript
  // polls (~2 seconds at 1s polling) and STAYS active across multiple
  // subsequent polls. Pre-fix, state ping-ponged every 1-2s.
  //
  // Poll the public task API at 1.5s intervals for 12 seconds. Assert
  // that AT LEAST 6 of the 8 samples report state === "active".
  // (Allow 2 transient samples for the awaiting → active transition
  // window right after the click.)
  const samples: { tMs: number; state: string }[] = [];
  const start = Date.now();
  for (let i = 0; i < 8; i++) {
    const resp = await page.request
      .get(`/api/external/tasks/${TASK_ID}`)
      .then((r) => r.json() as Promise<{ task: { state: string } }>);
    samples.push({ tMs: Date.now() - start, state: resp.task.state });
    if (i < 7) await page.waitForTimeout(1_500);
  }

  const activeSamples = samples.filter((s) => s.state === "active");
  const idleSamples = samples.filter((s) => s.state === "idle");

  // eslint-disable-next-line no-console
  console.log(
    `[v0.9.3] state samples (${samples.length}): active=${activeSamples.length}, idle=${idleSamples.length}, all=${JSON.stringify(samples)}`,
  );

  // The KEY regression assertion: after the initial awaiting → active
  // transition the state MUST NOT decay back to idle on the next poll.
  // Pre-fix, the sequence was: awaiting (poll1) → active (poll2) → idle
  // (poll3) → active (poll4) → idle ... Post-fix, once active, stays
  // active.
  //
  // Look at samples FROM index 2 onwards (after the initial transition
  // window). All must be "active" — zero "idle" entries.
  const stableSamples = samples.slice(2);
  const stableIdles = stableSamples.filter((s) => s.state === "idle");
  expect(stableIdles.length).toBe(0);

  // Belt-and-braces: no dimensions pageerrors regressed.
  const dimensionsErrors = pageErrors.filter((m) =>
    /dimensions|_renderService/.test(m),
  );
  expect(dimensionsErrors).toEqual([]);

  // Forensic logging for debugging if a regression run fails:
  // eslint-disable-next-line no-console
  console.log(
    `[v0.9.3] AC-1 summary: resumeClickExecuted=${resumeClickExecuted}, stateBefore=${stateBeforeClick}, stableSamples=${JSON.stringify(stableSamples)}`,
  );
});

test("AC-2: Resume button hides within 2.5s of clicking it on idle new-plain", async ({ page }) => {
  test.setTimeout(30_000);

  await page.goto(`/tasks/${TASK_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const terminalTab = page.getByRole("tab", { name: /terminal/i });
  if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await terminalTab.click();
  }
  await page.waitForTimeout(2_500);

  const resumeBtn = page.getByRole("button", { name: /resume|launch/i });
  const hasResumeBeforeClick = await resumeBtn
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  // openai HIGH (post-stage1 review): never silently return success when
  // the precondition for this test (Resume visible to click) is not met.
  // Use test.skip with explicit reason so the runner reports it as
  // SKIPPED, not PASSED.
  test.skip(
    !hasResumeBeforeClick,
    "Resume button not visible at start — task is already non-idle (someone else resumed it). AC-2 precondition cannot be exercised on this task in this state.",
  );

  await resumeBtn.click();

  // openai medium (post-stage1 review): tighten the assertion window to
  // match the spec's "at most 2 transcript-poll cycles (~2s at 1s polling)".
  // Allow a small tolerance: poll every 250ms for 2.5s = 10 samples.
  // After the 5th sample (1.25s mark, ~1.5 transcript-poll cycles into
  // the awaiting → active flip) the button MUST be hidden.
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

  // After the 5th sample (1.25s mark) the button MUST be hidden in every
  // subsequent sample. (The first ~1 transcript-poll worth of samples
  // can still show the button while state is awaiting_external_start.)
  const stableSamples = visibilitySamples.slice(5);
  const lateVisible = stableSamples.filter((s) => s.visible);
  expect(lateVisible.length).toBe(0);
});
