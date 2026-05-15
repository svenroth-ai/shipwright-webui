/*
 * triage.real-lock.test.ts — surface=api integration test for
 * iterate-20260515-triage-promote-500 (ADR-104).
 *
 * The mock-lock unit tests (triage.test.ts) prove the ROUTE LOGIC —
 * status codes, validation, idempotency — but an in-process mutex
 * CANNOT reproduce the actual bug:
 *   RC1 — proper-lockfile's default `<file>.lock` path collides with the
 *         Python `_FileLock` REGULAR-FILE sidecar at the same path
 *         (mkdir EEXIST → ELOCKED → 500 on every triage write);
 *   RC2 — the promote route taking a second proper-lockfile lock on
 *         sdk-sessions.json that `store.persist()` then re-acquires —
 *         non-reentrant self-deadlock.
 *
 * This file drives the real Hono triage route with the PRODUCTION lock
 * (`createTriageLock` → `.weblock`) and a REAL `SdkSessionsStore` whose
 * persist lock is real `proper-lockfile`, against a temp project that
 * carries a regular-file `triage.jsonl.lock` sidecar (the Python
 * `_FileLock` artifact).
 *
 * Spec: .shipwright/planning/iterate/2026-05-15-triage-promote-500.md
 *   AC1 — POST /promote → 201 with the Python sidecar present (RC1)
 *   AC2 — the full transaction completes (create + persist + status
 *         flip), no self-deadlock with the real proper-lockfile store (RC2)
 *   AC3 — POST /dismiss + /snooze → 200 with the sidecar present
 *   AC4 — a genuinely-held lock yields 503, never 500 (RC3)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  utimesSync,
} from "node:fs";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import * as lockfile from "proper-lockfile";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { createTriageRoutes } from "./triage.js";
import { createTriageLock } from "../core/triage-lock.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";

/**
 * Real-fs store deps — the persist lock is genuine `proper-lockfile`.
 * `retries: 0` → deterministic fast-fail when the persist-lock-contention
 * test holds `sdk-sessions.json.lock` (no 7 s backoff wait); happy-path
 * tests have no contender so 0 retries still acquires immediately.
 */
function realStoreDeps(): SdkSessionsStoreDeps {
  return {
    readFile: (p, e) => fsReadFile(p, e as BufferEncoding),
    writeFile: (p, d) => fsWriteFile(p, d),
    existsSync: (p) => existsSync(p),
    mkdirSync: (p, o) => mkdirSync(p, o),
    lock: (p) => lockfile.lock(p, { retries: 0 }),
    ensureFile: (p) => {
      if (!existsSync(p)) writeFileSync(p, "");
    },
  };
}

function makeAppendLine(id: string): string {
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
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
  });
}

/**
 * Seed a real triage.jsonl AND the Python `_FileLock` artifact: a 0-byte
 * REGULAR FILE at `<triage.jsonl>.lock`, backdated so proper-lockfile
 * would treat it as a stale lock-dir if it (wrongly) used that path.
 */
function seedTriageWithSidecar(triagePath: string, ids: string[]): void {
  const lines = [
    `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}`,
    ...ids.map(makeAppendLine),
  ];
  writeFileSync(triagePath, lines.join("\n") + "\n");
  const sidecar = `${triagePath}.lock`;
  writeFileSync(sidecar, "");
  const stale = new Date(Date.now() - 120_000);
  utimesSync(sidecar, stale, stale);
}

interface RealHarness {
  triagePath: string;
  sdkSessionsPath: string;
  store: SdkSessionsStore;
  app: ReturnType<typeof createTriageRoutes>;
  cleanup: () => void;
}

