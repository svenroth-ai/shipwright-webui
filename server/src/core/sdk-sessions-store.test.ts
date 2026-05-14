import { describe, it, expect, beforeEach } from "vitest";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "./sdk-sessions-store.js";

function inMemoryDeps(initial?: Record<string, string>): SdkSessionsStoreDeps & {
  __files: Map<string, string>;
  __existing: Set<string>;
} {
  const files = new Map<string, string>();
  if (initial) for (const [p, c] of Object.entries(initial)) files.set(p, c);
  const existing = new Set<string>(files.keys());
  return {
    __files: files,
    __existing: existing,
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

describe("SdkSessionsStore — create/list/patch/delete", () => {
  it("creates a task in draft state with a fresh UUID", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const task = store.create({ title: "t", cwd: "/tmp" });
    expect(task.state).toBe("draft");
    expect(task.title).toBe("t");
    expect(task.cwd).toBe("/tmp");
    expect(task.sessionUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.inbox).toEqual({
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    });
  });

  it("list returns tasks newest-first", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const a = store.create({ title: "a", cwd: "/tmp" });
    await new Promise((r) => setTimeout(r, 2));
    const b = store.create({ title: "b", cwd: "/tmp" });
    const list = store.list();
    expect(list[0].taskId).toBe(b.taskId);
    expect(list[1].taskId).toBe(a.taskId);
  });

  it("patch updates only the given fields", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const task = store.create({ title: "t", cwd: "/tmp" });
    store.patch(task.taskId, { state: "active", lastJsonlSeenMtimeMs: 1234 });
    const got = store.get(task.taskId);
    expect(got?.state).toBe("active");
    expect(got?.lastJsonlSeenMtimeMs).toBe(1234);
    expect(got?.title).toBe("t");
  });

  it("delete removes the task", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const task = store.create({ title: "t", cwd: "/tmp" });
    expect(store.delete(task.taskId)).toBe(true);
    expect(store.get(task.taskId)).toBeUndefined();
  });
});

describe("SdkSessionsStore — persist/load round-trip", () => {
  it("persists state and loads it back intact", async () => {
    const deps = inMemoryDeps();
    const path = "/store/sdk-sessions.json";
    const a = new SdkSessionsStore(path, deps);
    await a.load();
    const task = a.create({ title: "t", cwd: "/tmp", pluginDirs: ["/p1"] });
    a.patch(task.taskId, { state: "active" });
    await a.persist();

    // Fresh store instance with same deps reads back.
    const b = new SdkSessionsStore(path, deps);
    await b.load();
    const loaded = b.get(task.taskId);
    expect(loaded?.title).toBe("t");
    expect(loaded?.state).toBe("active");
    expect(loaded?.pluginDirs).toEqual(["/p1"]);
  });
});

