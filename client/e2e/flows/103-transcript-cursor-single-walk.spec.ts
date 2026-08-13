/*
 * Spec 103 — iterate-2026-07-22-transcript-cursor-single-walk.
 *
 * Spec 32 already proved the pane RENDERS appended lines (now migrated into
 * `src/components/external/BubbleTranscript.test.tsx`, "live content
 * growth"). That test passed before this change and passes after it,
 * because a pane that re-fetches the whole file every second also shows new
 * lines. It cannot tell the two apart.
 *
 * This spec asserts the thing that actually changed, against a real stack:
 *
 *   AC-1 — after the first poll the browser stops asking for the whole file.
 *          Read off the WIRE (`page.on("request")`), not off the DOM, because
 *          the rendered text is identical either way — that is the point of
 *          the change and the reason a render assertion cannot verify it.
 *   AC-2 — truncating the JSONL under the browser makes the server report
 *          `rotated`; the client must rewind to `fromByte=0` on the next
 *          poll.
 *
 * iterate-2026-08-13-mission-mobile-visual retired the Transcript sub-tab, so
 * the DOM half of this spec's original assertions ("still renders every
 * line" / "the pane REPLACES, not appends") no longer has a page to run
 * against — `useTaskTranscript` still polls unconditionally on every
 * TaskDetailPage mount (it also feeds the header's model name + Mission's
 * activity feed), but nothing renders the raw JSONL text by default anymore.
 * That specific end-to-end DOM proof is genuinely lost; the underlying
 * accumulate/rewind LOGIC it was corroborating is still pinned — in more
 * detail than this spec ever asserted — by the pre-existing
 * `src/hooks/useTaskTranscript.cursor.test.ts`,
 * `useTaskTranscript.cursor-reset.test.ts`, and `useTaskTranscript.accumulate.test.ts`
 * (mocked `getTranscript`, fake timers). What survives here is the one thing
 * those mocked tests structurally cannot show: that the REAL browser, against
 * a REAL server, over a REAL network round trip, actually sends the cursor it
 * claims to send.
 */

import {
  cleanupTaskCwd,
  seedTask,
  type SeededTask,
} from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

/** Fixture dirs created under the REAL ~/.claude/projects, removed after each
 *  test. Without this every run leaks a JSONL directory into home state — and
 *  here that is not merely untidy: these directories enlarge the very corpus
 *  the projects-dir walk has to scan, so the leak degrades the thing under
 *  test (external diff review, openai). Registered before use so a failed
 *  assertion still cleans up. */
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
  let task: SeededTask | undefined;

  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, task);
    while (createdDirs.length > 0) {
      rmSync(createdDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("stops re-requesting the whole file after the first poll (AC-1)", async ({
    page,
    request,
  }) => {
    task = await seedTask(request, { title: "cursor-poll" });

    const encodedDir = fixtureDir("e2e-cursor");
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);
    writeFileSync(jsonlPath, userLine(task.sessionUuid, "first line from e2e"), "utf-8");

    const cursors = recordTranscriptCursors(page, task.taskId);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();

    // Let several 1 Hz polls go by with the file UNCHANGED.
    await expect
      .poll(() => cursors.length, { timeout: 8000 })
      .toBeGreaterThanOrEqual(4);

    // Startup can issue a duplicate whole-file request while React mounts the
    // pane. Once the first delta request arrives, every steady-state poll must
    // continue from its cursor; pre-fix no request ever had a positive offset.
    expect(cursors[0]).toBe(0);
    const firstDelta = cursors.findIndex((cursor) => cursor > 0);
    expect(firstDelta).toBeGreaterThan(0);
    expect(cursors.slice(firstDelta).every((cursor) => cursor > 0)).toBe(true);
  });

  test("a truncated JSONL makes the next poll rewind to fromByte=0 (AC-2)", async ({
    page,
    request,
  }) => {
    task = await seedTask(request, { title: "cursor-rotate" });

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
    await expect.poll(() => cursors.some((cursor) => cursor > 0), { timeout: 6000 }).toBe(true);

    // Replace the file with a SHORTER one — a new session under the same uuid.
    // The server sees size < the fingerprint's size and reports `rotated`.
    writeFileSync(jsonlPath, userLine(task.sessionUuid, "post-rotation gamma"), "utf-8");

    // A rewind happened after the cursor had already advanced — `toContain(0)`
    // would be vacuous, since `cursors[0]` is ALWAYS 0 (internal review, LOW-6).
    await expect
      .poll(() => cursors.lastIndexOf(0), { timeout: 8000 })
      .toBeGreaterThan(0);
  });
});
