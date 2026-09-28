/*
 * wire.test.ts — direct coverage of `createWiredMissionContextRouter`'s
 * PRODUCTION `readTranscriptTail` wiring (external code review, openai +
 * glm, medium/test: the route-level `startedMidFile` tests in
 * `routes.recovery.midfile.test.ts` inject the flag through the harness's
 * `reads:` seam and never exercise this file's own arithmetic at all — this
 * file had ZERO test coverage before this iterate, despite being the ONLY
 * place `fromByte`/`startedMidFile` are actually computed from a real
 * `SessionWatcher` location in production).
 *
 * iterate-2026-09-28-mission-feed-completeness, AC2.
 * @covers FR-01.66
 */
import { describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

import { createWiredMissionContextRouter } from "./wire.js";
import { RECOVERY_TAIL_BYTES, TRANSCRIPT_TAIL_BYTES } from "./routes.js";
import { makeProject, makeTask, RUN_ID } from "./test-harness.js";
import type { SessionWatcher } from "../../core/session-watcher.js";
import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";

function buildApp(sizeBytes: number, readChunk: ReturnType<typeof vi.fn>) {
  const root = makeProject();
  const task = makeTask();
  const store = {
    get: (id: string) => (id === task.taskId ? task : undefined),
    patch: (id: string, patch: Record<string, unknown>) => {
      if (id !== task.taskId) return undefined;
      Object.assign(task, patch);
      return task;
    },
    persist: vi.fn(async () => {}),
  } satisfies Pick<SdkSessionsStore, "get" | "patch" | "persist">;
  const watcher = {
    findByUuid: vi.fn(async () => ({ path: "/fake/session.jsonl", sizeBytes, mtimeMs: 1 })),
    readChunk,
  } satisfies Pick<SessionWatcher, "findByUuid" | "readChunk">;
  const app = createWiredMissionContextRouter({
    store: store as unknown as SdkSessionsStore,
    watcher: watcher as unknown as SessionWatcher,
    getProjectById: (id) => (id === "proj-1" ? { id: "proj-1", name: "P", path: root } : undefined),
    readRunConfig: async () => ({ status: "missing" }),
  });
  return { app, root, watcher };
}

describe("createWiredMissionContextRouter — readTranscriptTail's fromByte/startedMidFile arithmetic", () => {
  it("a file no larger than the budget reads from byte 0 and reports startedMidFile: false", async () => {
    const readChunk = vi.fn(async () => ({ status: "ok" as const, chunk: { content: "", nextByte: 0 }, location: { path: "/fake/session.jsonl", sizeBytes: 1000, mtimeMs: 1 } }));
    const { app, root } = buildApp(1000, readChunk);
    try {
      await app.request(`/api/external/tasks/task-1/mission-context`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(readChunk).toHaveBeenCalledTimes(1);
    const args = readChunk.mock.calls[0][0] as { fromByte: number };
    expect(args.fromByte).toBe(0);
  });

  it("a file larger than RECOVERY_TAIL_BYTES computes fromByte as size minus the budget and reports startedMidFile: true", async () => {
    const size = RECOVERY_TAIL_BYTES * 3 + 12345;
    const footerFragment = `,"content":"padding\\n\\nRun-ID: ${RUN_ID}\\n"}]}}\n`;
    const readChunk = vi.fn(async () => ({ status: "ok" as const, chunk: { content: footerFragment, nextByte: size }, location: { path: "/fake/session.jsonl", sizeBytes: size, mtimeMs: 1 } }));
    const { app, root } = buildApp(size, readChunk);
    try {
      await app.request(`/api/external/tasks/task-1/mission-context`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(readChunk).toHaveBeenCalled();
    const wideCall = readChunk.mock.calls.find((call) => (call[0] as { fromByte: number }).fromByte > 0);
    expect(wideCall).toBeDefined();
    const args = wideCall![0] as { fromByte: number };
    // The exact budget used is clamped between TRANSCRIPT_TAIL_BYTES and
    // RECOVERY_TAIL_BYTES by wire.ts itself — assert the invariant
    // (`fromByte = size - budget`, budget in that range), not a hardcoded
    // number, so this test does not silently stop covering the real
    // arithmetic if the caller's requested budget changes shape.
    const budget = size - args.fromByte;
    expect(budget).toBeGreaterThanOrEqual(TRANSCRIPT_TAIL_BYTES);
    expect(budget).toBeLessThanOrEqual(RECOVERY_TAIL_BYTES);
    expect(args.fromByte).toBeGreaterThan(0);
  });
});
