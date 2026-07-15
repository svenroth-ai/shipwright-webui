/*
 * Flow 99 — single-session pipeline CROSS-SURFACE capstone (campaign
 * webui-pipeline-convergence, sub-iterate W4; the WebUI half of the SS7
 * capstone).
 *
 * W2 (flow 97) proved the POST /launch {masterRun} endpoint; W3 (flow 98) proved
 * the board card render. BOTH explicitly deferred the full cross-surface hop —
 * board CTA → `webui:pending-auto-launch` sessionStorage handoff →
 * embedded-terminal WebSocket — to W4. This spec closes it end-to-end against the
 * REAL isolated built stack (real Hono route + real run-config-reader reading a
 * real on-disk shipwright_run_config.json + real pty):
 *
 *   Test 1 (AC1) — cross-surface launch parity. The board's single-session card
 *     (W3 SingleSessionRunCard) has ONE Launch CTA. Clicking it client-navigates
 *     to /tasks/:id and the embedded terminal's WebSocket receives a
 *     {type:"data"} frame carrying the SERVER-BUILT master command
 *     (`claude --session-id … '/shipwright-run'`), with NO campaign / resume /
 *     phase-command leak. The board hands off EXACTLY what the terminal runs —
 *     the server is the sole command author (Architecture rule 1 / guard #19).
 *     Reuses helpers/ws-capture.ts (the C5 data-frame predicate shape). Claude
 *     never actually bootstraps (isolated USERPROFILE), but the frame carrying
 *     the command IS sent — the capstone asserts the command reaches the
 *     terminal, not that Claude executes it.
 *
 *   Test 2 (AC2) — advance→complete lifecycle. The SAME W3 card mirrors a run
 *     progressing ON DISK: 1/7 (Launch present) → mutate run_config + reload →
 *     4/7 (Launch present) → status:complete + reload → 7/7 (CTA gone).
 *     Deterministic via on-disk mutation + reload (no polling-timing race);
 *     complements flow 98's static per-fixture snapshots.
 */

import { seedLocalStorage } from "../helpers/fixtures";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
  type CapturedFrame,
  type WsCapture,
} from "../helpers/ws-capture";
import { cleanupCwd, cleanupTask, makeTaskCwd } from "../helpers/task-fixture";

// A fresh per-test runId. Must be hex — RUN_ID_PATTERN /^run-[0-9a-f]{8}$/ (and
// phaseTaskIds match PHASE_TASK_ID_PATTERN /^ptk-[0-9a-f]{4,}$/) — or the
// run-config reader rejects the config and the single-session card never renders.
// Per-invocation (not a shared constant) so `--repeat-each` reruns never reuse a
// prior run's master shadow (findMasterShadow keys on runId alone).
function freshRunId(): string {
  return `run-${randomBytes(4).toString("hex")}`;
}

const PIPELINE = ["project", "design", "plan", "build", "test", "changelog", "deploy"];

/** A phase_task in the flow-98 shape. `i` seeds a hex phaseTaskId (PHASE_TASK_ID_
 *  PATTERN /^ptk-[0-9a-f]{4,}$/) + a valid-looking distinct uuid. */
function phaseTask(phase: string, status: string, i: number) {
  return {
    phaseTaskId: `ptk-aaa${i}`,
    phase,
    splitId: null,
    sessionUuid: `${String(i).repeat(8)}-2222-4333-8444-555555555555`,
    version: 1,
    status,
    title: `Run / ${phase}`,
    slashCommand: `/shipwright-${phase}`,
    prerequisites: [],
    executionCount: 1,
    createdAt: "2026-07-09T08:00:00.000Z",
  };
}

/** phase_tasks with the frontier at `frontier` (that phase gets `lastStatus`,
 *  every earlier phase is `done`). frontier=1,in_progress → 1/7; frontier=4 →
 *  4/7; frontier=6,done + status:complete → 7/7 (complete pins the bar full). */
