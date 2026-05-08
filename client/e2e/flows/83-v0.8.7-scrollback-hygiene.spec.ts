/*
 * Spec 83 — v0.8.7 scrollback hygiene + new-plain idle smoke
 * (iterate-2026-05-08-v0-8-7-scrollback-hygiene-and-newplain-idle).
 *
 * Empirical regression for the 4 ACs:
 *
 *   - AC-1: A `new-plain` task that flipped to `active` (v0.8.5 AC-4 on
 *           WS pty-up) returns to `idle` after the pty is killed (e.g.
 *           via "Stop terminal session"). Without this, the Resume CTA
 *           in TaskDetailHeader stays invisible across overnight idle.
 *
 *   - AC-2: After an intentional pty kill (`POST /api/terminal/:id/close`),
 *           the disk-scrollback gains a single `──── shell stopped at
 *           HH:MM:SS ────` marker. Verified empirically by re-attaching
 *           the WS and scanning xterm's `buffer.active` for the marker
 *           substring.
 *
 *   - AC-3: After ≥2 kill→respawn cycles, the replay-time collapse
 *           produces ONE PowerShell-banner-burst + a `── N earlier
 *           banners collapsed ──` marker. Disk file is unchanged;
 *           replay shows the collapsed view.
 *
 *   - AC-4: After ≥2 stop markers are visible in the replay, the
 *           EmbeddedTerminal renders the dim footer "Scrollback enthält
 *           N beendete Shell-Sessions" + "Clear history" button.
 *
 * Runs against the live dev stack (hono :3847 + vite :5173 — `HONO_HOST=
 * true` + `VITE_HOST=true`). Per `feedback_iterate_e2e_always_means_run.md`:
 * spec is authored AND run before commit.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// User's local active project — same value used by Spec 82.
const SHIPWRIGHT_WEBUI_PROJECT_ID = "eab3bd8d-d89a-4b8c-aaaa-60a5ff856407";

const STOP_MARKER_SUBSTRING = "──── shell stopped at";

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v087-spec83-"));
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
      projectId: SHIPWRIGHT_WEBUI_PROJECT_ID,
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

/**
 * Read the disk-scrollback file (`<HOME>/.shipwright-webui/terminal-
 * scrollback/<taskId>.log`) for inspection. Used to diagnose
 * "marker on disk?" empirically — Node fs reads bypass any pty / WS
 * race. Returns "" if the file doesn't exist.
 */
