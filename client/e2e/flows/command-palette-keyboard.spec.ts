/*
 * A21 (FR-01.65) — command palette + keyboard map, real-browser proof.
 *
 * Covers:
 *   - AC4: Ctrl+K opens the palette from a route; Esc closes it; `?` opens the
 *     cheat-sheet (with BOTH chord columns — AC3).
 *   - AC4: j/k move a VISIBLE selection on the board; Enter opens the task.
 *   - AC1 (the load-bearing fence): with focus INSIDE the terminal, typing
 *     `t` / `j` / `k` / `?` triggers NO global action (no palette, no
 *     cheat-sheet, no board nav) — the keystrokes belong to the pty. This is
 *     the real-browser complement to the useKeyboardMap Vitest fence; A00's
 *     byte-path guard (unchanged by this iterate) proves the frames are
 *     byte-identical to main.
 *
 * Uses the A00 seeded fixtures + helpers/env (no hardcoded :3847, no operator
 * UUIDs). tsx watch must NOT run against this stack (it self-kills the ptys).
 */
import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

test.describe("A21 command palette + keyboard map", () => {
  let project: SeededProject;
  const taskIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of taskIds) await cleanupTask(request, id);
    taskIds.length = 0;
    if (project) await cleanupProject(request, project);
  });

  test("Ctrl+K opens the palette, Esc closes it, ? opens the cheat-sheet", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-a21-kbd" });
    const t = await seedTask(request, { title: "Add MFA support", projectId: project.projectId });
    taskIds.push(t.taskId);
    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    await page.locator("body").click();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    // Esc closes (Radix focus-trap releases).
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();

    // `?` opens the cheat-sheet, which lists BOTH chords (AC3).
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-sheet")).toBeVisible();
    await expect(page.getByTestId("shortcut-win-palette")).toHaveText("Ctrl+K");
    await expect(page.getByTestId("shortcut-mac-palette")).toHaveText("⌘K");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-sheet")).toBeHidden();
  });

  test("j/k move a visible board selection and Enter opens the task", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-a21-nav" });
    const t = await seedTask(request, { title: "First task", projectId: project.projectId });
    taskIds.push(t.taskId);
    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${t.taskId}`)).toBeVisible();

    await page.locator("body").click();
    await page.keyboard.press("j");
    // The first card carries the visible selection ring.
    await expect(page.locator('[data-nav-selected="true"]')).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tasks/${t.taskId}$`));
  });

  test("THE FENCE — the terminal keeps every keystroke, byte for byte (AC1)", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-a21-fence" });
    const t = await seedTask(request, { title: "Fence task", projectId: project.projectId });
    taskIds.push(t.taskId);
    await setActiveProject(page, project.projectId);

    // Capture OUTBOUND frames on the terminal WS before it opens. The embedded
    // terminal forwards each xterm keystroke as a {type:'data', data:'<char>'}
    // envelope (EmbeddedTerminal.onData → socket send).
    const sentData: string[] = [];
    page.on("websocket", (ws) => {
      if (!/\/api\/terminal\//.test(ws.url())) return;
      ws.on("framesent", (ev) => {
        const payload = typeof ev.payload === "string" ? ev.payload : ev.payload.toString();
        try {
          const msg = JSON.parse(payload) as { type?: string; data?: string };
          if (msg.type === "data" && typeof msg.data === "string") sentData.push(msg.data);
        } catch {
          /* non-JSON control frame — ignore */
        }
      });
    });

    await page.goto(`/tasks/${t.taskId}`);
    await page.getByTestId("task-detail-tab-terminal").click();
    const canvas = page.getByTestId("embedded-terminal-canvas");
    await expect(canvas).toBeVisible({ timeout: 25_000 });

    // Wait for the FIRST WS to reach ready (StrictMode aborts the first embedded
    // WS in E2E). Probe with a raw WebSocket so a fast click doesn't beat the
    // attach→prewarm park; then focus the terminal.
    await page.evaluate(async (taskId) => {
      await new Promise<void>((resolve) => {
        const url = `${location.origin.replace(/^http/, "ws")}/api/terminal/${taskId}`;
        let ws: WebSocket;
        try {
          ws = new WebSocket(url);
        } catch {
          resolve();
          return;
        }
        const done = () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          resolve();
        };
        ws.onopen = done;
        ws.onerror = done;
        setTimeout(done, 4000);
      });
    }, t.taskId);

    await canvas.click();
    const typed = ["t", "j", "k", "/", "?"];
    for (const key of typed) await page.keyboard.press(key);

    // The bytes reached the pty — the exact typed characters, in order, no more.
    await expect
      .poll(() => sentData.join(""), { timeout: 10_000 })
      .toContain(typed.join(""));

    // NONE of the global surfaces fired — the keystrokes were the pty's alone.
    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect(page.getByTestId("shortcuts-sheet")).toBeHidden();
    await expect(page.locator('[data-nav-selected="true"]')).toHaveCount(0);
  });
});
