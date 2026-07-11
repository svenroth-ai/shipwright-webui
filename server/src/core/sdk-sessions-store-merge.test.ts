/*
 * D04 (F08) — sdk-sessions persist merge-under-lock + atomicity guards.
 *
 * Run-ID: iterate-2026-07-10-store-multi-instance-clobber
 *
 * MAX-hardening independent guard set. Authored by a step SEPARATE from the
 * fixer, committed FIRST, and marked MUST-NOT-MODIFY: the fix agent may not
 * weaken these assertions.
 *
 * Defect (F08, sdk-sessions-store.ts:521-542): persist() serializes the
 * boot-time in-memory Map over the shared ~/.shipwright-webui/sdk-sessions.json
 * WITHOUT re-reading on-disk state under the proper-lockfile critical section.
 * Two documented concurrent instances (autostart prod + a PORT-override dev
 * server; parallel worktrees) share one file, so instance A's persist() erases
 * rows only instance B knows and clobbers externally-written daemon claim
 * fields (claimToken/claimedBy) — making them invisible to the 409 claim guard.
 *
 * Isolation: every store points at a fresh os.tmpdir()/mkdtemp file; the real
 * ~/.shipwright-webui is NEVER touched. Temp dirs are removed in afterEach.
 * OS-deterministic: path.join throughout, no reliance on Windows path/case
 * behavior — these run on ubuntu CI too.
 *
 * RED-first: Guard 1 (both cases) and Guard 2's union case FAIL on pre-fix
 * `main` for the DEFECT reason (foreign row + claim lost; A's memory never
 * sees the claim; another instance's rows dropped wholesale). Guard 3 FAILS
 * on pre-fix `main` because persist() writes the real file directly (no
 * tmp+rename) so a mid-write throw leaves it truncated.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as lockfile from "proper-lockfile";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
  type ExternalTask,
  type SdkSessionsFile,
} from "./sdk-sessions-store.js";

// ---------- isolated temp-dir harness (never the real ~/.shipwright-webui) ----------

const tmpDirs: string[] = [];

function makeTmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-sessions-merge-"));
  tmpDirs.push(dir);
  return path.join(dir, "sdk-sessions.json");
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Real-fs deps + real proper-lockfile — the production write path. */
function realDeps(overrides?: Partial<SdkSessionsStoreDeps>): SdkSessionsStoreDeps {
  return {
    readFile: (p, e) => fsp.readFile(p, e as BufferEncoding),
    writeFile: (p, d) => fsp.writeFile(p, d),
    existsSync: (p) => fs.existsSync(p),
    mkdirSync: (p, o) => { fs.mkdirSync(p, o); },
    ensureFile: (p) => { if (!fs.existsSync(p)) fs.writeFileSync(p, ""); },
    lock: async (p) => lockfile.lock(p, { retries: { retries: 5, minTimeout: 20 } }),
    ...overrides,
  };
}

function makeRow(taskId: string, overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId,
    sessionUuid: `uuid-${taskId}`,
    cwd: "/tmp/proj",
    pluginDirs: [],
    state: "active",
    title: `title-${taskId}`,
    projectId: "proj-1",
    createdAt: "2026-07-10T00:00:00.000Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function seed(file: string, sessions: Record<string, ExternalTask>, schemaVersion = 4): void {
  const payload: SdkSessionsFile = {
    schemaVersion: schemaVersion as SdkSessionsFile["schemaVersion"],
    sessions,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function readDisk(file: string): SdkSessionsFile {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as SdkSessionsFile;
}

// ---------- Guard 1 — independent RED merge test ----------

describe("Guard 1 (F08) — persist() merges out-of-band rows + external claim under the lock [RED on pre-fix main]", () => {
  it("A.persist() of an unrelated patch preserves a foreign row and external claim fields written out-of-band", async () => {
    const file = makeTmpFile();
    const deps = realDeps();

    // Seed the shared file with a row instance A owns/knows.
    seed(file, { "task-a": makeRow("task-a", { title: "orig-a" }) });

    const a = new SdkSessionsStore(file, deps);
    await a.load();
    expect(a.get("task-a")?.title).toBe("orig-a");

    // Out-of-band: another instance (B) added a foreign row AND the leadwright
    // daemon claimed task-a — both persisted to the SHARED file while A's cache
    // is stale (A never re-reads after boot).
    const onDisk = readDisk(file);
    onDisk.sessions["task-foreign"] = makeRow("task-foreign", { title: "from-B" });
    onDisk.sessions["task-a"].claimToken = "tok-daemon-123";
    onDisk.sessions["task-a"].claimedBy = "lead-daemon-7";
    fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));

    // A mutates its OWN row (UNRELATED patch — never touches claim fields).
    a.patch("task-a", { title: "renamed-by-a" });
    await a.persist();

    const after = readDisk(file);
    // (a) foreign row survives on disk
    expect(after.sessions["task-foreign"]).toBeDefined();
    expect(after.sessions["task-foreign"]?.title).toBe("from-B");
    // (b) externally-written claim fields survive (A did not patch them)
    expect(after.sessions["task-a"]?.claimToken).toBe("tok-daemon-123");
    expect(after.sessions["task-a"]?.claimedBy).toBe("lead-daemon-7");
    // (c) A's own mutation is present
    expect(after.sessions["task-a"]?.title).toBe("renamed-by-a");
  }, 15_000);

  it("A's in-memory view sees the out-of-band claim after persist (so the 409 task_claimed guard can fire)", async () => {
    const file = makeTmpFile();
    const deps = realDeps();

    seed(file, { "task-a": makeRow("task-a") });
    const a = new SdkSessionsStore(file, deps);
    await a.load();

    // Daemon claims task-a out-of-band while A's cache is stale.
    const onDisk = readDisk(file);
    onDisk.sessions["task-a"].claimToken = "tok-daemon-999";
    onDisk.sessions["task-a"].claimedBy = "lead-daemon-3";
    fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));

    // A persists an unrelated patch → the merge must refresh A's in-memory map.
    a.patch("task-a", { lastJsonlSeenMtimeMs: 12_345 });
    await a.persist();

    // external/launch/routes.ts:78 reads task.claimToken from THIS in-memory
    // store only; it must now observe the daemon claim.
    expect(a.get("task-a")?.claimToken).toBe("tok-daemon-999");
    expect(a.get("task-a")?.claimedBy).toBe("lead-daemon-3");
  }, 15_000);
});

