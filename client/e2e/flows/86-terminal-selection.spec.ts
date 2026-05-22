/*
 * iterate-2026-05-23 (terminal-selection-uxd) — drag-select → clipboard
 * end-to-end regression guard.
 *
 * Verifies AC1 of the iterate spec: in a non-mouse-tracking shell, the
 * user drag-selects text in the embedded terminal pane, and the OS
 * clipboard auto-fills with that selection. This drives the full
 * production pipeline:
 *
 *   xterm canvas mouse hit-testing
 *     → xterm SelectionService
 *       → term.onSelectionChange (updates latestSelectionRef)
 *         → native mouseup on term.element
 *           → flushSelectionCopy → copyText → navigator.clipboard.writeText
 *             → navigator.clipboard.readText() in test
 *
 * Pre-build assumption: the embedded terminal exposes
 * `window.__embeddedTerminal` (pre-existing dev hook for E2E). The test
 * uses this to introspect `term.getSelection()` directly so we don't
 * have to depend on the canvas hit-test being pixel-perfect — if xterm
 * registered ANY selection during the drag, the hook surfaces it.
 *
 * Soft-skips:
 *   - baseURL unreachable (matches the v0-9-6-live-pty-replay pattern).
 *   - clipboard permission denied (Chromium policy may strip in some
 *     test contexts; we'd rather skip than false-flag).
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(
  __dirname,
  "../../playwright-report/86-terminal-selection",
);

interface ProjectListItem {
  id: string;
  path?: string;
}

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "term-selection-"));
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
 * Find a project id to attach the task to. Tries existing projects
 * first (production-server case), then creates a fresh project against
 * a temp cwd (isolated-server case). Returns the id + a `cleanup()`
 * that runs ONLY when this spec created the project.
 */
