/*
 * triage-routes-amend.test.ts — POST /api/triage/:projectId/amend route
 * coverage, split out as its OWN file rather than appended to
 * triage.test.ts: that file is already grandfathered AT the 300-line bloat
 * baseline (current: 902), so a new route's tests get a new file per the
 * project's extraction-over-growth convention.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { createTriageRoutes, type TriageRoutesDeps } from "./triage.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";
import { appendAmendEvent } from "../core/triage-write.js";

function inMemorySdkDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
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

function inProcessLock(): TriageRoutesDeps["lock"] {
  const queues = new Map<string, Promise<void>>();
  return async (lockPath: string) => {
    const prev = queues.get(lockPath) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((res) => {
      release = res;
    });
    queues.set(lockPath, prev.then(() => next));
    await prev;
    return async () => {
      release();
    };
  };
}

interface Harness {
  triagePathA: string;
  triagePathB: string;
  app: Hono;
  cleanup: () => void;
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

function seedTriage(triagePath: string, ids: string[], status = "triage"): void {
  const lines = [
    `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
    ...ids.map((id) => makeAppendLine(id, status)),
  ];
  writeFileSync(triagePath, lines.join("\n") + "\n");
}

async function makeHarness(
  opts: { lock?: TriageRoutesDeps["lock"] } = {},
): Promise<Harness> {
  _clearCache_TEST_ONLY();
  const workDir = mkdtempSync(path.join(tmpdir(), "triage-routes-amend-"));
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

  const deps: TriageRoutesDeps = {
    getAllProjects: () => projects,
    getProjectById: (id) => projectMap.get(id),
    store,
    lock: opts.lock ?? inProcessLock(),
    appendAmendEventOverride: appendAmendEvent,
    now: () => "2026-08-08T20:00:00Z",
  };
  const app = createTriageRoutes(deps);
  const cleanup = () => rmSync(workDir, { recursive: true, force: true });
  return { triagePathA, triagePathB, app, cleanup };
}

describe("triage routes: POST /api/triage/:projectId/amend", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
  });
  afterEach(() => h.cleanup());

  it("amends title only, returns 200, and the resolved item reflects it", async () => {
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", title: "Corrected title" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ triageId: "trg-aaaa1111", amended: true });

    _clearCache_TEST_ONLY();
    const list = await h.app.request("/api/triage/proj-a");
    const items = (await list.json()).items;
    const item = items.find((i: any) => i.id === "trg-aaaa1111");
    expect(item.title).toBe("Corrected title");
    expect(item.amendedBy).toBe("webui");
    expect(item.amendedAt).toBe("2026-08-08T20:00:00Z");
  });

  it("amends multiple fields (title + detail + severity) in one call", async () => {
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        title: "New title",
        detail: "New detail",
        severity: "critical",
      }),
    });
    expect(res.status).toBe(200);

    _clearCache_TEST_ONLY();
    const list = await h.app.request("/api/triage/proj-a");
    const item = (await list.json()).items.find((i: any) => i.id === "trg-aaaa1111");
    expect(item.title).toBe("New title");
    expect(item.detail).toBe("New detail");
    expect(item.severity).toBe("critical");
    expect(item.suggestedPriority).toBe("P0"); // recomputed from severity
  });

  it("returns 400 amend_contentless on a body with no editable fields", async () => {
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("amend_contentless");
  });

  it("returns 400 on an invalid severity value", async () => {
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", severity: "extreme" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_amend_field");
  });

  it("returns 404 when the triageId is unknown", async () => {
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-deadbeef", title: "x" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("triage_item_not_found");
  });

  it("returns 404 when the project's triage.jsonl does not exist", async () => {
    // proj-b is never seeded.
    const res = await h.app.request("/api/triage/proj-b/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", title: "x" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("triage_item_not_found");
  });

  it("returns 409 when the item's status is not `triage` (dismissed/promoted/parked)", async () => {
    seedTriage(h.triagePathA, ["trg-bbbb2222"], "triage");
    // Flip it to dismissed via a status event appended after the seed.
    writeFileSync(
      h.triagePathA,
      `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}\n${makeAppendLine("trg-bbbb2222")}\n${JSON.stringify(
        {
          event: "status",
          id: "trg-bbbb2222",
          ts: "2026-05-14T09:00:00Z",
          newStatus: "dismissed",
          by: "webui",
          reason: null,
          promotedTaskId: null,
        },
      )}\n`,
    );
    _clearCache_TEST_ONLY();
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-bbbb2222", title: "x" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("triage_item_not_in_triage_state");
    expect(body.actualStatus).toBe("dismissed");
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("returns 404 for an unknown projectId", async () => {
    const res = await h.app.request("/api/triage/proj-missing/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", title: "x" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("project_not_found");
  });
});

describe("triage routes: POST /api/triage/:projectId/amend — lock contention", () => {
  it("returns 503 lock_unavailable when the triage lock is contended (ELOCKED)", async () => {
    const h = await makeHarness({
      lock: async () => {
        throw Object.assign(new Error("Lock file is already being held"), {
          code: "ELOCKED",
        });
      },
    });
    seedTriage(h.triagePathA, ["trg-aaaa1111"]);
    const res = await h.app.request("/api/triage/proj-a/amend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triageId: "trg-aaaa1111", title: "x" }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("lock_unavailable");
    h.cleanup();
  });
});