describe("SdkSessionsStore — concurrent rename with proper-lockfile", () => {
  /**
   * Two writers race to rename the same task. With a serializing lock we
   * expect both writes to succeed (one waits for the other) and the
   * persisted file to contain one of the two titles — never a corrupted
   * mid-state. We use a real temp file + the real proper-lockfile so the
   * lock semantics aren't bypassed by the in-memory fake.
   */
  it("real proper-lockfile serializes two parallel rename+persist calls", async () => {
    const fs = await import("node:fs");
    const fsp = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const lockfile = await import("proper-lockfile");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-sessions-lock-"));
    const file = path.join(dir, "sdk-sessions.json");

    const realDeps = {
      readFile: (p: string, e: string) => fsp.readFile(p, e as BufferEncoding),
      writeFile: (p: string, d: string) => fsp.writeFile(p, d),
      existsSync: (p: string) => fs.existsSync(p),
      mkdirSync: (p: string, o?: { recursive: boolean }) => { fs.mkdirSync(p, o); },
      lock: async (p: string) => lockfile.lock(p, { retries: { retries: 5, minTimeout: 20 } }),
      ensureFile: (p: string) => { if (!fs.existsSync(p)) fs.writeFileSync(p, ""); },
    };

    const seed = new SdkSessionsStore(file, realDeps);
    await seed.load();
    const t = seed.create({ title: "init", cwd: "/tmp" });
    await seed.persist();

    // Two independent store instances racing to rename the same task.
    const a = new SdkSessionsStore(file, realDeps);
    const b = new SdkSessionsStore(file, realDeps);
    await a.load();
    await b.load();
    a.patch(t.taskId, { title: "from-a" });
    b.patch(t.taskId, { title: "from-b" });
    await Promise.all([a.persist(), b.persist()]);

    const final = new SdkSessionsStore(file, realDeps);
    await final.load();
    const got = final.get(t.taskId);
    expect(got).toBeDefined();
    expect(["from-a", "from-b"]).toContain(got!.title);

    // Cleanup.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, 20_000);
});

describe("SdkSessionsStore — corruption tolerance", () => {
  it("starts empty when the file is malformed JSON (does not throw)", async () => {
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": "this is not json" });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.list()).toEqual([]);
  });

  it("drops rows that fail schema validation but keeps the rest", async () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      sessions: {
        good: {
          taskId: "good",
          sessionUuid: "u",
          cwd: "/tmp",
          pluginDirs: [],
          state: "draft",
          title: "good",
          createdAt: "now",
          inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
        },
        bad: { nope: "invalid" },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].taskId).toBe("good");
  });

  it("starts empty on schemaVersion mismatch (future-proof)", async () => {
    const payload = JSON.stringify({ schemaVersion: 99, sessions: {} });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.list()).toEqual([]);
  });
});

// ---------- iterate-2026-05-14 lead-foundation-task-schema ----------
//
// 13 optional fields added to ExternalTask for leadwright Phase 1. All
// optional, additive only, schemaVersion stays 3. Source-of-truth spec at
// leadwright/docs/specs/phase-1-external-task-extension.md.

