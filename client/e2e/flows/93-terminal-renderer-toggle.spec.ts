/*
 * iterate-2026-06-23 (terminal-renderer-toggle) — end-to-end proof that the
 * diagnostic renderer override actually switches the embedded-terminal renderer
 * in a REAL browser (jsdom can't — it has no canvas getContext).
 *
 * The smear class survived five `term.refresh`-based fixes and reproduces
 * across active / idle / replay, pointing at the WebGL renderer itself. This
 * toggle (terminal-renderer.ts, read by xtermAddons.ts) lets us A/B WebGL vs
 * the DOM renderer. This spec proves, in real Chromium, that:
 *   - default → the code chooses WebGL (console `renderer=webgl`);
 *   - `localStorage["shipwright:terminal-renderer"]="dom"` → the code chooses
 *     the DOM renderer (console `renderer=dom`) AND no WebGL <canvas> is created
 *     under the terminal, while the DOM renderer's `.xterm-rows` is present.
 *
 * The DOM-mode assertions are GPU-independent (the WebGL addon is never
 * constructed). The WebGL-canvas count is environment-dependent (headless
 * Chromium WebGL via SwiftShader), so the "renderers genuinely differ" check is
 * asserted only when the default arm actually produced a canvas; otherwise the
 * console-log divergence still proves the override is honored. The remaining
 * residue — whether the DOM renderer visually eliminates the smear on a SPECIFIC
 * GPU — is the user's intent-confirmation (a single real-device judgment).
 *
 * Soft-skip on baseURL unreachable (matches specs 86/87/88/91).
 */

import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { ensureProject, makeTaskCwd, deleteTask } from "../helpers/terminal-selection";

const RENDERER_LOG = "[EmbeddedTerminal] renderer=";

/**
 * Create a task (no Claude launch — a bare shell pty WS attach is all we need)
 * and return its id + a cleanup. The optional initScript runs before any page
 * script on the next navigation (used to seed the localStorage override).
 */
async function createBareTask(
  page: Page,
  request: APIRequestContext,
  opts: { domOverride?: boolean } = {},
): Promise<{ taskId: string; cleanup: () => Promise<void> }> {
  const project = await ensureProject(request);
  const cwd = await makeTaskCwd("term-renderer-");
  const created = await request.post("/api/external/tasks", {
    data: { title: "term-renderer spec 93", cwd, projectId: project.projectId },
  });
  expect(created.ok()).toBeTruthy();
  const taskId = ((await created.json()) as { task: { taskId: string } }).task.taskId;
  if (opts.domOverride) {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("shipwright:terminal-renderer", "dom");
      } catch {
        /* ignore */
      }
    });
  }
  return {
    taskId,
    cleanup: async () => {
      await deleteTask(request, taskId);
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(cwd, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      await project.cleanup();
    },
  };
}

/** Navigate to the task + wait for xterm to have opened (renderer instantiated). */
async function gotoTerminal(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByTestId("embedded-terminal")).toBeVisible({ timeout: 30_000 });
  // `.xterm-screen` appears once `term.open(container)` ran in the mount effect —
  // i.e. once the renderer (WebGL canvas or DOM rows) has been instantiated.
  await expect(page.locator('[data-testid="embedded-terminal"] .xterm-screen')).toBeAttached({
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

/** Count <canvas> elements under the terminal (WebGL renderer creates one; DOM renderer none). */
async function canvasCount(page: Page): Promise<number> {
  return page.locator('[data-testid="embedded-terminal"] canvas').count();
}

/** True when the DOM renderer's row container exists (DOM renderer active). */
async function hasXtermRows(page: Page): Promise<boolean> {
  return (await page.locator('[data-testid="embedded-terminal"] .xterm-rows').count()) > 0;
}

test.describe("Iterate terminal-renderer-toggle — renderer override (real browser)", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(true, `baseURL unreachable (${(err as Error).message}); soft-skipping spec 93.`);
    }
  });

  test("default chooses WebGL; the dom override switches to the DOM renderer (no canvas)", async ({
    page,
    request,
  }) => {
    // Collect the `[EmbeddedTerminal] renderer=…` console line per navigation.
    const logs: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes(RENDERER_LOG)) logs.push(t);
    });

    // --- Arm 1: DEFAULT (no override) → WebGL chosen ---
    const def = await createBareTask(page, request);
    let defaultCanvases = -1;
    try {
      await gotoTerminal(page, def.taskId);
      const defaultLog = logs.find((l) => l.includes(RENDERER_LOG));
      expect(defaultLog, "default mount must log a renderer choice").toBeTruthy();
      expect(defaultLog, "default arm chooses WebGL").toContain(`${RENDERER_LOG}webgl`);
      defaultCanvases = await canvasCount(page);
      // Informational: headless WebGL via SwiftShader usually yields a canvas,
      // but a GPU-less runner may fall back to DOM — that's why the cross-arm
      // canvas assertion below is conditional.
      // eslint-disable-next-line no-console
      console.log(`[spec93] default arm: canvases=${defaultCanvases}`);
    } finally {
      await def.cleanup();
    }

    // --- Arm 2: DOM override → DOM renderer, WebGL addon skipped ---
    logs.length = 0;
    const dom = await createBareTask(page, request, { domOverride: true });
    try {
      await gotoTerminal(page, dom.taskId);
      const domLog = logs.find((l) => l.includes(RENDERER_LOG));
      expect(domLog, "dom mount must log a renderer choice").toBeTruthy();
      expect(domLog, "override arm chooses the DOM renderer").toContain(`${RENDERER_LOG}dom`);

      // HARD, GPU-independent: the WebGL addon is never constructed in dom mode,
      // so there is NO <canvas> under the terminal; the DOM renderer's row
      // container IS present.
      expect(await canvasCount(page), "dom renderer must create NO <canvas>").toBe(0);
      expect(await hasXtermRows(page), "dom renderer must render .xterm-rows").toBe(true);

      // The differentiator — only assertable when the default arm actually got a
      // WebGL canvas (SwiftShader present). When it did, the override provably
      // changed the live renderer (canvas → none). When it didn't, the console
      // divergence (webgl vs dom) already proves the override is honored.
      if (defaultCanvases > 0) {
        expect(0, "dom arm has fewer canvases than the WebGL default arm").toBeLessThan(
          defaultCanvases,
        );
      }
    } finally {
      await dom.cleanup();
    }
  });
});