async function makeRealHarness(): Promise<RealHarness> {
  _clearCache_TEST_ONLY();
  const workDir = mkdtempSync(path.join(tmpdir(), "triage-real-lock-"));
  const projectPath = path.join(workDir, "project-a");
  mkdirSync(path.join(projectPath, ".shipwright"), { recursive: true });
  const triagePath = path.join(projectPath, ".shipwright", "triage.jsonl");

  const registryDir = path.join(workDir, "registry");
  mkdirSync(registryDir, { recursive: true });
  const sdkSessionsPath = path.join(registryDir, "sdk-sessions.json");

  const store = new SdkSessionsStore(sdkSessionsPath, realStoreDeps());
  await store.load();

  const projects = [{ id: "proj-a", path: projectPath }];
  const app = createTriageRoutes({
    getAllProjects: () => projects,
    getProjectById: (id) => projects.find((p) => p.id === id),
    store,
    // Production lock factory; retries:0 → deterministic fast-fail in
    // the held-lock test (no 7 s proper-lockfile backoff wait).
    lock: createTriageLock(0),
    now: () => "2026-05-15T20:00:00Z",
  });

  return {
    triagePath,
    sdkSessionsPath,
    store,
    app,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

const POST = { method: "POST", headers: { "content-type": "application/json" } };

describe("triage routes — real proper-lockfile integration (ADR-104)", () => {
  const harnesses: RealHarness[] = [];
  afterEach(() => {
    for (const h of harnesses.splice(0)) h.cleanup();
  });

  it("AC1/AC2 — POST /promote → 201 with the Python sidecar present; full transaction completes", async () => {
    const h = await makeRealHarness();
    harnesses.push(h);
    seedTriageWithSidecar(h.triagePath, ["trg-aaaa1111"]);

    const res = await h.app.request("/api/triage/proj-a/promote", {
      ...POST,
      body: JSON.stringify({
        triageId: "trg-aaaa1111",
        priority: "P1",
        domain: "engineering",
        tags: [],
      }),
    });

    // RC1 — the `.lock` regular-file sidecar no longer blocks the webui
    // write (`.weblock` is a disjoint path).
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.newStatus).toBe("promoted");
    const taskId: string = body.task.taskId;

    // RC2 — create + persist completed without a self-deadlock: the task
    // is in the store AND was written to sdk-sessions.json on disk by the
    // store's own (real proper-lockfile) persist.
    expect(h.store.get(taskId)?.promotedFromTriageId).toBe("trg-aaaa1111");
    const persisted = JSON.parse(readFileSync(h.sdkSessionsPath, "utf-8"));
    expect(persisted.sessions[taskId]).toBeTruthy();

    // Step 7 — the status flip landed in triage.jsonl as a `status` event.
    const triageRaw = readFileSync(h.triagePath, "utf-8");
    expect(triageRaw).toContain('"event":"status"');
    expect(triageRaw).toContain('"newStatus":"promoted"');
  });

  it("AC3 — POST /dismiss and /snooze → 200 with the Python sidecar present", async () => {
    const h = await makeRealHarness();
    harnesses.push(h);
    seedTriageWithSidecar(h.triagePath, ["trg-cccc3333", "trg-dddd4444"]);

    const dismiss = await h.app.request("/api/triage/proj-a/dismiss", {
      ...POST,
      body: JSON.stringify({ triageId: "trg-cccc3333" }),
    });
    expect(dismiss.status).toBe(200);

    const snooze = await h.app.request("/api/triage/proj-a/snooze", {
      ...POST,
      body: JSON.stringify({ triageId: "trg-dddd4444", reason: null }),
    });
    expect(snooze.status).toBe(200);
  });

  it("AC4 — a genuinely-held `.weblock` yields 503 lock_unavailable, never 500", async () => {
    const h = await makeRealHarness();
    harnesses.push(h);
    seedTriageWithSidecar(h.triagePath, ["trg-eeee5555"]);

    // Hold the webui lock on the triage path — exactly what a second
    // webui tab mid-write holds.
    const release = await createTriageLock(0)(h.triagePath);
    try {
      const res = await h.app.request("/api/triage/proj-a/promote", {
        ...POST,
        body: JSON.stringify({
          triageId: "trg-eeee5555",
          priority: "P1",
          domain: "engineering",
          tags: [],
        }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("lock_unavailable");
      // No raw error / filesystem path leak in the 503 body.
      expect(JSON.stringify(body)).not.toContain("ELOCKED");
      expect(JSON.stringify(body)).not.toContain(".weblock");
    } finally {
      await release();
    }
  });

  it("AC4 — a held `sdk-sessions.json` persist lock also yields 503 (not 500)", async () => {
    // The OTHER AC4 branch: contention on the store's own persist lock.
    // RC2 removed the route-held sdk-sessions lock, but `store.persist()`
    // still locks `sdk-sessions.json` internally — an `ELOCKED` there
    // must surface as 503, not bubble to a 500.
    const h = await makeRealHarness();
    harnesses.push(h);
    seedTriageWithSidecar(h.triagePath, ["trg-ffff6666"]);

    // The store locks `sdk-sessions.json` (default `.lock` path) on
    // persist; proper-lockfile lstat's the target, so it must exist.
    writeFileSync(h.sdkSessionsPath, '{"schemaVersion":3,"sessions":{}}');
    const releaseSessions = await lockfile.lock(h.sdkSessionsPath, {
      retries: 0,
    });
    try {
      const res = await h.app.request("/api/triage/proj-a/promote", {
        ...POST,
        body: JSON.stringify({
          triageId: "trg-ffff6666",
          priority: "P1",
          domain: "engineering",
          tags: [],
        }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("lock_unavailable");
    } finally {
      await releaseSessions();
    }
  });

  it("AC6 — idempotent retry: a second /promote of the same item → 201 recovered (real locks)", async () => {
    const h = await makeRealHarness();
    harnesses.push(h);
    seedTriageWithSidecar(h.triagePath, ["trg-77778888"]);
    const body = JSON.stringify({
      triageId: "trg-77778888",
      priority: "P2",
      domain: "engineering",
      tags: [],
    });

    const first = await h.app.request("/api/triage/proj-a/promote", {
      ...POST,
      body,
    });
    expect(first.status).toBe(201);
    const firstTaskId: string = (await first.json()).task.taskId;

    // Retry the identical promote. The triage item is now status=promoted;
    // the route must recover via the `promotedFromTriageId` back-ref —
    // 201 recovered, the SAME task, no duplicate ExternalTask.
    const second = await h.app.request("/api/triage/proj-a/promote", {
      ...POST,
      body,
    });
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.recovered).toBe(true);
    expect(secondBody.task.taskId).toBe(firstTaskId);
    // Exactly one task carries the back-ref — no duplicate minted.
    const promoted = h.store
      .list()
      .filter((t) => t.promotedFromTriageId === "trg-77778888");
    expect(promoted).toHaveLength(1);
  });
});