describe("SdkSessionsStore — lead-foundation field round-trip (iterate-2026-05-14)", () => {
  it("persists ALL 13 leadwright fields and loads them back identically", async () => {
    const deps = inMemoryDeps();
    const path = "/store/sdk-sessions.json";
    const a = new SdkSessionsStore(path, deps);
    await a.load();
    const task = a.create({
      title: "lead-task",
      cwd: "/tmp",
      domain: "shipwright",
      priority: "P1",
      complexityHint: "medium",
      tags: ["auth", "billing"],
      blockedBy: ["task-x", "task-y"],
    });
    // create() only accepts the 5 user-creatable fields. The remaining 8
    // daemon-owned + audit fields are set via patch() (the daemon writes
    // these on claim; the promote producer writes promotedFromTriageId).
    a.patch(task.taskId, {
      leadParentTaskId: "task-root",
      poFeedback: "Renamed wrong — please undo",
      claimToken: "tok-abc",
      claimedBy: "lead-7",
      claimedAt: "2026-05-14T20:30:00Z",
      claimPid: 12345,
      leadHandoff: {
        leadId: "lead-7",
        status: "completed",
        beatsUsed: 14,
        subIterateIds: ["sub-1", "sub-2"],
        summary: "All ACs passed; merged to main.",
        escalationReason: undefined,
        learningsExtracted: true,
      },
      promotedFromTriageId: "trg-1234",
    });
    await a.persist();

    const b = new SdkSessionsStore(path, deps);
    await b.load();
    const loaded = b.get(task.taskId);
    expect(loaded?.domain).toBe("shipwright");
    expect(loaded?.priority).toBe("P1");
    expect(loaded?.complexityHint).toBe("medium");
    expect(loaded?.tags).toEqual(["auth", "billing"]);
    expect(loaded?.blockedBy).toEqual(["task-x", "task-y"]);
    expect(loaded?.leadParentTaskId).toBe("task-root");
    expect(loaded?.poFeedback).toBe("Renamed wrong — please undo");
    expect(loaded?.claimToken).toBe("tok-abc");
    expect(loaded?.claimedBy).toBe("lead-7");
    expect(loaded?.claimedAt).toBe("2026-05-14T20:30:00Z");
    expect(loaded?.claimPid).toBe(12345);
    expect(loaded?.leadHandoff).toEqual({
      leadId: "lead-7",
      status: "completed",
      beatsUsed: 14,
      subIterateIds: ["sub-1", "sub-2"],
      summary: "All ACs passed; merged to main.",
      learningsExtracted: true,
    });
    expect(loaded?.promotedFromTriageId).toBe("trg-1234");
  });

  it("omits absent optional leadwright fields from the persisted JSON (no undefined keys)", async () => {
    // External review LOW-9: omitted fields must not be written as explicit
    // keys — keeps sdk-sessions.json diffs quiet and avoids gratuitous
    // `"leadHandoff": null` blobs.
    const deps = inMemoryDeps();
    const path = "/store/sdk-sessions.json";
    const a = new SdkSessionsStore(path, deps);
    await a.load();
    const task = a.create({ title: "no-lead-fields", cwd: "/tmp" });
    await a.persist();
    const raw = deps.__files.get(path)!;
    expect(raw).not.toContain("\"domain\"");
    expect(raw).not.toContain("\"priority\"");
    expect(raw).not.toContain("\"complexityHint\"");
    expect(raw).not.toContain("\"tags\"");
    expect(raw).not.toContain("\"blockedBy\"");
    expect(raw).not.toContain("\"leadParentTaskId\"");
    expect(raw).not.toContain("\"poFeedback\"");
    expect(raw).not.toContain("\"claimToken\"");
    expect(raw).not.toContain("\"claimedBy\"");
    expect(raw).not.toContain("\"claimedAt\"");
    expect(raw).not.toContain("\"claimPid\"");
    expect(raw).not.toContain("\"leadHandoff\"");
    expect(raw).not.toContain("\"promotedFromTriageId\"");
    // Sanity: the row still loads.
    const b = new SdkSessionsStore(path, deps);
    await b.load();
    expect(b.get(task.taskId)?.title).toBe("no-lead-fields");
  });

  it("preserves an empty tags array (NOT promoted to undefined)", async () => {
    const deps = inMemoryDeps();
    const path = "/store/sdk-sessions.json";
    const a = new SdkSessionsStore(path, deps);
    await a.load();
    const task = a.create({
      title: "empty-tags",
      cwd: "/tmp",
      tags: [],
    });
    await a.persist();
    const b = new SdkSessionsStore(path, deps);
    await b.load();
    const loaded = b.get(task.taskId);
    expect(loaded?.tags).toEqual([]);
  });

  it("preserves a leadHandoff with no optional sub-fields", async () => {
    const deps = inMemoryDeps();
    const path = "/store/sdk-sessions.json";
    const a = new SdkSessionsStore(path, deps);
    await a.load();
    const task = a.create({ title: "partial-handoff", cwd: "/tmp" });
    a.patch(task.taskId, {
      leadHandoff: {
        leadId: "lead-x",
        status: "escalated",
        beatsUsed: 5,
        summary: "Stuck on AC-3.",
      },
    });
    await a.persist();
    const b = new SdkSessionsStore(path, deps);
    await b.load();
    const loaded = b.get(task.taskId);
    expect(loaded?.leadHandoff).toEqual({
      leadId: "lead-x",
      status: "escalated",
      beatsUsed: 5,
      summary: "Stuck on AC-3.",
    });
    // Optional sub-fields are absent, not present-as-undefined.
    expect("subIterateIds" in (loaded!.leadHandoff!)).toBe(false);
    expect("escalationReason" in (loaded!.leadHandoff!)).toBe(false);
    expect("learningsExtracted" in (loaded!.leadHandoff!)).toBe(false);
  });

  it("round-trips JSON-edge characters in free-text fields", async () => {
    const deps = inMemoryDeps();
    const path = "/store/sdk-sessions.json";
    const a = new SdkSessionsStore(path, deps);
    await a.load();
    const task = a.create({
      title: "edge",
      cwd: "/tmp",
      domain: "foo/bar",
      tags: ["has,comma", "has\"quote", "has\nnewline"],
    });
    a.patch(task.taskId, {
      poFeedback: 'has "quotes" and\nnewlines and 🐶 emoji',
      leadHandoff: {
        leadId: "lead-x",
        status: "failed",
        beatsUsed: 1,
        summary: "<script>alert('xss')</script>",
        escalationReason: "ampersand & lt < gt >",
      },
    });
    await a.persist();
    const b = new SdkSessionsStore(path, deps);
    await b.load();
    const loaded = b.get(task.taskId);
    expect(loaded?.domain).toBe("foo/bar");
    expect(loaded?.tags).toEqual(["has,comma", "has\"quote", "has\nnewline"]);
    expect(loaded?.poFeedback).toBe('has "quotes" and\nnewlines and 🐶 emoji');
    expect(loaded?.leadHandoff?.summary).toBe("<script>alert('xss')</script>");
    expect(loaded?.leadHandoff?.escalationReason).toBe("ampersand & lt < gt >");
  });
});

