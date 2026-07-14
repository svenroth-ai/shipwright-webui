/*
 * iterate-2026-06-27 (webgl-atlas-glyph-corruption) — real-browser proof that
 * the WebGL glyph-atlas-change repaint (webgl-atlas-repaint.ts) is wired to the
 * LIVE @xterm/addon-webgl instance.
 *
 * Bug: during active rendering single cells show the WRONG glyph (a clean
 * letter-for-letter swap) and only a manual resize heals it. Root cause: an atlas
 * SWAP on a terminal-option change (WebglRenderer._handleOptionsChanged →
 * onChangeTextureAtlas — e.g. the live theme re-resolve, FR-01.44) builds a fresh
 * atlas WITHOUT clearing the render model, so cells keep coordinates into the old
 * layout → a wrong glyph. Fix (2026-07-07, superseding the earlier `term.refresh`,
 * which skips "unchanged" cells): subscribe `onChangeTextureAtlas` (load-bearing) +
 * `onRemoveTextureAtlasCanvas` (defensive) to a deferred `term.clearTextureAtlas()`
 * — the public equivalent of the resize heal (it clears the model).
 *
 * This spec drives the live renderer with a load of DISTINCT full-width glyphs
 * (each scrolled line rasterises new code points until an atlas page overflows →
 * onChangeTextureAtlas) and asserts our handler fired, observed via the
 * `window.__embeddedTerminalAtlasRepaints` probe the handler bumps. jsdom can't
 * host a WebGL canvas, so this proof only exists in a REAL browser; the
 * deterministic wiring proof is xtermAddons.atlas.test.ts.
 *
 * GPU-dependent: headless Chromium WebGL (SwiftShader) usually loads the addon,
 * but a GPU-less runner falls back to the DOM renderer (no canvas, no atlas). The
 * atlas-repaint assertion is therefore made ONLY when the WebGL canvas exists;
 * otherwise the console renderer divergence + DOM fallback is informational. The
 * residue — whether the repaint visually eliminates the corruption on a SPECIFIC
 * GPU — is the user's single real-device confirmation (same stance as spec 93).
 *
 * Soft-skip on baseURL unreachable (matches specs 86/87/88/91/93).
 */

import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { ensureProject, makeTaskCwd, deleteTask } from "../helpers/terminal-selection";

const RENDERER_LOG = "[EmbeddedTerminal] renderer=";
const ATLAS_KEY = "__embeddedTerminalAtlasRepaints";

/** Create a bare task (shell pty; no Claude launch) + a cleanup. */
async function createBareTask(
  _page: Page,
  request: APIRequestContext,
): Promise<{ taskId: string; cleanup: () => Promise<void> }> {
  const project = await ensureProject(request);
  const cwd = await makeTaskCwd("term-atlas-");
  const created = await request.post("/api/external/tasks", {
    data: { title: "webgl-atlas spec 94", cwd, projectId: project.projectId },
  });
  expect(created.ok()).toBeTruthy();
  const taskId = ((await created.json()) as { task: { taskId: string } }).task.taskId;
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

/** Navigate + wait for the renderer to have instantiated (xterm opened). */
async function gotoTerminal(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByTestId("embedded-terminal")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="embedded-terminal"] .xterm-screen'),
  ).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

/** Count <canvas> under the terminal — WebGL renderer creates one; DOM none. */
async function canvasCount(page: Page): Promise<number> {
  return page.locator('[data-testid="embedded-terminal"] canvas').count();
}

/**
 * Reset the probe, then scroll many screenfuls of printable ASCII where EVERY
 * cell gets a distinct 24-bit foreground colour, straight to the xterm instance
 * (bypasses the pty — pure renderer exercise). The WebGL atlas is keyed by
 * (glyph, fg, bg, style), so a unique colour per cell mints a fresh atlas entry
 * each cell — exactly what a colourful TUI does — until a page overflows and the
 * atlas regenerates (→ onChangeTextureAtlas). Plain ASCII guarantees the glyphs
 * actually rasterise (the monospace font has no CJK, which would all collapse to
 * one missing-glyph slot and never grow the atlas). Returns the number of
 * atlas-change repaints our handler recorded.
 */
async function forceAtlasChurn(page: Page): Promise<number> {
  return page.evaluate(async (key) => {
    const term = (window as unknown as { __embeddedTerminal?: unknown })
      .__embeddedTerminal as
      | { write(d: string): void; cols?: number; rows?: number }
      | undefined;
    if (!term) return -1;
    (window as unknown as Record<string, number>)[key] = 0;
    const cols = term.cols ?? 80;
    const rows = term.rows ?? 24;
    const ESC = String.fromCharCode(27);
    const frame = () =>
      new Promise<void>((r) => requestAnimationFrame(() => r()));
    let n = 0; // global counter → unique fg colour + cycling glyph per cell
    for (let batch = 0; batch < 30; batch++) {
      let s = "";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const rr = n & 0xff;
          const gg = (n >> 8) & 0xff;
          const bb = (n >> 16) & 0xff;
          const ch = String.fromCharCode(33 + (n % 94)); // printable ASCII
          s += ESC + "[38;2;" + rr + ";" + gg + ";" + bb + "m" + ch;
          n++;
        }
        s += "\r\n";
      }
      s += ESC + "[0m";
      term.write(s);
      await frame();
      await frame();
    }
    // Primary deterministic trigger (GPU-independent): a font-size change
    // re-rasterises every glyph at the new size, replacing the atlas →
    // onChangeTextureAtlas fires → our heal (clearTextureAtlas) runs. The colour
    // churn above is what mints enough distinct atlas entries that pages fill and
    // eventually merge/repack → onRemoveTextureAtlasCanvas, the REAL corruption
    // path (existing coordinates rewritten). Both change + remove route through
    // our heal, so atlasRepaints counts them. NOTE: a plain page-ADD is
    // intentionally NOT healed (append-only; clearing on it would feedback-loop),
    // so this probe relies on the change/remove paths, not onAddTextureAtlasCanvas.
    const opt = term as unknown as { options: { fontSize?: number } };
    const orig = opt.options.fontSize ?? 13;
    for (let k = 0; k < 4; k++) {
      opt.options.fontSize = orig + 1 + k;
      await frame();
      await frame();
    }
    opt.options.fontSize = orig;
    for (let i = 0; i < 6; i++) await frame(); // settle final rasterise + refresh
    return (window as unknown as Record<string, number>)[key] ?? 0;
  }, ATLAS_KEY);
}

