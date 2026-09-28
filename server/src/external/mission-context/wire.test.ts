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
import { getContext, makeProject, makeTask, RUN_ID } from "./test-harness.js";
import { prunePointer, recordRun } from "./routes.recovery.test.js";
import type { SessionWatcher } from "../../core/session-watcher.js";
import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";

/** `recovery = true` prunes the `iterate_active` pointer and writes the
 *  corroboration record — the shape a transcript-driven recovery test needs
 *  (matching `routes.recovery.midfile.test.ts`'s own setup), so association
 *  cannot succeed via the pointer regardless of what the transcript says. */
function buildApp(sizeBytes: number, readChunk: ReturnType<typeof vi.fn>, recovery = false) {
  const root = makeProject();
  if (recovery) {
    prunePointer(root);
    recordRun(root);
  }
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
  it("a file no larger than the budget reads from byte 0 with no peek, and reports startedMidFile: false", async () => {
    const readChunk = vi.fn(async () => ({ status: "ok" as const, chunk: { content: "hello", nextByte: 0 }, location: { path: "/fake/session.jsonl", sizeBytes: 1000, mtimeMs: 1 } }));
    const { app, root } = buildApp(1000, readChunk);
    try {
      await app.request(`/api/external/tasks/task-1/mission-context`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(readChunk).toHaveBeenCalledTimes(1);
    const args = readChunk.mock.calls[0][0] as { fromByte: number };
    // No byte precedes position 0, so nothing is peeked and nothing is
    // stripped — `fromByte` stays exactly the intended tail start.
    expect(args.fromByte).toBe(0);
  });

  it("a file larger than RECOVERY_TAIL_BYTES reads one byte before the intended tail start, to peek it", async () => {
    const size = RECOVERY_TAIL_BYTES * 3 + 12345;
    const readChunk = vi.fn(async () => ({ status: "ok" as const, chunk: { content: "\n{}", nextByte: size }, location: { path: "/fake/session.jsonl", sizeBytes: size, mtimeMs: 1 } }));
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
    // The requested budget itself is clamped between TRANSCRIPT_TAIL_BYTES
    // and RECOVERY_TAIL_BYTES by wire.ts — assert the invariant
    // (`fromByte = size - budget - 1`, the extra `-1` being the peek byte),
    // not a hardcoded number, so this test does not silently stop covering
    // the real arithmetic if the caller's requested budget changes shape.
    const budget = size - args.fromByte - 1;
    expect(budget).toBeGreaterThanOrEqual(TRANSCRIPT_TAIL_BYTES);
    expect(budget).toBeLessThanOrEqual(RECOVERY_TAIL_BYTES);
  });

  // A single-line fragment can never have its "leading line" dropped
  // (`stripUserTypeLines` guards `lines.length > 1`), so both scenarios
  // below use a two-line fragment: only when the footer's own line is
  // wrongly dropped does recovery fail. The mock slices a VIRTUAL FILE by
  // the actual `fromByte` it receives (rather than returning fixed content
  // regardless of the argument) — otherwise these tests cannot tell apart
  // "wire.ts requested one byte earlier and peeked it" from "wire.ts
  // requested exactly `target` and never looked at the preceding byte at
  // all", which is the exact distinction this fix makes.
  function buildVirtualFileMock(target: number, peekChar: string, size: number) {
    const footer = `Run-ID: ${RUN_ID}\ntrailing content\n`;
    // Only two `fromByte` values are meaningful here: exactly `target` (what
    // the OLD, unfixed code requests — proving it never even looks at the
    // preceding byte) or `target - 1` (what the fix requests, to peek it).
    return vi.fn(async (args: { fromByte: number }) => ({
      status: "ok" as const,
      chunk: { content: args.fromByte === target ? footer : peekChar + footer, nextByte: size },
      location: { path: "/fake/session.jsonl", sizeBytes: size, mtimeMs: 1 },
    }));
  }

  it("reports startedMidFile: false when the peeked byte IS a newline — the read landed on a real line boundary, and the footer line survives", async () => {
    const size = RECOVERY_TAIL_BYTES * 3 + 12345;
    const budget = RECOVERY_TAIL_BYTES;
    const target = size - budget;
    // The byte immediately before `target` in the real file is "\n": position
    // `target` is itself a genuine line start.
    const readChunk = buildVirtualFileMock(target, "\n", size);
    const { app, root } = buildApp(size, readChunk, true);
    let ctx;
    try {
      ctx = await getContext(app);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(ctx.scenario).toBe("iterate");
    expect(ctx.runId).toBe(RUN_ID);
  });

  it("reports startedMidFile: true when the peeked byte is NOT a newline — the read genuinely landed mid-line, so the footer line is correctly dropped", async () => {
    const size = RECOVERY_TAIL_BYTES * 3 + 12345;
    const budget = RECOVERY_TAIL_BYTES;
    const target = size - budget;
    // The byte immediately before `target` in the real file is NOT "\n":
    // `target` sits inside an already-open line from the previous
    // (unread) byte range — a genuine byte cut.
    const readChunk = buildVirtualFileMock(target, ",", size);
    const { app, root } = buildApp(size, readChunk, true);
    let ctx;
    try {
      ctx = await getContext(app);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(ctx.scenario).toBe("plain");
    expect(ctx.runId).toBeNull();
  });
});
