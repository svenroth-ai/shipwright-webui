/*
 * Spec 103 — iterate-2026-07-22-transcript-cursor-single-walk.
 *
 * Spec 32 already proves the pane RENDERS appended lines. That test passed
 * before this change and passes after it, because a pane that re-fetches the
 * whole file every second also shows new lines. It cannot tell the two apart.
 *
 * This spec asserts the thing that actually changed, against a real stack:
 *
 *   AC-1 — after the first poll the browser stops asking for the whole file.
 *          Read off the WIRE (`page.on("request")`), not off the DOM, because
 *          the rendered text is identical either way — that is the point of
 *          the change and the reason a render assertion cannot verify it.
 *   AC-1 — the accumulated pane still shows every line: the ones delivered by
 *          the first whole-file poll AND the ones that only ever arrived
 *          inside a later delta.
 *   AC-2 — truncating the JSONL under the browser makes the server report
 *          `rotated`; the client must rewind to `fromByte=0` and REPLACE, so
 *          the pane shows the new content and not the old text with the new
 *          spliced onto it.
 */

import {
  cleanupProject,
  seedLocalStorage,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

/** Fixture dirs created under the REAL ~/.claude/projects, removed after each
 *  test. `cleanupProject` only removes the seeded app project, so without this
 *  every run leaks a JSONL directory into home state — and here that is not
 *  merely untidy: these directories enlarge the very corpus the projects-dir
 *  walk has to scan, so the leak degrades the thing under test (external diff
 *  review, openai). Registered before use so a failed assertion still cleans up. */
const createdDirs: string[] = [];

function fixtureDir(prefix: string): string {
  const dir = path.join(PROJECTS_DIR, `${prefix}-${Date.now()}`);
  createdDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Every `fromByte` the page asked the transcript endpoint for, in order. */
function recordTranscriptCursors(
  page: import("@playwright/test").Page,
  taskId: string,
): number[] {
  const seen: number[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url(), "http://localhost");
    if (!url.pathname.endsWith(`/tasks/${taskId}/transcript`)) return;
    seen.push(Number(url.searchParams.get("fromByte") ?? "0"));
  });
  return seen;
}

function userLine(sessionUuid: string, text: string): string {
  return (
    JSON.stringify({ type: "user", sessionId: sessionUuid, message: { content: text } }) + "\n"
  );
}

test.describe("Transcript cursor — the pane asks for the delta", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "103-transcript-cursor" });
    await setActiveProject(page, project.projectId);
    // The center tab is persisted and defaults to "terminal", so the
    // transcript pane is hidden on a fresh profile (A00).
    await seedLocalStorage(page, {
      "webui:embedded-terminal-default-tab": '"transcript"',
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
    while (createdDirs.length > 0) {
      rmSync(createdDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("stops re-requesting the whole file, and still renders every line (AC-1)", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "cursor-poll", cwd: "C:/tmp/cursor-poll" },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = fixtureDir("e2e-cursor");
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);
    writeFileSync(jsonlPath, userLine(task.sessionUuid, "first line from e2e"), "utf-8");

    const cursors = recordTranscriptCursors(page, task.taskId);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await expect(page.getByText("first line from e2e")).toBeVisible({ timeout: 5000 });

    // Let several 1 Hz polls go by with the file UNCHANGED.
    await expect
      .poll(() => cursors.length, { timeout: 8000 })
      .toBeGreaterThanOrEqual(4);

    // The first poll legitimately asks for everything; every later one must
    // ask from where the previous response ended. Pre-fix every entry was 0.
    expect(cursors[0]).toBe(0);
    const later = cursors.slice(1);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((c) => c > 0)).toBe(true);

    // Now append a line that ONLY ever arrives inside a delta — the first
    // whole-file poll never saw it. If accumulation were broken (replace
    // instead of append) the earlier line would vanish when this one lands.
    appendFileSync(jsonlPath, userLine(task.sessionUuid, "second line via delta"), "utf-8");
    await expect(page.getByText("second line via delta")).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("first line from e2e")).toBeVisible();
  });

  test("a truncated JSONL rewinds the cursor and REPLACES the pane (AC-2)", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "cursor-rotate", cwd: "C:/tmp/cursor-rotate" },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = fixtureDir("e2e-cursor-rot");
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);
    writeFileSync(
      jsonlPath,
      userLine(task.sessionUuid, "pre-rotation alpha") +
        userLine(task.sessionUuid, "pre-rotation beta"),
      "utf-8",
    );

    const cursors = recordTranscriptCursors(page, task.taskId);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await expect(page.getByText("pre-rotation beta")).toBeVisible({ timeout: 5000 });
    await expect.poll(() => cursors.length, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
    expect(cursors[cursors.length - 1]).toBeGreaterThan(0);

    // Replace the file with a SHORTER one — a new session under the same uuid.
    // The server sees size < the fingerprint's size and reports `rotated`.
    writeFileSync(jsonlPath, userLine(task.sessionUuid, "post-rotation gamma"), "utf-8");

    await expect(page.getByText("post-rotation gamma")).toBeVisible({ timeout: 8000 });
    // REPLACED, not appended: a client that kept its cursor would have shown
    // the old lines forever, and one that appended blindly would show both.
    await expect(page.getByText("pre-rotation alpha")).toHaveCount(0);
    // And the recovery went out as a whole-file read. `toContain(0)` would be
    // vacuous — `cursors[0]` is ALWAYS 0 — so assert a rewind happened after
    // the cursor had already advanced (internal review, LOW-6).
    expect(cursors.lastIndexOf(0)).toBeGreaterThan(0);
  });
});