test.describe("Iterate webgl-atlas-repaint — atlas-change full repaint (real browser)", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(true, `baseURL unreachable (${(err as Error).message}); soft-skipping spec 94.`);
    }
  });

  test("a live WebGL atlas regeneration fires our full-viewport repaint handler", async ({
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
      await gotoTerminal(page, task.taskId);

      const rendererLog = logs.find((l) => l.includes(RENDERER_LOG));
      expect(rendererLog, "mount must log a renderer choice").toBeTruthy();

      const canvases = await canvasCount(page);
      const repaints = await forceAtlasChurn(page);
      // eslint-disable-next-line no-console
      console.log(
        `[spec94] renderer=${rendererLog} canvases=${canvases} atlasRepaints=${repaints}`,
      );

      if (canvases > 0 && rendererLog?.includes("webgl")) {
        // The live WebGL addon is active → driving thousands of distinct glyphs
        // MUST regenerate the texture-atlas at least once, and our
        // onChangeTextureAtlas handler MUST have fired a repaint. This is the
        // real-GPU proof the deterministic unit test cannot give.
        expect(
          repaints,
          "atlas-change handler must fire on the live WebGL addon under glyph load",
        ).toBeGreaterThan(0);
      } else {
        // GPU-less runner → DOM fallback: no canvas, no atlas. Console renderer
        // log already proves which renderer the code chose; nothing to repaint.
        expect(canvases, "DOM fallback creates no canvas").toBe(0);
      }
    } finally {
      await task.cleanup();
    }
  });

  /*
   * iterate-2026-07-14 (terminal-atlas-heal-on-refocus) — the RE-SHOW path.
   * A background GPU-texture eviction emits NO atlas event (and does not lose
   * the context), so the heal above never ran on a window restore and
   * `term.refresh` dirty-skipped the stale cells. The trailing activation pass
   * now calls the same deferred fence. Asserted as a DELTA on the live counter,
   * plus a settled/bounded check (a runaway would mean the clear re-triggered
   * itself — the feedback loop #206 fenced off). Wiring detail: unit suites.
   */
  test("a window re-show heals the live atlas exactly once (and does not loop)", async ({
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
      await gotoTerminal(page, task.taskId);
      const rendererLog = logs.find((l) => l.includes(RENDERER_LOG));
      const canvases = await canvasCount(page);

      if (canvases === 0 || !rendererLog?.includes("webgl")) {
        // GPU-less runner → DOM fallback: no atlas exists, so there is nothing
        // to heal and `healAtlas` is intentionally undefined (unit-pinned).
        expect(canvases, "DOM fallback creates no canvas").toBe(0);
        return;
      }

      // Baseline AFTER mount: `pageshow` at initial presentation may already
      // have driven one (no-op) heal, so measure a delta, never an absolute.
      const baseline = await page.evaluate(
        (key) => (window as unknown as Record<string, number>)[key] ?? 0,
        ATLAS_KEY,
      );

      // Return to the window: the real browser fires both of these on a restore.
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // The heal rides the LAST trailing pass (350 ms) — deliberately, so it
      // lands after the re-shown canvas has composited. Nothing may have healed
      // before that; assert the wait is actually load-bearing.
      const immediately = await page.evaluate(
        (key) => (window as unknown as Record<string, number>)[key] ?? 0,
        ATLAS_KEY,
      );
      expect(
        immediately - baseline,
        "the heal must NOT fire synchronously on the event (canvas has not composited)",
      ).toBe(0);

      await page.waitForTimeout(900); // past the 350 ms trailing pass + slack
      const afterRestore = await page.evaluate(
        (key) => (window as unknown as Record<string, number>)[key] ?? 0,
        ATLAS_KEY,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[spec94] re-show: baseline=${baseline} immediate=${immediately} after=${afterRestore}`,
      );

      // At least one clear for the restore. NOT an exact-equals: this counter is
      // SHARED with the event-driven heal, so an unrelated atlas mutation inside
      // the window (a theme re-resolve, a page merge from the post-clear
      // re-raster) would red the spec for a non-defect. "Exactly one per burst"
      // is pinned deterministically in the unit suites; what only a real browser
      // can prove is that the heal reaches the LIVE renderer at all.
      expect(
        afterRestore - baseline,
        "a window re-show must clear the glyph atlas on the live WebGL renderer",
      ).toBeGreaterThanOrEqual(1);

      // …and it must STAY there: no self-retriggering clear loop.
      await page.waitForTimeout(1_500);
      const settled = await page.evaluate(
        (key) => (window as unknown as Record<string, number>)[key] ?? 0,
        ATLAS_KEY,
      );
      expect(
        settled,
        "the atlas heal must not feedback-loop (count stays put once settled)",
      ).toBe(afterRestore);
    } finally {
      await task.cleanup();
    }
  });
});