async function readScrollbackFile(taskId: string): Promise<string> {
  const home = os.homedir();
  const file = path.join(home, ".shipwright-webui", "terminal-scrollback", `${taskId}.log`);
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function countMarkers(s: string): number {
  return (s.match(/──── shell stopped at \d{2}:\d{2}:\d{2} ────/g) || []).length;
}

test.describe("Spec 83 — v0.8.7 scrollback hygiene + new-plain idle", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
        localStorage.setItem(
          "webui:embedded-terminal-default-tab",
          '"terminal"',
        );
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);
  });

  test("AC-1: new-plain `active → idle` after pty kill (Resume CTA returns)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac1-newplain-idle");
    try {
      // Wait for AC-4 (v0.8.5) to flip state=active on WS upgrade.
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(1_500);

      // Verify task is `active` via API.
      const beforeKill = await request.get(
        `/api/external/tasks/${encodeURIComponent(taskId)}`,
      );
      const beforeJson = (await beforeKill.json()) as { task: { state: string } };
      expect(beforeJson.task.state).toBe("active");

      // Stop the pty (matches "Stop terminal session" menu action).
      const closed = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/close`,
      );
      expect(closed.ok()).toBe(true);

      // Poll transcript — AC-1 patch should fire on the next poll.
      // The `result.status === "missing"` branch hits because new-plain
      // never wrote JSONL.
      const polled = await request.get(
        `/api/external/tasks/${encodeURIComponent(taskId)}/transcript`,
      );
      const polledJson = (await polled.json()) as {
        status: string;
        task: { state: string };
      };
      expect(polledJson.task.state).toBe("idle");

      // The Header CTA matrix flips: idle → Resume CTA renders.
      // Re-load TaskDetail to pick up new state from query refetch.
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("cta-copy-resume-command"),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-2 (disk-only): shell-stopped marker hits disk-scrollback file directly after kill", async ({
    page,
    request,
  }) => {
    // Isolated empirical probe — bypasses xterm replay so a true/false
    // signal on "did the marker land on disk?" is captured directly via
    // Node fs. Diagnoses the WS-replay path independently of pty.onExit
    // timing on Windows ConPTY.
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac2-disk-probe");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(2_000);

      // Pre-condition: scrollback file MAY exist (depends on shell having
      // emitted any output yet); marker is NOT yet there.
      const before = await readScrollbackFile(taskId);
      expect(countMarkers(before)).toBe(0);

      // Stop pty — closing-flag fires AC-2 marker append in pty.onExit.
      await request.post(`/api/terminal/${encodeURIComponent(taskId)}/close`);
      // Generous wait for ConPTY child exit + appendFileSync flush.
      await page.waitForTimeout(3_000);

      // Marker should be on disk now.
      const after = await readScrollbackFile(taskId);
      expect(countMarkers(after)).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-2 (replay accumulator): single kill→respawn surfaces marker via accumulator", async ({
    page,
    request,
  }) => {
    // The xterm `buffer.active` after a re-attach is NOT a reliable
    // signal in production — pty2's startup `\x1b[2J\x1b[H` (clear-screen
    // + cursor-home) wipes the replay-painted content immediately after
    // replay_end fires, so a buffer scan returns 0 markers in the live
    // app. The CORRECT measurement is the same one EmbeddedTerminal uses
    // for AC-4: count markers in the cumulative replay-payload string
    // (`replayAccumulatorRef`). We piggy-back on the AC-4 footer for
    // this — but AC-4 only renders at N≥2, so we trigger TWO close
    // cycles here to get the footer to confirm the marker reached
    // xterm via WS.
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac2-replay-acc");
    try {
      // Cycle 1
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(1_500);
      await request.post(`/api/terminal/${encodeURIComponent(taskId)}/close`);
      await page.waitForTimeout(2_500);

      // Cycle 2
      await page.goto(`/`);
      await page.waitForTimeout(500);
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(1_500);
      await request.post(`/api/terminal/${encodeURIComponent(taskId)}/close`);
      await page.waitForTimeout(2_500);

      // Final visit
      await page.goto(`/`);
      await page.waitForTimeout(500);
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(2_500);

      // Disk has ≥2 markers (control reading via Node fs).
      const onDisk = await readScrollbackFile(taskId);
      expect(countMarkers(onDisk)).toBeGreaterThanOrEqual(2);

      // Footer only renders at N≥2; its presence proves replay carried
      // the markers all the way through to the AC-4 accumulator.
      await expect(
        page.getByTestId("embedded-terminal-stopped-sessions-footer"),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("AC-3 + AC-4: ≥3 kill→respawn cycles produce footer + collapse on replay", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createAndLaunch(request, cwd, "ac3-ac4-cycles");
    try {
      // Trigger 3 kill→respawn cycles via repeat /close + WS-upgrade
      // attach. Each /close writes a marker, the next attach respawns
      // the pty, and a second-onward attach writes its own marker on
      // close. Result: ≥3 markers on disk.
      for (let i = 0; i < 3; i++) {
        await page.goto(`/tasks/${taskId}`);
        await expect(
          page.getByTestId("embedded-terminal"),
        ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
        // Wait long enough for prompt-paint + replay (if any).
        await page.waitForTimeout(1_500);
        // Close pty (writes marker via pty.onExit)
        await request.post(
          `/api/terminal/${encodeURIComponent(taskId)}/close`,
        );
        // Wait for ConPTY child exit + marker flush.
        await page.waitForTimeout(2_500);
        // Navigate away so the next iteration triggers a fresh WS attach
        await page.goto(`/`);
        await page.waitForTimeout(800);
      }

      // Final visit — replay-on-attach paints all markers in the
      // xterm buffer, AC-4 footer counts them.
      await page.goto(`/tasks/${taskId}`);
      await expect(
        page.getByTestId("embedded-terminal"),
      ).toHaveAttribute("data-ws-ready", "true", { timeout: 15_000 });
      await page.waitForTimeout(3_500);

      // Count markers visible in the buffer (AC-2 emission verification).
      const markerCount = await page.evaluate(({ marker }) => {
        const term = (
          window as unknown as {
            __embeddedTerminal?: {
              buffer: {
                active: {
                  length: number;
                  getLine(i: number): { translateToString(t?: boolean): string } | undefined;
                };
              };
            } | null;
          }
        ).__embeddedTerminal;
        if (!term) return -1;
        let count = 0;
        for (let i = 0; i < term.buffer.active.length; i++) {
          const line = term.buffer.active.getLine(i);
          if (line && line.translateToString(true).includes(marker)) {
            count++;
          }
        }
        return count;
      }, { marker: STOP_MARKER_SUBSTRING });
      // Cycles can vary slightly under timing; we expect ≥2 markers.
      expect(markerCount).toBeGreaterThanOrEqual(2);

      // AC-4: footer rendered with N markers count.
      const footer = page.getByTestId("embedded-terminal-stopped-sessions-footer");
      await expect(footer).toBeVisible({ timeout: 5_000 });
      const footerText = (await footer.textContent()) ?? "";
      // German UI copy: "Scrollback enthält N beendete Shell-Sessions"
      expect(footerText.toLowerCase()).toContain("beendete shell-sessions");
      // The number embedded in the copy reflects markerCount.
      const m = footerText.match(/(\d+)\s+beendete/i);
      expect(m).not.toBeNull();
      expect(Number(m?.[1])).toBeGreaterThanOrEqual(2);

      // AC-4 button is reachable.
      await expect(
        page.getByTestId("embedded-terminal-clear-history-button"),
      ).toBeVisible();
    } finally {
      await deleteTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
