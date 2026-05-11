/*
 * v0.9.4 — Skip disk-scrollback replay on attach for `new-plain` tasks
 * (ADR-086).
 *
 * Bug: Claude TUI on Windows ConPTY emits per-keystroke input-field
 * redraws + footer hint rotations as raw byte streams in the main buffer
 * (no `\x1b[?1049h` alt-screen entry). The ADR-069 sanitizer strips the
 * cursor-position control sequences (`\x1b[K`, `\x1b[<n>G`, `\x1b[A/B/C/D`)
 * but preserves the character bytes. On replay, every historical
 * keystroke + footer-state-change stacks linearly in the visible buffer
 * → severe corruption.
 *
 * Fix: for `actionId === "new-plain"` tasks, skip the disk-scrollback
 * replay block in `server/src/terminal/routes.ts` WS onOpen entirely.
 * Live pty attaches; Claude redraws its current state. Trade-off
 * documented in ADR-086.
 */

import { test, expect, type WebSocket as PWWebSocket } from "@playwright/test";

const NEW_PLAIN_TASK_ID = "2aa752d7-e9c1-43df-a6b7-ca3ca9bb19aa";

interface WsEnvelope {
  type: string;
  raw: string;
  parsed: Record<string, unknown> | null;
}

interface WsCapture {
  url: string;
  envelopes: WsEnvelope[];
  closed: boolean;
}

function attachWsCapture(page: import("@playwright/test").Page): WsCapture[] {
  const capture: WsCapture[] = [];
  page.on("websocket", (ws: PWWebSocket) => {
    if (!ws.url().includes("/api/terminal/")) return;
    const entry: WsCapture = { url: ws.url(), envelopes: [], closed: false };
    capture.push(entry);
    ws.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") return;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(frame.payload) as Record<string, unknown>;
      } catch {
        /* ignore non-JSON */
      }
      const type =
        parsed && typeof parsed.type === "string" ? parsed.type : "<no-type>";
      entry.envelopes.push({ type, raw: frame.payload.slice(0, 400), parsed });
    });
    ws.on("close", () => {
      entry.closed = true;
    });
  });
  return capture;
}

function pickAuthoritativeWs(capture: WsCapture[], taskId: string): WsCapture | undefined {
  const matching = capture.filter(
    (c) => c.url.includes(`/api/terminal/${taskId}/ws`) && c.envelopes.length > 0,
  );
  // Per external code review openai medium: pick the LAST matching WS,
  // not the first. The first /api/terminal/<id>/ws is often a React.
  // StrictMode mount-1 transient that closes pre-handshake or after
  // receiving only `ready`. The authoritative connection is the last
  // one to receive frames.
  return matching.length > 0 ? matching[matching.length - 1] : undefined;
}

