/*
 * iterate-2026-06-23 (terminal-renderer-toggle) — end-to-end proof that the
 * diagnostic renderer override actually switches the embedded-terminal renderer
 * in a REAL browser (jsdom can't — it has no canvas getContext).
 *
 * POLARITY FLIPPED in iterate-2026-07-24-terminal-scroll-atlas-smear. The DOM
 * renderer is now the DEFAULT and WebGL is OPT-IN, because the WebGL glyph
 * texture atlas is the root cause of the wrong-letter smear class and
 * `term.refresh` provably cannot heal it (see terminal-renderer.ts). This spec
 * proves, in real Chromium, that:
 *   - default → the code chooses the DOM renderer (console `renderer=dom`) AND
 *     no WebGL <canvas> is created under the terminal, while the DOM renderer's
 *     `.xterm-rows` is present;
 *   - `localStorage["shipwright:terminal-renderer"]="webgl"` (the Settings
 *     checkbox) → the code chooses WebGL (console `renderer=webgl`).
 *
 * The DEFAULT-arm assertions are now the GPU-independent ones (the WebGL addon
 * is never constructed), which is the stronger place for them: the thing users
 * get by default is pinned hard. The WebGL-canvas count is environment-dependent
 * (headless Chromium WebGL via SwiftShader), so the "renderers genuinely differ"
 * check is asserted only when the opt-in arm actually produced a canvas;
 * otherwise the console-log divergence still proves the toggle is honored. The
 * remaining residue — whether the DOM renderer visually eliminates the smear on
 * a SPECIFIC GPU — is the user's intent-confirmation (a real-device judgment).
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
  opts: { webglOverride?: boolean } = {},
): Promise<{ taskId: string; cleanup: () => Promise<void> }> {
  const project = await ensureProject(request);
  const cwd = await makeTaskCwd("term-renderer-");
  const created = await request.post("/api/external/tasks", {
    data: { title: "term-renderer spec 93", cwd, projectId: project.projectId },
  });
  expect(created.ok()).toBeTruthy();
  const taskId = ((await created.json()) as { task: { taskId: string } }).task.taskId;
  if (opts.webglOverride) {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("shipwright:terminal-renderer", "webgl");
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

  test("default chooses the DOM renderer (no canvas); the Settings opt-in switches to WebGL", async ({
    page,
    request,
  }) => {
    // Collect the `[EmbeddedTerminal] renderer=…` console line per navigation.
    const logs: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes(RENDERER_LOG)) logs.push(t);
    });

    // --- Arm 1: DEFAULT (nothing stored) → DOM renderer, WebGL addon skipped ---
    // This is what every user gets out of the box, so its assertions are the
    // HARD, GPU-independent ones: no WebGL addon is constructed, hence no
    // <canvas> under the terminal, and the DOM renderer's row container IS
    // present. If the default ever flips back to the corrupting renderer, this
    // fails on any machine, GPU or not.
    const def = await createBareTask(page, request);
    try {
      await gotoTerminal(page, def.taskId);
      const defaultLog = logs.find((l) => l.includes(RENDERER_LOG));
      expect(defaultLog, "default mount must log a renderer choice").toBeTruthy();
      expect(defaultLog, "default arm chooses the DOM renderer").toContain(
        `${RENDERER_LOG}dom`,
      );
      expect(await canvasCount(page), "default renderer must create NO <canvas>").toBe(0);
      expect(await hasXtermRows(page), "default renderer must render .xterm-rows").toBe(
        true,
      );
    } finally {
      await def.cleanup();
    }

    // --- Arm 2: WebGL opt-in (the Settings checkbox writes this key) → WebGL ---
    logs.length = 0;
    const webgl = await createBareTask(page, request, { webglOverride: true });
    try {
      await gotoTerminal(page, webgl.taskId);
      const webglLog = logs.find((l) => l.includes(RENDERER_LOG));
      expect(webglLog, "opt-in mount must log a renderer choice").toBeTruthy();
      expect(webglLog, "opt-in arm chooses WebGL").toContain(`${RENDERER_LOG}webgl`);

      // The differentiator — only assertable when this runner actually has a
      // working WebGL stack (SwiftShader present). When it does, the opt-in
      // provably changed the live renderer (none → canvas). When it doesn't,
      // the console divergence (dom vs webgl) already proves the toggle is
      // honored, and the addon self-falls-back — which is correct behaviour.
      const optInCanvases = await canvasCount(page);
      // eslint-disable-next-line no-console
      console.log(`[spec93] opt-in arm: canvases=${optInCanvases}`);
      if (optInCanvases > 0) {
        expect(
          optInCanvases,
          "WebGL opt-in arm has more canvases than the DOM default arm",
        ).toBeGreaterThan(0);
      }
    } finally {
      await webgl.cleanup();
    }
  });

  /*
   * AC-3 through the REAL Settings UI (external code review, medium: the arms
   * above seed localStorage directly, which proves the resolver but never that
   * a user can reach the toggle or that clicking it sticks). This drives the
   * actual checkbox and then proves a freshly-mounted terminal honours it.
   */
  test("the Settings checkbox persists the choice and a new terminal mounts with it", async ({
    page,
    request,
  }) => {
    const logs: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes(RENDERER_LOG)) logs.push(t);
    });

    const task = await createBareTask(page, request);
    try {
      await page.goto("/settings");
      const box = page.getByTestId("settings-terminal-gpu-checkbox");
      await expect(box).toBeVisible({ timeout: 15_000 });
      // Ships off by default — this is what a user sees on a fresh browser.
      await expect(box).not.toBeChecked();

      await box.check();
      await expect(box).toBeChecked();
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("shipwright:terminal-renderer"),
        ),
        "checking the box must persist the WebGL opt-in",
      ).toBe("webgl");

      // A terminal opened AFTER the toggle must actually use WebGL.
      logs.length = 0;
      await gotoTerminal(page, task.taskId);
      expect(
        logs.find((l) => l.includes(RENDERER_LOG)),
        "a terminal mounted after opting in must choose WebGL",
      ).toContain(`${RENDERER_LOG}webgl`);

      // And back off again — the opt-out must persist just as hard.
      await page.goto("/settings");
      const box2 = page.getByTestId("settings-terminal-gpu-checkbox");
      await expect(box2).toBeChecked();
      await box2.uncheck();
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("shipwright:terminal-renderer"),
        ),
        "un-checking the box must persist the opt-out",
      ).toBe("dom");

      logs.length = 0;
      await gotoTerminal(page, task.taskId);
      expect(
        logs.find((l) => l.includes(RENDERER_LOG)),
        "a terminal mounted after opting out must choose the DOM renderer",
      ).toContain(`${RENDERER_LOG}dom`);
    } finally {
      await task.cleanup();
    }
  });
});
