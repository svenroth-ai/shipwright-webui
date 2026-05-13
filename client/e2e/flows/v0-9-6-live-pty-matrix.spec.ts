/*
 * Iterate E (ADR-092) — LIVE-pty preservation matrix.
 *
 * Four task types × four axes, real-browser Playwright. Authored after
 * the D-bis probe was promoted to the regression guard at
 * `v0-9-6-live-pty-replay.spec.ts`; this matrix widens coverage to the
 * remaining three task types and to the per-axis observations that
 * D-bis's spec AC #1..#4 enumerated.
 *
 * Task types covered:
 *   1. new-plain     — pure Claude entry (actionId === "new-plain")
 *   2. new-task      — task (build phase, actionId === "new-task")
 *   3. new-iterate   — iterate session
 *   4. new-pipeline  — pipeline session
 *
 * Axes per type:
 *   A. Lifecycle — open → launch → wait-prompt → type fixture →
 *      wait-output → navigate-away → navigate-back → assert WS attached
 *   B. Rendering — `<type>-fixture` text must be present in .xterm-rows
 *      after navigate-back
 *   C. Cursor    — cursor is NOT at origin after re-attach. Since the
 *      test types `echo <fixture>` + ENTER before navigate-away, the
 *      cursor MUST have advanced off (0,0): we assert
 *      `cursorX > 0 || cursorY > 0 || baseY > 0`. A row-count check
 *      (`length > 1`) is kept as a secondary signal — but the hard
 *      constraint is the non-origin position, since a fresh-pty
 *      regression with a single redraw row would otherwise sneak
 *      past. Resize-on-attach is tolerated (no exact pre/post delta
 *      requirement); only the "not a hard reset" property is
 *      asserted.
 *   D. Single-pty — implicit via axes B+C: if rendering preserves
 *      the typed fixture text AND cursor position is non-origin
 *      after navigate-back, the underlying pty must be the same one
 *      that received the input (a fresh pty would start blank with
 *      cursor at (0,0)). An explicit pty.pid probe would require a
 *      new diagnostic endpoint; deferred per spec § "Out of Scope".
 *
 * Network profile: this file uses the default playwright.config.ts
 * (localhost). To run on tailscale: re-invoke with
 * `--config=playwright.tailscale.config.ts` after adding this spec to
 * its `testMatch`. Tailscale path is best-effort per ADR-091/092 — the
 * fix is producer-side and network-independent.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SHIPWRIGHT_WEBUI_PROJECT_ID = "eab3bd8d-d89a-4b8c-aaaa-60a5ff856407";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(
  __dirname,
  "../../playwright-report/v0.9.6-live-pty-matrix",
);

type ActionId = "new-plain" | "new-task" | "new-iterate" | "new-pipeline";

interface MatrixCell {
  type: ActionId;
  fixture: string;
  // Lifecycle axis evidence
  wsReadyAfterReturn: boolean;
  // Rendering axis evidence
  fixtureSeenAfterNav: boolean;
  // Cursor axis evidence
  cursorBefore: { cursorX: number; cursorY: number; baseY: number; length: number } | null;
  cursorAfter: { cursorX: number; cursorY: number; baseY: number; length: number } | null;
  // Single-pty axis evidence — implicit; see file header note.
}

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v096-live-matrix-"));
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

async function readXtermRows(page: Page): Promise<string[]> {
  // ADR-097 — xterm.js 6.0 + WebGL renderer no longer mirrors text into
  // `.xterm-rows > div`. Read from xterm buffer via the test handle
  // (same mechanism as the V0-9-6 replay spec; matches the production
  // M2 fixed-point's visible-buffer contract).
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        buffer: {
          active: {
            length: number;
            getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
          };
        };
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) return [];
    const buf = term.buffer.active;
    const out: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      out.push(line ? line.translateToString(false) : "");
    }
    return out;
  });
}

async function readCursorPos(page: Page): Promise<MatrixCell["cursorBefore"]> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        buffer: {
          active: { length: number; baseY: number; cursorX: number; cursorY: number };
        };
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) return null;
    const buf = term.buffer.active;
    return {
      cursorX: buf.cursorX,
      cursorY: buf.cursorY,
      baseY: buf.baseY,
      length: buf.length,
    };
  });
}

async function runOneCell(
  page: Page,
  request: APIRequestContext,
  type: ActionId,
): Promise<MatrixCell> {
  const cwd = await makeTaskCwd();
  let taskId: string | undefined;
  const fixture = `${type}-fixture-${Date.now().toString(36)}`;
  const cell: MatrixCell = {
    type,
    fixture,
    wsReadyAfterReturn: false,
    fixtureSeenAfterNav: false,
    cursorBefore: null,
    cursorAfter: null,
  };

  try {
    const created = await request.post("/api/external/tasks", {
      data: {
        title: `Iterate E ${type} matrix`,
        cwd,
        actionId: type,
        projectId: SHIPWRIGHT_WEBUI_PROJECT_ID,
      },
    });
    expect(created.ok()).toBeTruthy();
    const cBody = (await created.json()) as { task: { taskId: string } };
    taskId = cBody.task.taskId;

    const launched = await request.post(
      `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
      { data: { actionId: type } },
    );
    expect(launched.ok()).toBeTruthy();

    // First attach.
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
      "data-ws-ready",
      "true",
      { timeout: 15_000 },
    );
    await page.waitForTimeout(3_000);

    // Type the fixture marker.
    await page.locator('[data-testid="embedded-terminal-canvas"]').click({ timeout: 5_000 })
      .catch(async () => { await page.locator(".xterm").first().click(); });
    await page.keyboard.type(`echo ${fixture}`, { delay: 30 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1_500);

    cell.cursorBefore = await readCursorPos(page);

    // Navigate away (SPA route change, NOT page.reload).
    await page.goto(`/`);
    await page.waitForTimeout(1_000);

    // Navigate back.
    await page.goto(`/tasks/${taskId}`);
    const wsReady = await page
      .getByTestId("embedded-terminal")
      .getAttribute("data-ws-ready", { timeout: 15_000 })
      .catch(() => null);
    cell.wsReadyAfterReturn = wsReady === "true";
    if (!cell.wsReadyAfterReturn) {
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      cell.wsReadyAfterReturn = true;
    }
    await page.waitForTimeout(4_000);

    const rowsAfter = await readXtermRows(page);
    cell.fixtureSeenAfterNav = rowsAfter.join("\n").includes(fixture);
    cell.cursorAfter = await readCursorPos(page);
  } finally {
    if (taskId) await deleteTask(request, taskId);
    try {
      await fs.rm(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return cell;
}

test.describe("Iterate E (ADR-092) — live-pty preservation 4-type matrix", () => {
  test.setTimeout(180_000);

  // External code review MED #4 — soft-skip when running against a
  // tailscale baseURL whose host is unreachable (matches D-bis policy).
  // For the local config this is a no-op since baseURL is loopback.
  // Detection: a quick HEAD probe against baseURL; on connection
  // refusal/DNS failure, fixture-skip the entire describe block.
  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping live-pty matrix per ADR-092 § AC #8.`,
      );
    }
  });

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
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  });

  for (const type of ["new-plain", "new-task", "new-iterate", "new-pipeline"] as const) {
    test(`${type}: lifecycle + rendering + cursor + single-pty axes`, async ({
      page,
      request,
    }) => {
      const cell = await runOneCell(page, request, type);

      await fs.writeFile(
        path.join(ARTIFACT_DIR, `cell-${type}.json`),
        JSON.stringify(cell, null, 2),
        "utf8",
      );

      // Axis A — Lifecycle: WS attached after return.
      expect(cell.wsReadyAfterReturn, "WS did not reach ready after navigate-back").toBeTruthy();

      // Axis B — Rendering: fixture text preserved.
      expect(
        cell.fixtureSeenAfterNav,
        `${type}: '${cell.fixture}' missing from .xterm-rows after navigate-back — ADR-092 fix not in effect for this task type`,
      ).toBeTruthy();

      // Axis C — Cursor: NOT at origin. The test typed
      // `echo <fixture>` + ENTER before navigate-away, so the cursor
      // must have advanced off (0,0). A fresh pty would start at
      // (cursorX=0, cursorY=0, baseY=0) with one empty row; we reject
      // exactly that shape. Resize-on-attach is tolerated (we do not
      // require an exact pre/post delta — see file header docstring),
      // but the hard "not a hard reset" constraint stands.
      expect(cell.cursorAfter, "cursor probe returned null").not.toBeNull();
      const cur = cell.cursorAfter!;
      expect(
        cur.cursorX > 0 || cur.cursorY > 0 || cur.baseY > 0,
        `${type}: cursor at hard-reset origin after navigate-back ` +
          `(cursorX=${cur.cursorX}, cursorY=${cur.cursorY}, baseY=${cur.baseY}) — ` +
          `looks like a fresh pty, not a re-attach`,
      ).toBeTruthy();
      // Secondary signal: buffer has more than one row of content.
      // Strictly weaker than the position check above, kept as
      // belt-and-braces against probes that capture position from a
      // stale renderer frame.
      expect(cur.length).toBeGreaterThan(1);

      // Axis D — Single-pty: implicit via axes B+C. The combination
      // "fixtureSeenAfterNav AND cursor at non-origin" is only
      // achievable when the post-navigate WS attached to the SAME
      // pty as the pre-navigate WS — a fresh pty would render a
      // blank buffer with cursor at (0,0). Already asserted above.
    });
  }
});