test("AC-1 + AC-3: new-plain task WS attach receives ready + scrollback-meta(bytes=0) + live data, NO replay envelopes", async ({ page }) => {
  test.setTimeout(30_000);

  // Pre-flight: verify the target task exists AND is actionId=new-plain.
  const taskApi = await page.request
    .get(`/api/external/tasks/${NEW_PLAIN_TASK_ID}`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);
  test.skip(
    !taskApi || !(taskApi as { task?: { actionId?: string } }).task ||
      (taskApi as { task: { actionId: string } }).task.actionId !== "new-plain",
    `Repro task ${NEW_PLAIN_TASK_ID} either missing or not new-plain — ADR-086 regression check requires this exact precondition.`,
  );

  const capture = attachWsCapture(page);

  await page.goto(`/tasks/${NEW_PLAIN_TASK_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const terminalTab = page.getByRole("tab", { name: /terminal/i });
  if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await terminalTab.click();
  }
  await page.waitForTimeout(4_000);

  const ws = pickAuthoritativeWs(capture, NEW_PLAIN_TASK_ID);
  expect(
    ws,
    "expected at least one /api/terminal/<id>/ws with received frames",
  ).toBeDefined();
  const envTypes = (ws?.envelopes ?? []).map((e) => e.type);
  // eslint-disable-next-line no-console
  console.log(`[v0.9.4 AC-1] WS envelopes (last WS): ${JSON.stringify(envTypes)}`);

  // AC-1 (core): NO replay_* envelopes.
  const replayEnvelopes = envTypes.filter((t) => /^replay_/.test(t));
  expect(replayEnvelopes).toEqual([]);

  // AC-1 (positive): `ready` envelope MUST arrive.
  expect(envTypes.includes("ready")).toBe(true);

  // AC-3 (positive): scrollback-meta MUST arrive with scrollbackBytes === 0
  // — privacy footer suppression for new-plain.
  const scrollbackMeta = (ws?.envelopes ?? []).find(
    (e) => e.type === "scrollback-meta",
  );
  expect(scrollbackMeta, "scrollback-meta envelope must be sent").toBeDefined();
  expect((scrollbackMeta?.parsed as { scrollbackBytes?: number })?.scrollbackBytes).toBe(0);

  // AC-1 (live attach proof): WS stays OPEN after the replay-skip path
  // completes — pre-fix the replay envelopes would also fire and the WS
  // would stay open; post-fix only `ready` + `scrollback-meta` fire and
  // the WS still stays open ready to deliver live `data` envelopes as
  // the pty emits. The assertion proves the v0.9.4 path doesn't tear
  // down the WS (a buggy implementation that errored mid-skip-replay
  // would close the socket).
  //
  // Note: we INTENTIONALLY do NOT require ≥1 `data` envelope. The pty
  // may be legitimately idle for several seconds after attach (e.g. a
  // PowerShell prompt waiting for input with no Claude TUI emitting
  // redraws). Requiring a `data` envelope would be flaky.
  expect(
    ws?.closed,
    "the WS must remain open after the replay-skip path completes",
  ).toBe(false);
});

test("AC-2 — non-new-plain tasks STILL receive replay envelopes (existing behavior preserved)", async ({ page }) => {
  test.setTimeout(30_000);

  // Find any non-new-plain task with disk-scrollback bytes via the
  // server's task list endpoint. If none exists in the user's session,
  // skip cleanly — AC-2 is a regression fence; without a non-new-plain
  // task with scrollback we can't exercise the path.
  //
  // Strategy: hit /api/external/tasks, filter for actionId !== "new-plain"
  // AND state !== "done" (replay-only path is different; ADR-068-A1 AC-7),
  // then for each candidate hit /transcript with fromByte=0 to gauge
  // whether scrollback content exists. First match wins.
  const tasksResp = await page.request
    .get(`/api/external/tasks`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);
  const tasks = ((tasksResp as { tasks?: Array<{ taskId: string; actionId?: string; state?: string }> }) || {}).tasks ?? [];
  const candidate = tasks.find(
    (t) =>
      t.actionId &&
      t.actionId !== "new-plain" &&
      t.state !== "done" &&
      t.state !== "launch_failed",
  );
  test.skip(
    !candidate,
    "No non-new-plain task with non-terminal state found in the current task list — AC-2 regression fence can't be exercised on this snapshot of the user's tasks.",
  );

  const capture = attachWsCapture(page);

  await page.goto(`/tasks/${candidate!.taskId}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  const terminalTab = page.getByRole("tab", { name: /terminal/i });
  if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await terminalTab.click();
  }
  await page.waitForTimeout(4_000);

  const ws = pickAuthoritativeWs(capture, candidate!.taskId);
  expect(ws, "expected at least one /api/terminal/<id>/ws with frames").toBeDefined();
  const envTypes = (ws?.envelopes ?? []).map((e) => e.type);
  // eslint-disable-next-line no-console
  console.log(
    `[v0.9.4 AC-2] non-new-plain task ${candidate!.taskId} (actionId=${candidate!.actionId}) envelopes: ${JSON.stringify(envTypes)}`,
  );

  // If the task has scrollback bytes, replay envelopes MUST fire.
  // We probe the `scrollback-meta` envelope (which always fires for
  // non-new-plain too) to gauge whether replay-is-expected.
  const meta = (ws?.envelopes ?? []).find((e) => e.type === "scrollback-meta");
  const bytes = (meta?.parsed as { scrollbackBytes?: number })?.scrollbackBytes ?? 0;

  if (bytes > 0) {
    // Replay envelopes MUST fire — regression fence.
    expect(envTypes.includes("replay_start")).toBe(true);
    expect(envTypes.includes("replay_end")).toBe(true);
  } else {
    // No scrollback bytes to replay; only ready + scrollback-meta + live data expected.
    // The skipping is correct (and not new for v0.9.4).
    // eslint-disable-next-line no-console
    console.log(
      `[v0.9.4 AC-2] non-new-plain task had 0 scrollback bytes — replay legitimately absent`,
    );
  }
});