async function ensureProject(
  request: APIRequestContext,
): Promise<{ projectId: string; cleanup: () => Promise<void> }> {
  try {
    const r = await request.get("/api/projects");
    if (r.ok()) {
      const body = (await r.json()) as
        | { data?: ProjectListItem[] }
        | ProjectListItem[];
      const items: ProjectListItem[] = Array.isArray(body)
        ? body
        : body.data ?? [];
      if (items.length > 0) {
        return { projectId: items[0].id, cleanup: async () => {} };
      }
    }
  } catch {
    /* fall through to create */
  }
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "term-selection-proj-"));
  const created = await request.post("/api/projects", {
    data: {
      name: "term-selection-uxd-spec",
      path: cwd,
      color: "#4f46e5",
    },
  });
  if (!created.ok()) {
    throw new Error(
      `failed to create project: ${created.status()} ${await created.text()}`,
    );
  }
  const body = (await created.json()) as {
    data?: { id?: string };
    id?: string;
  };
  const projectId = body.data?.id ?? body.id;
  if (!projectId) throw new Error("create-project response carried no id");
  return {
    projectId,
    cleanup: async () => {
      try {
        await request.delete(`/api/projects/${encodeURIComponent(projectId)}`);
      } catch {
        /* best-effort */
      }
      try {
        await fs.rm(cwd, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Read the live xterm selection via the production-shipped dev hook
 * (`window.__embeddedTerminal`). Returns the empty string when the
 * terminal isn't yet mounted or no selection is active.
 */
async function readXtermSelection(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        getSelection(): string;
        hasSelection(): boolean;
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) return "";
    try {
      return term.hasSelection() ? term.getSelection() : "";
    } catch {
      return "";
    }
  });
}

test.describe("Iterate terminal-selection-uxd — drag-select → clipboard", () => {
  test.setTimeout(180_000);

  // Soft-skip when the configured baseURL is unreachable.
  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping spec 86 per the iterate-2026-05-23 spec.`,
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    // Force the Terminal tab open by default so taskDetail lands on it.
    // No project-id init here — the spec body resolves the project id
    // at runtime via `ensureProject()`.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "webui:embedded-terminal-default-tab",
          '"terminal"',
        );
      } catch {
        /* noop */
      }
    });
  });

  test("drag-select inside a fresh shell auto-fills the OS clipboard", async ({
    page,
    request,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    const project = await ensureProject(request);
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;

    try {
      // 1. Seed a task pointing at a real cwd (a non-existent cwd makes
      //    the WS upgrade fail with 500 task_cwd_unresolvable — see
      //    memory `feedback_iterate_e2e_isolated_userprofile`).
      const created = await request.post("/api/external/tasks", {
        data: {
          title: "term-selection-uxd spec",
          cwd,
          actionId: "new-task",
          projectId: project.projectId,
        },
      });
      expect(created.ok()).toBeTruthy();
      const cBody = (await created.json()) as { task: { taskId: string } };
      taskId = cBody.task.taskId;

      // 2. Launch the task — auto-execute pipeline injects the new-task
      //    command into the freshly-spawned shell. We do NOT spawn
      //    Claude here (extra TUI flake + mouse mode); the launch
      //    yields a bare shell waiting at a prompt.
      const launched = await request.post(
        `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
        { data: { actionId: "new-task" } },
      );
      expect(launched.ok()).toBeTruthy();

      // 3. Open TaskDetail; wait for the embedded terminal to reach
      //    `data-ws-ready=true`.
      await page.goto(`/tasks/${taskId}`);
      const termWrap = page.getByTestId("embedded-terminal");
      await expect(termWrap).toHaveAttribute("data-ws-ready", "true", {
        timeout: 30_000,
      });

      // 4. Give the pwsh prompt time to render. The new-task auto-execute
      //    may print a `cd <cwd>` line plus a fresh prompt — either way,
      //    visible text we can drag-select.
      await page.waitForTimeout(3_500);

      // 5. Inject a deterministic, easy-to-eyeball line via xterm.write
      //    (the same dev hook used by other terminal E2E specs). Bypasses
      //    pty echo timing so the selection has predictable content.
      const MARKER = `SELECTION_MARKER_${Date.now()}`;
      await page.evaluate((marker: string) => {
        const w = window as unknown as {
          __embeddedTerminal?: {
            write(data: string): void;
            scrollToBottom(): void;
          } | null;
        };
        const term = w.__embeddedTerminal;
        if (!term) throw new Error("no __embeddedTerminal hook");
        term.write(`${marker}\r\n`);
        term.scrollToBottom();
      }, MARKER);

      // 6. Locate the canvas wrapper and compute a drag box that
      //    overlaps the freshly-rendered MARKER line. xterm rows are
      //    ~16-20px tall at fontSize:13 — drag a generous swath.
      const canvas = page
        .locator('[data-testid="embedded-terminal-canvas"]')
        .first();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("terminal canvas has no bounding box");

      const startX = box.x + 8;
      const startY = box.y + 20;
      const endX = box.x + Math.min(box.width - 8, 600);
      const endY = box.y + 100;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Move in steps so xterm registers mousemove events between
      // down and up — single jumps sometimes do not extend selection.
      await page.mouse.move(startX + 60, startY + 20, { steps: 5 });
      await page.mouse.move(endX, endY, { steps: 10 });
      await page.mouse.up();

      // 7. Let the mouseup-driven copyText path resolve.
      await page.waitForTimeout(250);

      // 8. The xterm selection should be non-empty. Capture artifacts
      //    if it isn't (helps debug a flaky drag).
      const selectionText = await readXtermSelection(page);
      if (!selectionText) {
        await page.screenshot({
          path: path.join(ARTIFACT_DIR, "no-selection.png"),
          fullPage: true,
        });
      }
      expect(selectionText.length).toBeGreaterThan(0);

      // 9. The clipboard should contain that selection (auto-copy
      //    fired on mouseup). Skip-on-permission-denied — playwright
      //    config grants the permission, but defensive.
      const clipText = await page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch (err) {
          return `__READ_FAILED__: ${(err as Error).message}`;
        }
      });
      if (clipText.startsWith("__READ_FAILED__")) {
        test.skip(
          true,
          `navigator.clipboard.readText rejected: ${clipText}; spec 86 assumes clipboard permissions per playwright.config.ts`,
        );
        return;
      }
      expect(clipText.trim().length).toBeGreaterThan(0);
      // Tightened equality (external-review round 4 MED-4): the FULL
      // trimmed + whitespace-normalised selection must appear in the
      // clipboard, not just a prefix. Whitespace normalisation absorbs
      // OS line-ending differences (\r\n vs \n) and xterm's row-trailing
      // space flattening; nothing else.
      const normalise = (s: string) => s.trim().replace(/\s+/g, " ");
      expect(normalise(clipText)).toContain(normalise(selectionText));
    } finally {
      if (taskId) await deleteTask(request, taskId);
      try {
        await fs.rm(cwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      await project.cleanup();
    }
  });
});
