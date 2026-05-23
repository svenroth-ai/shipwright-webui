/*
 * Shared Playwright helpers for the terminal-selection-uxd specs
 * (86-terminal-selection.spec.ts + 87-terminal-mouse-mode.spec.ts).
 *
 * Both specs need the same boilerplate to reach "embedded terminal is
 * mounted, ready, and rendering inside an isolated dev stack" — task
 * creation, launch, navigation, ws-ready wait. Centralised here so the
 * specs stay focused on the assertion they're empirically verifying.
 *
 * Created during iterate-2026-05-23-terminal-selection-uxd round 2
 * (user-requested empirical verification of the mouse-mode banner +
 * Shift+Drag bypass — second F0.5 surface beyond drag-select-to-clipboard).
 */

import {
  type APIRequestContext,
  type Page,
  expect,
} from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

interface ProjectListItem {
  id: string;
  path?: string;
}

export async function makeTaskCwd(prefix = "term-selection-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function deleteTask(
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
 * Resolve a project id usable for `/api/external/tasks?projectId=…`.
 * Tries existing projects first (production server), creates a fresh
 * one against a temp cwd otherwise. `cleanup()` is a no-op when an
 * existing project was reused; otherwise it deletes the project + temp cwd.
 */
export async function ensureProject(
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
    /* fall through */
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
 * One-shot setup: ensure a project, create a task at a real temp cwd,
 * launch it (`new-task` actionId), navigate the page to TaskDetail,
 * wait for the embedded terminal WS to reach ready. Returns the
 * resolved IDs + a `cleanup()` that tears down task, cwd, and (if
 * we created one) the project.
 */
export async function setupTerminalTask(
  page: Page,
  request: APIRequestContext,
): Promise<{
  taskId: string;
  cwd: string;
  cleanup: () => Promise<void>;
}> {
  const project = await ensureProject(request);
  const cwd = await makeTaskCwd();
  let taskId: string | undefined;
  try {
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
    const launched = await request.post(
      `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
      { data: { actionId: "new-task" } },
    );
    expect(launched.ok()).toBeTruthy();
    await page.goto(`/tasks/${taskId}`);
    const termWrap = page.getByTestId("embedded-terminal");
    await expect(termWrap).toHaveAttribute("data-ws-ready", "true", {
      timeout: 30_000,
    });
    // Settle window so the auto-execute injection / prompt paint has
    // time to land before the spec's assertions begin.
    await page.waitForTimeout(3_500);
    const finalTaskId = taskId;
    return {
      taskId: finalTaskId,
      cwd,
      cleanup: async () => {
        await deleteTask(request, finalTaskId);
        try {
          await fs.rm(cwd, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        await project.cleanup();
      },
    };
  } catch (err) {
    if (taskId) await deleteTask(request, taskId);
    try {
      await fs.rm(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await project.cleanup();
    throw err;
  }
}

/**
 * Read the live xterm selection via the production-shipped dev hook
 * (`window.__embeddedTerminal`). Returns the empty string when the
 * terminal isn't mounted or no selection is active.
 */
export async function readXtermSelection(page: Page): Promise<string> {
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

/**
 * Inject raw bytes into xterm via `term.write(...)`. Used by the
 * specs to (a) paint a deterministic marker line to drag-select, and
 * (b) put xterm into / out of mouse-tracking mode via DECSET 1000.
 */
export async function termWrite(page: Page, data: string): Promise<void> {
  await page.evaluate((bytes: string) => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        write(data: string): void;
        scrollToBottom(): void;
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) throw new Error("no __embeddedTerminal hook");
    term.write(bytes);
    term.scrollToBottom();
  }, data);
}

/**
 * Locator boundingBox + drag from (startX,startY) to (endX,endY) with
 * a couple of intermediate moves so xterm registers mousemoves
 * (single-jump drags sometimes do not extend selection). When
 * `shift` is true the Shift modifier is held across the drag — the
 * xterm.js built-in bypass for mouse-tracking mode.
 */
export async function dragInTerminal(
  page: Page,
  bounds: { x: number; y: number; width: number; height: number },
  opts: { shift?: boolean } = {},
): Promise<void> {
  const startX = bounds.x + 8;
  const startY = bounds.y + 20;
  const endX = bounds.x + Math.min(bounds.width - 8, 600);
  const endY = bounds.y + 100;
  if (opts.shift) await page.keyboard.down("Shift");
  try {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 20, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
  } finally {
    if (opts.shift) await page.keyboard.up("Shift");
  }
}