// ---------- Guard 2 — interleave / no-lost-update ----------

describe("Guard 2 (F08) — interleaved persist() never loses another instance's rows", () => {
  it("preserves the UNION of rows across N alternating A/B persists [union RED on pre-fix main]", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, {}); // fresh empty shared store

    const a = new SdkSessionsStore(file, deps);
    const b = new SdkSessionsStore(file, deps);
    await a.load();
    await b.load();

    // Interleave: A and B each add DIFFERENT rows, alternating persists. Each
    // instance's cache is stale w.r.t. the other's rows.
    const a1 = a.create({ title: "a1", cwd: "/tmp", projectId: "p" });
    await a.persist();
    const b1 = b.create({ title: "b1", cwd: "/tmp", projectId: "p" });
    await b.persist();
    const a2 = a.create({ title: "a2", cwd: "/tmp", projectId: "p" });
    await a.persist();
    const b2 = b.create({ title: "b2", cwd: "/tmp", projectId: "p" });
    await b.persist();

    const final = new SdkSessionsStore(file, deps);
    await final.load();
    const ids = new Set(final.list().map((t) => t.taskId));
    expect(ids).toEqual(new Set([a1.taskId, a2.taskId, b1.taskId, b2.taskId]));
  }, 15_000);

  it("load → persist → load round-trips a single instance's data unchanged", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, {
      "task-a": makeRow("task-a", { title: "a", claimToken: "tok-x", claimedBy: "lead-1" }),
      "task-b": makeRow("task-b", { title: "b", tags: ["x", "y"], createdAt: "2026-07-11T00:00:00.000Z" }),
    });

    const a = new SdkSessionsStore(file, deps);
    await a.load();
    const byId = (list: ExternalTask[]) => Object.fromEntries(list.map((t) => [t.taskId, t]));
    const before = byId(a.list());
    await a.persist(); // no-op change

    const b = new SdkSessionsStore(file, deps);
    await b.load();
    expect(byId(b.list())).toEqual(before);
  }, 15_000);

  it("persist keeps the current schemaVersion (no spurious bump)", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { "task-a": makeRow("task-a") }, 4);

    const a = new SdkSessionsStore(file, deps);
    await a.load();
    await a.persist();
    expect(readDisk(file).schemaVersion).toBe(4);
  }, 15_000);
});

// ---------- Guard 3 — atomicity (tmp+rename; no truncated file) ----------

describe("Guard 3 (F08) — persist() is atomic: a mid-write failure never truncates the file [RED on pre-fix main]", () => {
  const TRUNCATED = '{"schemaVersion":4,"sessions":{"task-a":{"tas';

  it("leaves the file as complete old-or-new content when the underlying write throws mid-way", async () => {
    const file = makeTmpFile();

    // Seed a COMPLETE, valid file (the "old" content).
    seed(file, { "task-a": makeRow("task-a", { title: "old" }) });

    // A writeFile that simulates a crash: it writes a TRUNCATED fragment to
    // whatever path it is handed, then throws. An atomic persist (tmp write +
    // rename) targets a TEMP path, so the real file keeps its old complete
    // content; a non-atomic persist writes the real file directly and corrupts
    // it. Guard uses only the existing `writeFile` seam — the fixer must route
    // the temp write through deps.writeFile before renaming (see report).
    const crashingWrite = async (p: string, _data: string): Promise<void> => {
      fs.writeFileSync(p, TRUNCATED);
      throw Object.assign(new Error("simulated crash mid-write"), { code: "EIO" });
    };
    const deps = realDeps({ writeFile: crashingWrite, lock: undefined });

    const a = new SdkSessionsStore(file, deps);
    await a.load();
    a.patch("task-a", { title: "new" });

    await expect(a.persist()).rejects.toThrow(/simulated crash/);

    // Invariant: the real file must still be COMPLETE JSON — the old content or
    // the fully-written new content, never a truncated fragment.
    const raw = fs.readFileSync(file, "utf-8");
    let parsed: SdkSessionsFile | undefined;
    expect(() => { parsed = JSON.parse(raw) as SdkSessionsFile; }).not.toThrow();
    expect(parsed?.sessions["task-a"]).toBeDefined();
    expect(["old", "new"]).toContain(parsed?.sessions["task-a"]?.title);
    expect(raw).not.toBe(TRUNCATED);
  }, 10_000);
});