describe("SdkSessionsStore — lead-foundation soft-drop on malformed fields (iterate-2026-05-14)", () => {
  function baseGoodRow() {
    return {
      taskId: "good",
      sessionUuid: "u",
      cwd: "/tmp",
      pluginDirs: [] as string[],
      state: "draft",
      title: "good",
      projectId: "unassigned",
      createdAt: "now",
      inbox: {
        pendingToolUseIds: [] as string[],
        dismissedToolUseIds: [] as string[],
        lastProcessedByteOffset: 0,
      },
    };
  }

  it("drops priority when value is not in the P0..P3 set", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: { ...baseGoodRow(), priority: "P9" }, // bogus
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const loaded = store.get("good");
    expect(loaded?.title).toBe("good"); // row survives
    expect(loaded?.priority).toBeUndefined(); // bad field dropped
  });

  it("drops priority when value is not a string", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: { ...baseGoodRow(), priority: 99 },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.get("good")?.priority).toBeUndefined();
    expect(store.get("good")?.title).toBe("good");
  });

  it("drops complexityHint when value is not in the small|medium|large set", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: { ...baseGoodRow(), complexityHint: "huge" },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.get("good")?.complexityHint).toBeUndefined();
  });

  it("drops tags / blockedBy when value is not an array of strings", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: {
          ...baseGoodRow(),
          tags: "not-an-array",
          blockedBy: [1, 2, "task-z"], // mixed types
        },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const loaded = store.get("good");
    expect(loaded?.tags).toBeUndefined(); // entire field dropped
    // For mixed-type arrays, non-strings are filtered (consistent with
    // pluginDirs handling).
    expect(loaded?.blockedBy).toEqual(["task-z"]);
  });

  it("drops the whole leadHandoff when status is not in the enum", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: {
          ...baseGoodRow(),
          leadHandoff: {
            leadId: "lead-x",
            status: "bogus", // not in completed|escalated|failed
            beatsUsed: 1,
            summary: "x",
          },
        },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.get("good")?.leadHandoff).toBeUndefined();
    expect(store.get("good")?.title).toBe("good");
  });

  it("drops the whole leadHandoff when required leadId is missing", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: {
          ...baseGoodRow(),
          leadHandoff: {
            status: "completed",
            beatsUsed: 0,
            summary: "x",
          },
        },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.get("good")?.leadHandoff).toBeUndefined();
  });

  it("drops claimPid when not a number", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        good: { ...baseGoodRow(), claimPid: "twelve" },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.get("good")?.claimPid).toBeUndefined();
  });

  it("tolerates leadwright fields on a v1 row (forward-compat after partial rollback)", async () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      sessions: {
        good: {
          ...baseGoodRow(),
          // v1 rows drop projectId; the loader backfills "unassigned".
          projectId: undefined,
          priority: "P0",
          tags: ["urgent"],
        },
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const loaded = store.get("good");
    expect(loaded?.priority).toBe("P0");
    expect(loaded?.tags).toEqual(["urgent"]);
  });
});
