/*
 * Terminal appearance (light/dark, FR-01.44,
 * iterate-2026-07-06-terminal-theme-modes) — REAL browser against a live pty.
 *
 * Pins, end-to-end:
 *   1. Default appearance renders the DARK palette (bg #1a1a1a).
 *   2. Switching to Light LIVE re-themes the OPEN terminal (bg #ffffff)
 *      WITHOUT remounting it — the same Terminal instance + WS survive
 *      (Architecture rule 21). This is the novel/risky path.
 *   3. The Settings selector persists the choice, and a freshly-mounted
 *      terminal picks it up.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const APPEARANCE_KEY = "shipwright.terminal.appearance";
const PREFS_EVENT = "shipwright:terminal-prefs-changed";
const DARK_BG = "#1a1a1a";
const LIGHT_BG = "#ffffff";

async function makeCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "terminal-appearance-e2e-"));
}
async function cleanup(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
async function createTask(request: APIRequestContext, cwd: string): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "terminal-appearance-e2e", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  return ((await res.json()) as { task: { taskId: string } }).task.taskId;
}
async function openTerminal(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByTestId("embedded-terminal")).toBeVisible();
  await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
    "data-ws-ready",
    "true",
    { timeout: 20000 },
  );
  await page.waitForTimeout(800);
}
/** Read the live xterm theme background off the exposed instance. */
function themeBg(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __embeddedTerminal?: { options?: { theme?: { background?: string } } };
        }
      ).__embeddedTerminal?.options?.theme?.background,
  );
}

test.describe("FR-01.44 — terminal appearance", () => {
  // Playwright gives each test a fresh browser context → localStorage starts
  // empty → default appearance is `auto`, which (with no Claude light theme
  // in the isolated E2E home) resolves to dark. No per-test reset needed; an
  // addInitScript reset would re-run on EVERY navigation and clobber a pref
  // set on a prior page (e.g. Settings → terminal).

  test("defaults to dark; switching to Light live-re-themes the OPEN terminal (no remount)", async ({
    page,
    request,
  }) => {
    const cwd = await makeCwd();
    const taskId = await createTask(request, cwd);
    try {
      await openTerminal(page, taskId);

      // 1) Default = dark.
      expect(await themeBg(page)).toBe(DARK_BG);

      // Stash the current Terminal instance so we can prove it is NOT
      // recreated by the re-theme (rule 21).
      await page.evaluate(() => {
        (window as unknown as { __t0?: unknown }).__t0 = (
          window as unknown as { __embeddedTerminal?: unknown }
        ).__embeddedTerminal;
      });

      // 2) Flip to Light exactly as the Settings card does (persist + emit
      //    the same-tab change event) — the OPEN terminal must re-theme.
      await page.evaluate(
        ({ key, evt }) => {
          window.localStorage.setItem(key, "light");
          window.dispatchEvent(new Event(evt));
        },
        { key: APPEARANCE_KEY, evt: PREFS_EVENT },
      );

      await expect.poll(() => themeBg(page), { timeout: 5000 }).toBe(LIGHT_BG);

      // Same Terminal instance — no remount, WS still ready.
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __t0?: unknown }).__t0 ===
            (window as unknown as { __embeddedTerminal?: unknown })
              .__embeddedTerminal,
        ),
      ).toBe(true);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
      );
    } finally {
      await cleanup(cwd);
    }
  });

  test("the Settings selector persists the choice and a new terminal mounts with it", async ({
    page,
    request,
  }) => {
    const cwd = await makeCwd();
    const taskId = await createTask(request, cwd);
    try {
      await page.goto("/settings");
      const select = page.getByTestId("settings-terminal-appearance-select");
      await expect(select).toBeVisible();
      await select.selectOption("light");
      expect(
        await page.evaluate((k) => window.localStorage.getItem(k), APPEARANCE_KEY),
      ).toBe("light");

      // A freshly-mounted terminal must pick up the persisted Light choice.
      await openTerminal(page, taskId);
      expect(await themeBg(page)).toBe(LIGHT_BG);
    } finally {
      await cleanup(cwd);
    }
  });
});
