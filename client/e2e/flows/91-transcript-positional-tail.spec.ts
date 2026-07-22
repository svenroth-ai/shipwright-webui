/*
 * Spec 91 — the transcript endpoint honours a bounded byte range against a
 * MULTI-MEGABYTE transcript, and the pane still streams over the same reader.
 *
 * iterate-2026-07-21-transcript-positional-tail-read made `SessionWatcher`
 * read only `[fromByte, EOF)` instead of loading the whole JSONL and slicing.
 * The unit suite pins the reader; this pins the CONTRACT the browser and the
 * Mission poll actually consume — through the real HTTP stack, against a file
 * large enough that a whole-file read would be a visible cost rather than a
 * rounding error.
 *
 * Why a spec at all when the diff is server-only: the backend-affects-frontend
 * rule. `readChunk` backs `GET /api/external/tasks/:id/transcript`, which the
 * task-detail pane polls once a second, so `surface = web` is owed even though
 * no client file changed.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

/** Roughly 2 MB of valid JSONL — just above this project's median transcript. */
function bulkLines(sessionUuid: string, count: number): string {
  const filler = "z".repeat(1800);
  let out = "";
  for (let i = 0; i < count; i++) {
    out +=
      JSON.stringify({
        type: "assistant",
        sessionId: sessionUuid,
        message: { content: [{ type: "text", text: `filler-${i} ${filler}` }] },
      }) + "\n";
  }
  return out;
}

test.describe("Transcript positional tail read", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "91-positional-tail" });
    await setActiveProject(page, project.projectId);
    await seedLocalStorage(page, {
      "webui:embedded-terminal-default-tab": '"transcript"',
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("serves a bounded tail of a multi-MB JSONL and keeps the pane live", async ({ page, request }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "positional-tail", cwd: "C:/tmp/positional-tail" },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-tail-${Date.now()}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    const head =
      JSON.stringify({
        type: "user",
        sessionId: task.sessionUuid,
        message: { content: "first line of a long session" },
      }) + "\n";
    const tail =
      JSON.stringify({
        type: "assistant",
        sessionId: task.sessionUuid,
        message: { content: [{ type: "text", text: "LAST-LINE-MARKER" }] },
      }) + "\n";
    writeFileSync(jsonlPath, head + bulkLines(task.sessionUuid, 1100) + tail, "utf-8");
    const size = statSync(jsonlPath).size;
    expect(size).toBeGreaterThan(2_000_000);

    // --- 1. The browser still renders the transcript over this reader. ---
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await expect(page.getByText("LAST-LINE-MARKER")).toBeVisible({ timeout: 15_000 });

    // --- 2. A bounded range returns ONLY that range, over real HTTP. ---
    const from = size - 4096;
    const res = await request.get(
      `/api/external/tasks/${task.taskId}/transcript?fromByte=${from}`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      status: string;
      chunk: { fromByte: number; toByte: number; size: number; content: string };
    };
    expect(body.status).toBe("ok");
    expect(body.chunk.fromByte).toBe(from);
    expect(body.chunk.size).toBe(size);
    // The chunk covers the tail, never the head, and is a fraction of the file.
    expect(body.chunk.content.length).toBeLessThan(8192);
    expect(body.chunk.content).not.toContain("first line of a long session");
    expect(body.chunk.content.endsWith("\n")).toBe(true);
    expect(body.chunk.toByte).toBeLessThanOrEqual(size);

    // --- 3. Cursor safety: resuming from toByte yields the appended bytes
    //        exactly once, with nothing skipped in between. ---
    const cursor = body.chunk.toByte;
    const appended =
      JSON.stringify({
        type: "assistant",
        sessionId: task.sessionUuid,
        message: { content: [{ type: "text", text: "APPENDED-AFTER-CURSOR" }] },
      }) + "\n";
    appendFileSync(jsonlPath, appended, "utf-8");

    const res2 = await request.get(
      `/api/external/tasks/${task.taskId}/transcript?fromByte=${cursor}`,
    );
    const body2 = (await res2.json()) as {
      status: string;
      chunk: { fromByte: number; toByte: number; content: string };
    };
    expect(body2.status).toBe("ok");
    expect(body2.chunk.fromByte).toBe(cursor);
    expect(body2.chunk.content).toContain("APPENDED-AFTER-CURSOR");
    // Exactly once — a re-read of already-delivered bytes would duplicate it.
    expect(body2.chunk.content.split("APPENDED-AFTER-CURSOR").length - 1).toBe(1);
    expect(body2.chunk.toByte).toBe(statSync(jsonlPath).size);

    // --- 4. The live pane picks the append up too (same reader, 1 s poll). ---
    await expect(page.getByText("APPENDED-AFTER-CURSOR")).toBeVisible({ timeout: 15_000 });
  });
});