function phaseTasksUpTo(frontier: number, lastStatus: string) {
  const tasks = [];
  for (let i = 0; i <= frontier; i += 1) {
    tasks.push(phaseTask(PIPELINE[i], i < frontier ? "done" : lastStatus, i));
  }
  return tasks;
}

function runConfigJson(
  runId: string,
  mode: "single_session" | "multi_session",
  status: "in_progress" | "complete",
  phaseTasks: ReturnType<typeof phaseTask>[],
): string {
  return JSON.stringify({
    schemaVersion: 2,
    runId,
    scope: "full_app",
    autonomy: "guided",
    mode,
    deploy_target: "none",
    pipeline: PIPELINE,
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status,
    completed_phase_task_ids: phaseTasks.filter((t) => t.status === "done").map((t) => t.phaseTaskId),
    phase_tasks: phaseTasks,
    created_at: "2026-07-09T08:00:00.000Z",
    updated_at: new Date().toISOString(),
  });
}

async function registerProject(request: APIRequestContext, dir: string): Promise<string> {
  const res = await request.post("/api/projects", {
    data: { name: `w4-cap-${path.basename(dir)}`, path: dir },
  });
  if (!res.ok()) throw new Error(`POST /api/projects: HTTP ${res.status()} — ${await res.text()}`);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** Land on the board with `projectId` pre-selected (survives reloads — an init
 *  script runs on every navigation). */
async function openBoard(page: Page, projectId: string): Promise<void> {
  await seedLocalStorage(page, { "webui.activeProjectId": projectId });
  await page.goto("/");
  await expect(page.getByTestId("task-board-page")).toBeVisible();
}

/** A terminal-WS `{type:"data"}` tx frame (after `afterMs`) that is a launch
 *  command. Keys on the STABLE `claude --session-id` marker (like C5's
 *  launchSendForTask) — NOT on `/shipwright-run` — so the command-content
 *  assertions below do the real proving: a regression that drops `/shipwright-run`
 *  then fails FAST on `toContain` (wrong command) rather than as a 30 s
 *  awaitFrame timeout indistinguishable from "no frame delivered at all". */
function launchDataFrame(cap: WsCapture, taskId: string, afterMs: number) {
  return (f: CapturedFrame, env: Record<string, unknown> | null): boolean => {
    if (f.kind !== "tx") return false;
    if (env?.type !== "data") return false;
    if (f.ts < afterMs) return false;
    const sock = cap.sockets.get(f.socketId);
    if (!sock || !isTerminalSocket(sock.url, taskId)) return false;
    const payload = (env as { payload?: unknown }).payload;
    return typeof payload === "string" && payload.includes("claude --session-id");
  };
}

test.describe("Flow 99 — single-session cross-surface capstone (W4)", () => {
  test.setTimeout(120_000);

  const cleanups: Array<() => Promise<void>> = [];
  function track(fn: () => Promise<void>) {
    cleanups.push(fn);
  }
  test.afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
  });

  test("board Launch CTA → terminal WS receives the server-built /shipwright-run (cross-surface parity)", async ({
    page,
    request,
  }) => {
    const runId = freshRunId();
    const dir = await makeTaskCwd("w4-cap-launch-");
    track(() => cleanupCwd(dir));
    await fs.writeFile(
      path.join(dir, "shipwright_run_config.json"),
      runConfigJson(runId, "single_session", "in_progress", phaseTasksUpTo(1, "in_progress")),
      "utf-8",
    );
    const projectId = await registerProject(request, dir);
    track(async () => void (await request.delete(`/api/projects/${encodeURIComponent(projectId)}`)));

    await openBoard(page, projectId);

    // The W3 single-session card + its ONE Launch CTA render; the multi-session
    // MasterTaskCard must NOT (we are exercising the right surface).
    await expect(page.getByTestId(`single-session-run-card-${runId}`)).toBeVisible();
    await expect(page.getByTestId(`master-task-card-${runId}`)).toHaveCount(0);
    const cta = page.getByTestId(`master-run-launch-${runId}`);
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("data-mode", "launch");

    // Capture WS frames BEFORE the click so the post-navigation terminal WS is
    // caught (page-level listener survives the SPA nav).
    const cap = attachWsCapture(page);
    const clickAt = Date.now();
    await cta.click();

    // The CTA create-or-reuses the master shadow, launches, writes the handoff,
    // and navigates to the new task's TaskDetail terminal.
    await page.waitForURL(/\/tasks\/[0-9a-fA-F-]{36}/, { timeout: 15_000 });
    const taskId = page.url().match(/\/tasks\/([0-9a-fA-F-]{36})/)![1];
    track(() => cleanupTask(request, taskId));

    // The cross-surface assertion: the SERVER-BUILT master command lands in the
    // terminal over its live WS — the board handed off exactly what runs.
    const launch = await awaitFrame(page, cap, launchDataFrame(cap, taskId, clickAt), {
      timeoutMs: 30_000,
    });
    expect(launch, "an auto-execute (`claude --session-id`) data-frame on the terminal WS").not.toBeNull();
    if (!launch) return;

    const payload = (launch.env as { payload: string }).payload;
    // The command is the SERVER-BUILT single-session master — parity across surfaces.
    expect(payload).toContain("claude --session-id");
    expect(payload).toContain("/shipwright-run");
    // No leak from the sibling launch branches (guard #19 — one command author).
    expect(payload).not.toContain("--campaign");
    expect(payload).not.toContain("--resume");
    expect(payload).not.toContain("/shipwright-project");
    // CR-terminated → submitted to the shell, not merely typed (parity with C5).
    expect(payload.endsWith("\r"), "master command must be CR-terminated").toBe(true);
  });

  test("advance→complete: the card mirrors on-disk progression 1/7 → 4/7 → 7/7 (CTA gone)", async ({
    page,
    request,
  }) => {
    const runId = freshRunId();
    const dir = await makeTaskCwd("w4-cap-arc-");
    track(() => cleanupCwd(dir));
    const cfgPath = path.join(dir, "shipwright_run_config.json");
    await fs.writeFile(
      cfgPath,
      runConfigJson(runId, "single_session", "in_progress", phaseTasksUpTo(1, "in_progress")),
      "utf-8",
    );
    const projectId = await registerProject(request, dir);
    track(async () => void (await request.delete(`/api/projects/${encodeURIComponent(projectId)}`)));

    // Seed — early frontier: 1/7 + Launch CTA.
    await openBoard(page, projectId);
    await expect(page.getByTestId(`single-session-progress-${runId}`)).toHaveText("1/7");
    await expect(page.getByTestId(`master-run-launch-${runId}`)).toBeVisible();

    // Advance — the run moves the frontier to `test` (index 4): 4/7, CTA stays.
    await fs.writeFile(
      cfgPath,
      runConfigJson(runId, "single_session", "in_progress", phaseTasksUpTo(4, "in_progress")),
      "utf-8",
    );
    await page.reload();
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId(`single-session-progress-${runId}`)).toHaveText("4/7");
    await expect(page.getByTestId(`master-run-launch-${runId}`)).toBeVisible();

    // Complete — status:complete pins the bar full (7/7) and hides the CTA.
    await fs.writeFile(
      cfgPath,
      runConfigJson(runId, "single_session", "complete", phaseTasksUpTo(6, "done")),
      "utf-8",
    );
    await page.reload();
    // The card itself STILL renders at full bar — only the CTA is hidden for a
    // terminal run. (Asserting the card container guards against a regression
    // that removes the whole card on completion instead of just its CTA.)
    await expect(page.getByTestId(`single-session-run-card-${runId}`)).toBeVisible();
    await expect(page.getByTestId(`single-session-progress-${runId}`)).toHaveText("7/7");
    await expect(page.getByTestId(`master-run-launch-${runId}`)).toHaveCount(0);
  });
});
