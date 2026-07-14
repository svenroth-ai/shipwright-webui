/*
 * Spec 85 — v0.8.9 replay-pushdown empirical regression
 * (iterate-2026-05-09-v0-8-9-replay-pushdown).
 *
 * Bug: after the chunked replay-on-attach completes, the historical
 * scrollback (incl. the shell-stopped marker + separator banner) sat in
 * xterm's ACTIVE AREA — cursor parked at row N+1 of replay, live shell
 * (PowerShell + Claude TUI) wrote BELOW it. Visible result: live shell
 * at the bottom of the viewport with replay/empty rows above; Claude's
 * ink TUI mis-positioned because it expected a fresh terminal screen.
 *
 * Fix (EmbeddedTerminal.tsx onReplayEnd): write `term.rows` × \r\n to
 * push the replay out of the active area into the scrollback above,
 * then \x1b[H to home the cursor. Live shell renders from row 0 of
 * the now-empty active area; replay history stays accessible by
 * scrolling up.
 *
 * Empirical fence: after re-attach with non-empty disk scrollback,
 * find the FIRST row in `term.buffer.active` that contains the
 * shell-stopped marker. xterm's IBuffer model: scrollback rows are at
 * indices 0..baseY-1; active viewport rows are at baseY..length-1.
 * After v0.8.9 the marker MUST land in scrollback (markerRow < baseY).
 * Pre-fix the marker would land in the active viewport (markerRow >= baseY).
 *
 * Runs against the live dev stack (hono :3847 + vite :5173). Same
 * shape as Spec 83 — borrows its scrollback/marker plumbing.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;


// User's local active project — same value used by Specs 82/83/84.
const STOP_MARKER_SUBSTRING = "──── shell stopped at";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v089-spec85-"));
}

async function cleanupCwd(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function createAndLaunch(
  request: APIRequestContext,
  cwd: string,
  title: string,
): Promise<string> {
  const created = await request.post("/api/external/tasks", {
    data: {
      title,
      cwd,
      actionId: "new-plain",
      projectId: project.projectId,
    },
  });
  if (!created.ok()) {
    throw new Error(`create: HTTP ${created.status()} — ${await created.text()}`);
  }
  const cBody = (await created.json()) as { task: { taskId: string } };
  const taskId = cBody.task.taskId;
  const launched = await request.post(
    `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
    { data: { actionId: "new-plain" } },
  );
  if (!launched.ok()) {
    throw new Error(`launch: HTTP ${launched.status()} — ${await launched.text()}`);
  }
  return taskId;
}

async function deleteTask(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch {
    /* best-effort */
  }
}

interface ProbeResult {
  firstMarkerRow: number;
  baseY: number;
  length: number;
  rows: number;
}

test.describe("Spec 85 — v0.8.9 replay pushdown to scrollback", () => {
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test.setTimeout(180_000);

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "85-v0.8.9-replay-pushdown-to-scrollback" });
    await setActiveProject(page, project.projectId);
    await seedLocalStorage(page, { "webui:embedded-terminal-default-tab": '"terminal"', });
  });

  test("after replay-on-attach, the shell-stopped marker lives in scrollback (NOT active viewport)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "v089-replay-pushdown");
    try {
      // First attach: pty starts, disk scrollback accrues PowerShell prompt
      // bytes (sanitized — only printable + SGR + LF persisted).
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      await page.waitForTimeout(2_000);

      // Stop pty — pty.onExit appends ONE shell-stopped marker on disk
      // (v0.8.7 AC-2). This guarantees the upcoming replay carries a
      // unique searchable string we can locate post-render.
      const closed = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/close`,
      );
      expect(closed.ok()).toBe(true);
      // Generous wait for ConPTY child exit + appendFileSync flush.
      await page.waitForTimeout(2_500);

      // Navigate away and back — second WS upgrade triggers the
      // replay-on-attach flow (scrollback bytes > 0 → pty.pause →
      // replay_start → chunks → replay_separator → replay_end →
      // pty.resume → fresh shell starts emitting live data).
      await page.goto(`/`);
      await page.waitForTimeout(500);
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      // Wait for the chunked replay to complete + a brief window for
      // PowerShell startup / prompt-paint of the freshly-spawned pty.
      await page.waitForTimeout(4_000);

      const probe = (await page.evaluate(({ marker }) => {
        const w = window as unknown as {
          __embeddedTerminal?: {
            rows: number;
            buffer: {
              active: {
                length: number;
                baseY: number;
                getLine(
                  i: number,
                ): { translateToString(t?: boolean): string } | undefined;
              };
            };
          } | null;
        };
        const term = w.__embeddedTerminal;
        if (!term) return null;
        const buf = term.buffer.active;
        let firstMarkerRow = -1;
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line && line.translateToString(true).includes(marker)) {
            firstMarkerRow = i;
            break;
          }
        }
        return {
          firstMarkerRow,
          baseY: buf.baseY,
          length: buf.length,
          rows: term.rows,
        };
      }, { marker: STOP_MARKER_SUBSTRING })) as ProbeResult | null;

      expect(probe).not.toBeNull();
      // Marker must exist somewhere — disk has ≥1 marker (proof: Spec
      // 83 AC-2 disk probe). The replay carries it through and the
      // EmbeddedTerminal writes it to xterm.
      expect(probe!.firstMarkerRow).toBeGreaterThanOrEqual(0);
      // v0.8.9 fix landing line: the marker must be in xterm's
      // SCROLLBACK (above the active viewport). xterm IBuffer model:
      // scrollback rows occupy indices [0, baseY); the active viewport
      // occupies [baseY, length). markerRow < baseY ⇒ replay was
      // pushed into scrollback. markerRow >= baseY ⇒ replay still
      // sits in the active viewport (pre-fix bug).
      expect(probe!.firstMarkerRow).toBeLessThan(probe!.baseY);
      // Sanity: at least one row of pushdown happened. With a real
      // pty + ≥1 line of replay this is trivially > 0; the loose
      // bound leaves slack for narrow viewports / live-shell scrolls.
      expect(probe!.baseY).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
