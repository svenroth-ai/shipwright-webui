/*
 * Spec 34 — Browser refresh during a JSONL write: transcript re-fetches,
 * no duplicate events, no server-side state corruption. The stateless
 * transcript endpoint (round-3 Gemini BLOCKER fix; CLAUDE.md architecture
 * rule 4 — "no server-side byte-offset cache; multi-tab for free") makes
 * this trivial; this spec is a regression guard that proves it.
 *
 * iterate-2026-08-13-mission-mobile-visual retired the Transcript sub-tab
 * this spec used to observe through `bubble-user`/`getByText(...)` DOM
 * assertions — BubbleTranscript is no longer reached from any route, so a
 * real browser reload has nothing bubble-shaped left to re-render. A
 * client-side `useTaskTranscript` reload still means "refetch from byte 0
 * with no memory of the prior read" either way (stateless is a SERVER
 * property, not a UI one), so the guarantee this spec exists to pin —
 * a from-scratch read after new content lands returns the full, non-
 * duplicated file exactly once — is proven directly against the endpoint
 * a real reload would call, same pattern already used by spec 91
 * (positional-tail) for the same class of retired DOM dependency.
 */

import { cleanupTaskCwd, seedTask, type SeededTask } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Browser refresh during JSONL write", () => {
  let task: SeededTask | undefined;

  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, task);
  });

  test("a from-scratch read after an append returns the whole file, no duplicates", async ({ request }) => {
    task = await seedTask(request, { title: "refresh-test" });

    const encodedDir = path.join(PROJECTS_DIR, `e2e-refresh-${Date.now()}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);
    writeFileSync(
      jsonlPath,
      JSON.stringify({
        type: "user",
        sessionId: task.sessionUuid,
        message: { content: "round 1" },
      }) + "\n",
      "utf-8",
    );

    // A real reload's first request always starts from byte 0 — no client
    // memory of a prior cursor survives a full page load.
    const res1 = await request.get(`/api/external/tasks/${task.taskId}/transcript?fromByte=0`);
    expect(res1.status()).toBe(200);
    const body1 = (await res1.json()) as { chunk: { content: string } };
    expect(body1.chunk.content.split("round 1").length - 1).toBe(1);
    expect(body1.chunk.content).not.toContain("round 2");

    // Append (simulates the write landing between the pre- and post-refresh
    // reads), then re-read from byte 0 again — the "refresh" itself.
    appendFileSync(
      jsonlPath,
      JSON.stringify({
        type: "assistant",
        sessionId: task.sessionUuid,
        message: { content: [{ type: "text", text: "round 2" }] },
      }) + "\n",
      "utf-8",
    );

    const res2 = await request.get(`/api/external/tasks/${task.taskId}/transcript?fromByte=0`);
    expect(res2.status()).toBe(200);
    const body2 = (await res2.json()) as { chunk: { content: string } };
    // Exactly one of each — a server that cached the first read's offset, or
    // that duplicated on append, would fail one of these two counts.
    expect(body2.chunk.content.split("round 1").length - 1).toBe(1);
    expect(body2.chunk.content.split("round 2").length - 1).toBe(1);
  });
});
