import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { createTriageRoutes, type TriageRoutesDeps } from "./triage.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";
import { appendStatusEvent, TriageWriteError } from "../core/triage-write.js";

function inMemorySdkDeps(): SdkSessionsStoreDeps & { _files: Map<string, string> } {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    _files: files,
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

/**
 * In-process mutex per path — mirrors proper-lockfile's serialization
 * within a single process. Production cross-process locking is the
 * sdk-sessions.json + triage.jsonl proper-lockfile, but for unit-test
 * concurrency assertions an in-process mutex is sufficient.
 */
function inProcessLock(): TriageRoutesDeps["lock"] {
  const queues = new Map<string, Promise<void>>();
  return async (path: string) => {
    const prev = queues.get(path) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((res) => {
      release = res;
    });
    queues.set(path, prev.then(() => next));
    await prev;
    return async () => {
      release();
    };
  };
}

interface Harness {
  workDir: string;
  projectAPath: string;
  projectBPath: string;
  triagePathA: string;
  triagePathB: string;
  store: SdkSessionsStore;
  app: Hono;
  cleanup: () => void;
  setOverride: (fn?: TriageRoutesDeps["appendStatusEventOverride"]) => void;
}

async function makeHarness(
  opts: { lock?: TriageRoutesDeps["lock"] } = {},
): Promise<Harness> {
  _clearCache_TEST_ONLY();
  const workDir = mkdtempSync(path.join(tmpdir(), "triage-routes-"));
  const projectAPath = path.join(workDir, "project-a");
  const projectBPath = path.join(workDir, "project-b");
  mkdirSync(path.join(projectAPath, ".shipwright"), { recursive: true });
  mkdirSync(path.join(projectBPath, ".shipwright"), { recursive: true });

  const triagePathA = path.join(projectAPath, ".shipwright", "triage.jsonl");
  const triagePathB = path.join(projectBPath, ".shipwright", "triage.jsonl");

  const projects = [
    { id: "proj-a", path: projectAPath },
    { id: "proj-b", path: projectBPath },
  ];
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const sdkDeps = inMemorySdkDeps();
  const store = new SdkSessionsStore("/tmp/test/sdk-sessions.json", sdkDeps);
  await store.load();

  let appendOverride: TriageRoutesDeps["appendStatusEventOverride"] | undefined;
  const deps: TriageRoutesDeps = {
    getAllProjects: () => projects,
    getProjectById: (id) => projectMap.get(id),
    store,
    lock: opts.lock ?? inProcessLock(),
    appendStatusEventOverride: (args) =>
      (appendOverride ?? appendStatusEvent)(args),
    now: () => "2026-05-14T20:00:00Z",
  };
  const app = createTriageRoutes(deps);
  const cleanup = () => rmSync(workDir, { recursive: true, force: true });
  return {
    workDir,
    projectAPath,
    projectBPath,
    triagePathA,
    triagePathB,
    store,
    app,
    cleanup,
    setOverride: (fn) => {
      appendOverride = fn;
    },
  };
}

function makeAppendLine(id: string, status = "triage"): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-05-13T08:01:00Z",
    originalTs: "2026-05-13T08:01:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: `Triage item ${id}`,
    detail: `Detail for ${id}`,
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `phaseQuality:${id}`,
    status,
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

function seedTriage(triagePath: string, ids: string[]): void {
  const lines = [
    `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
    ...ids.map((id) => makeAppendLine(id)),
  ];
  writeFileSync(triagePath, lines.join("\n") + "\n");
}

describe("triage routes: GET /api/triage/:projectId", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(() => h.cleanup());

  it("returns empty items array when triage.jsonl is missing", async () => {
    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  it("returns items when triage.jsonl exists", async () => {
    seedTriage(h.triagePathA, ["trg-aaaa1111", "trg-bbbb2222"]);
    const res = await h.app.request("/api/triage/proj-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: any) => i.id)).toEqual([
      "trg-aaaa1111",
      "trg-bbbb2222",
    ]);
  });

  it("returns 404 for unknown project", async () => {
    const res = await h.app.request("/api/triage/proj-doesnotexist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("project_not_found");
  });
});

describe("triage routes: GET /api/triage/counts", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(() => h.cleanup());

  it("aggregates counts across projects + total", async () => {
    seedTriage(h.triagePathA, ["trg-aaaa1111", "trg-bbbb2222"]);
    seedTriage(h.triagePathB, ["trg-cccc3333"]);
    const res = await h.app.request("/api/triage/counts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ "proj-a": 2, "proj-b": 1 });
    expect(body.total).toBe(3);
  });

  it("isolates per-project read failures (Promise.allSettled, not .all)", async () => {
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
    // proj-b: write garbage so the parser yields 0 valid items
    writeFileSync(h.triagePathB, "this is not json");
    const res = await h.app.request("/api/triage/counts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts["proj-a"]).toBe(1);
    expect(body.counts["proj-b"]).toBe(0);
    expect(body.total).toBe(1);
  });
});

describe("triage routes: POST /api/triage/:projectId/promote", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
    seedTriage(h.triagePathA, ["trg-aaaa1111", "trg-bbbb2222"]);
  });
  afterEach(() => h.cleanup());

  async function promote(body: object | string) {
    return h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("happy path: creates ExternalTask + flips status; auto-merges default tags", async () => {
    const res = await promote({
      triageId: "trg-aaaa1111",
      priority: "P0",
      domain: "engineering",
      complexityHint: "medium",
      tags: ["auth", "billing"],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.recovered).toBe(false);
    expect(body.task.taskId).toBeTruthy();
    expect(body.task.promotedFromTriageId).toBe("trg-aaaa1111");
    expect(body.newStatus).toBe("promoted");
    // Verify the task was minted with default + user tags
    const created = h.store.get(body.task.taskId);
    expect(created?.tags).toEqual([
      "source:phaseQuality",
      "severity:high",
      "triage:trg-aaaa1111",
      "auth",
      "billing",
    ]);
    expect(created?.priority).toBe("P0");
    expect(created?.domain).toBe("engineering");
    expect(created?.complexityHint).toBe("medium");
    // Verify the triage status flipped
    _clearCache_TEST_ONLY();
    const list = await h.app.request("/api/triage/proj-a");
    const items = (await list.json()).items;
    const aaaa = items.find((i: any) => i.id === "trg-aaaa1111");
    expect(aaaa.status).toBe("promoted");
    expect(aaaa.promotedTaskId).toBe(`EXT:${body.task.taskId}`);
  });

  it("carries the triage item's detail as the promoted task description", async () => {
    const res = await promote({
      triageId: "trg-aaaa1111",
      priority: "P1",
      domain: "engineering",
      tags: [],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const created = h.store.get(body.task.taskId);
    // makeAppendLine seeds detail = `Detail for ${id}` — the promote route
    // must carry it into the task's description ("brief"), not drop it.
    expect(created?.description).toBe("Detail for trg-aaaa1111");
  });

  it("assigns the new-iterate actionId so launch injects the brief", async () => {
    // Without an actionId the launch route falls to the legacy path and
    // never injects the description into the run — the actionId is what
    // routes the launch through the substitution branch.
    const res = await promote({
      triageId: "trg-aaaa1111",
      priority: "P1",
      domain: "engineering",
      tags: [],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const created = h.store.get(body.task.taskId);
    expect(created?.actionId).toBe("new-iterate");
  });

  it("trims + length-caps an over-long triage detail before persisting it as description", async () => {
    // Seed an item whose detail (after trimming surrounding whitespace)
    // exceeds the 20 000-char description cap.
    const hugeDetail = "   " + "x".repeat(25_000) + "   ";
    writeFileSync(
      h.triagePathA,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        JSON.stringify({
          event: "append",
          id: "trg-cccc3333",
          ts: "2026-05-13T08:01:00Z",
          originalTs: "2026-05-13T08:01:00Z",
          source: "phaseQuality",
          severity: "high",
          kind: "bug",
          title: "Huge-detail item",
          detail: hugeDetail,
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: "phaseQuality:trg-cccc3333",
          status: "triage",
          suggestedPriority: "P1",
          suggestedDomain: "engineering",
        }),
      ].join("\n") + "\n",
    );
    _clearCache_TEST_ONLY();
    const res = await promote({
      triageId: "trg-cccc3333",
      priority: "P1",
      domain: "engineering",
      tags: [],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const created = h.store.get(body.task.taskId);
    expect(created?.description).toHaveLength(20_000);
    // Leading whitespace trimmed → first char is content, not a space.
    expect(created?.description?.startsWith("x")).toBe(true);
  });

  it("omits description when the triage detail is whitespace-only", async () => {
    writeFileSync(
      h.triagePathA,
      [
        `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
        JSON.stringify({
          event: "append",
          id: "trg-dddd4444",
          ts: "2026-05-13T08:01:00Z",
          originalTs: "2026-05-13T08:01:00Z",
          source: "phaseQuality",
          severity: "high",
          kind: "bug",
          title: "Blank-detail item",
          detail: "   ",
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: "phaseQuality:trg-dddd4444",
          status: "triage",
          suggestedPriority: "P1",
          suggestedDomain: "engineering",
        }),
      ].join("\n") + "\n",
    );
    _clearCache_TEST_ONLY();
    const res = await promote({
      triageId: "trg-dddd4444",
      priority: "P1",
      domain: "engineering",
      tags: [],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const created = h.store.get(body.task.taskId);
    expect(created?.description).toBeUndefined();
  });

  it("idempotent retry: second call reuses existing task, returns recovered=true", async () => {
    const r1 = await promote({
      triageId: "trg-aaaa1111",
      priority: "P0",
      domain: "engineering",
      tags: [],
    });
    expect(r1.status).toBe(201);
    const b1 = await r1.json();
    const r2 = await promote({
      triageId: "trg-aaaa1111",
      priority: "P0",
      domain: "engineering",
      tags: [],
    });
    expect(r2.status).toBe(201);
    const b2 = await r2.json();
    expect(b2.task.taskId).toBe(b1.task.taskId);
    expect(b2.recovered).toBe(true);
    // Only ONE task in the store
    const tasksWithBackref = h.store
      .list()
      .filter((t) => t.promotedFromTriageId === "trg-aaaa1111");
    expect(tasksWithBackref).toHaveLength(1);
  });

  it("409 when item already promoted by another actor (no back-ref task)", async () => {
    // Pre-flip the status via direct file write (simulates Python triage_promote.py)
    writeFileSync(
      h.triagePathA,
      readFileSync(h.triagePathA, "utf-8") +
        JSON.stringify({
          event: "status",
          id: "trg-aaaa1111",
          ts: "2026-05-13T11:00:00Z",
          newStatus: "promoted",
          by: "manualPromote",
          reason: "manualPromote",
          promotedTaskId: "EXT:foreign-task-id",
        }) +
        "\n",
    );
    _clearCache_TEST_ONLY();
    const res = await promote({
      triageId: "trg-aaaa1111",
      priority: "P0",
      domain: "engineering",
      tags: [],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("triage_item_not_in_triage_state");
    expect(body.actualStatus).toBe("promoted");
  });

  it("404 when triageId not present in JSONL", async () => {
    const res = await promote({
      triageId: "trg-deadbeef",
      priority: "P0",
      domain: "engineering",
      tags: [],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("triage_item_not_found");
  });

  it("400 on invalid body shapes", async () => {
    const cases: Array<[object, string]> = [
      [{ priority: "P0", domain: "x", tags: [] }, "invalid_triageId"],
      [{ triageId: "not-a-trg-id", priority: "P0", domain: "x", tags: [] }, "invalid_triageId"],
      [
        { triageId: "trg-aaaa1111", priority: "BAD", domain: "x", tags: [] },
        "invalid_priority",
      ],
      [
        { triageId: "trg-aaaa1111", priority: "P0", domain: "   ", tags: [] },
        "domain_empty",
      ],
      [
        { triageId: "trg-aaaa1111", priority: "P0", domain: "x", tags: "not-array" },
        "invalid_tags",
      ],
      [
        {
          triageId: "trg-aaaa1111",
          priority: "P0",
          domain: "x",
          tags: ["good", "bad\nwith newline"],
        },
        "tag_control_char",
      ],
      [
        {
          triageId: "trg-aaaa1111",
          priority: "P0",
          domain: "x",
          complexityHint: "huge",
          tags: [],
        },
        "invalid_complexityHint",
      ],
    ];
    for (const [body, expectedError] of cases) {
      const res = await promote(body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(expectedError);
    }
  });

  it("400 on invalid JSON body", async () => {
    const res = await promote("{not json");
    expect(res.status).toBe(400);
  });

  it("207 partial-promote when status flip throws ENOENT mid-write; retry succeeds with same taskId", async () => {
    // Inject a one-shot ENOENT failure into appendStatusEvent
    let callCount = 0;
    h.setOverride((args) => {
      callCount += 1;
      if (callCount === 1) {
        throw new TriageWriteError(
          "triage_file_disappeared",
          "synthetic ENOENT for test",
        );
      }
      // Second call: delegate to real implementation
      appendStatusEvent(args);
    });
    const r1 = await promote({
      triageId: "trg-aaaa1111",
      priority: "P0",
      domain: "engineering",
      tags: [],
    });
    expect(r1.status).toBe(207);
    const b1 = await r1.json();
    expect(b1.error).toBe("promote_partial");
    expect(b1.taskId).toBeTruthy();
    expect(b1.code).toBe("triage_file_disappeared");
    const taskIdAfterPartial = b1.taskId;
    // Verify the task IS persisted with the back-ref (recovery is possible)
    expect(h.store.findByPromotedFromTriageId("trg-aaaa1111")?.taskId).toBe(
      taskIdAfterPartial,
    );
    // Retry — second call to appendStatusEvent succeeds
    const r2 = await promote({
      triageId: "trg-aaaa1111",
      priority: "P0",
      domain: "engineering",
      tags: [],
    });
    expect(r2.status).toBe(201);
    const b2 = await r2.json();
    expect(b2.recovered).toBe(true);
    expect(b2.task.taskId).toBe(taskIdAfterPartial); // same task, no orphan
  });

  it("concurrent same-id promote: 1 task minted, both responses share taskId, exactly one is recovered", async () => {
    const [r1, r2] = await Promise.all([
      promote({
        triageId: "trg-bbbb2222",
        priority: "P1",
        domain: "engineering",
        tags: [],
      }),
      promote({
        triageId: "trg-bbbb2222",
        priority: "P1",
        domain: "engineering",
        tags: [],
      }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.task.taskId).toBe(b2.task.taskId); // both responses share taskId
    // Exactly one is `recovered: true` (the second to enter the
    // sessions-lock critical section); the other is `recovered: false`.
    const recoveredFlags = [b1.recovered, b2.recovered].sort();
    expect(recoveredFlags).toEqual([false, true]);
    const taskIds = [...h.store.list()]
      .filter((t) => t.promotedFromTriageId === "trg-bbbb2222")
      .map((t) => t.taskId);
    expect(taskIds).toHaveLength(1);
  });
});

describe("triage routes: dismiss + snooze", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
  });
  afterEach(() => h.cleanup());

  it("dismiss flips status to dismissed", async () => {
    const res = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        reason: "out of scope",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ triageId: "trg-aaaa1111", newStatus: "dismissed" });

    _clearCache_TEST_ONLY();
    const list = await h.app.request("/api/triage/proj-a");
    const items = (await list.json()).items;
    const item = items.find((i: any) => i.id === "trg-aaaa1111");
    expect(item.status).toBe("dismissed");
    expect(item.statusReason).toBe("out of scope");
  });

  it("snooze flips status to snoozed", async () => {
    const res = await h.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        reason: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newStatus).toBe("snoozed");
  });

  it("dismiss blocks when a back-ref task already exists (orphan-promote guard)", async () => {
    // Create the back-ref task directly to simulate a partial promote
    h.store.create({
      title: "Existing promoted",
      cwd: h.projectAPath,
      projectId: "proj-a",
      promotedFromTriageId: "trg-aaaa1111",
    });
    const res = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("promote_in_progress");
    expect(body.taskId).toBeTruthy();
  });

  it("dismiss returns 404 when triageId not present", async () => {
    const res = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-deadbeef" }),
    });
    expect(res.status).toBe(404);
  });

  it("dismiss 400 on invalid body", async () => {
    const res = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("triage routes: lock-failure handling (ADR-106)", () => {
  let h: Harness;

  afterEach(() => h?.cleanup());

  /** A lock dep that always rejects with proper-lockfile's `ELOCKED`. */
  function elockedLock(): TriageRoutesDeps["lock"] {
    return async () => {
      throw Object.assign(new Error("Lock file is already being held"), {
        code: "ELOCKED",
      });
    };
  }

  /** A lock dep that rejects with a non-contention filesystem error. */
  function eaccesLock(): TriageRoutesDeps["lock"] {
    return async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    };
  }

  it("promote → 503 lock_unavailable when the triage lock is contended (ELOCKED)", async () => {
    h = await makeHarness({ lock: elockedLock() });
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
    const res = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        priority: "P0",
        domain: "engineering",
        tags: [],
      }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("lock_unavailable");
    // The 503 body must not leak the raw error / a filesystem path.
    expect(JSON.stringify(body)).not.toContain("ELOCKED");
  });

  it("promote → 500 (not 503) when the lock throws a non-contention FS error", async () => {
    h = await makeHarness({ lock: eaccesLock() });
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
    const res = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        priority: "P0",
        domain: "engineering",
        tags: [],
      }),
    });
    expect(res.status).toBe(500);
  });

  it("dismiss → 503 lock_unavailable when the triage lock is contended", async () => {
    h = await makeHarness({ lock: elockedLock() });
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
    const res = await h.app.request("/api/triage/proj-a/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111" }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("lock_unavailable");
  });

  it("snooze → 503 lock_unavailable when the triage lock is contended", async () => {
    h = await makeHarness({ lock: elockedLock() });
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
    const res = await h.app.request("/api/triage/proj-a/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", reason: null }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("lock_unavailable");
  });

  it("promote → 404 (before locking) when triage.jsonl does not exist", async () => {
    // proj-b is never seeded — its triage.jsonl is absent.
    h = await makeHarness({ lock: elockedLock() });
    const res = await h.app.request("/api/triage/proj-b/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        priority: "P0",
        domain: "engineering",
        tags: [],
      }),
    });
    // Missing file → no items can exist → 404, and the lock is never
    // reached (so the ELOCKED lock above never fires).
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("triage_item_not_found");
  });
});
