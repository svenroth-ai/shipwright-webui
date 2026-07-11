/*
 * D04 (F08) — data-integrity edge guards for the persist() 3-way merge.
 *
 * Run-ID: iterate-2026-07-10-store-multi-instance-clobber
 *
 * Independent MAX-hardening guards (author != fixer, must-not-modify). These
 * pin two data-loss bugs a data-integrity review found in the FIRST fix
 * (commit 7216ac9) plus one fence for the behavior that is already correct.
 *
 *   Guard 1 (HIGH) — cross-instance DELETE is resurrected. mergeSessions keeps
 *     an on-disk row this instance deleted whenever disk != baseline; since a
 *     concurrent instance's transcript poll rewrites the row ~1/sec, the delete
 *     is silently reverted. RED on 7216ac9.
 *   Guard 2 (MEDIUM) — an unreadable / future-schema disk drops THIS instance's
 *     own untouched rows. load() collapses corrupt-JSON AND schemaVersion >
 *     current to an empty map, so the re-read can't tell "empty" from
 *     "unreadable" and the merge drops every mem-present/disk-absent row. RED
 *     on 7216ac9.
 *   Guard 3 (fence) — same-row different-field merge keeps BOTH changes. GREEN
 *     on 7216ac9 (pins the closed behavior stays correct).
 *
 * Isolation: fresh os.tmpdir()/mkdtemp file per test; the real ~/.shipwright-webui
 * is NEVER touched; temp dirs removed in afterEach. OS-deterministic (path.join;
 * no Windows-only path/case reliance) — runs on ubuntu CI.
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

// Mirror of the module-private CURRENT_SCHEMA_VERSION in sdk-sessions-store.ts
// (not exported; no cross-package import — DO-NOT #7). Keep in sync.
const CURRENT_SCHEMA_VERSION = 4;

const tmpDirs: string[] = [];

function makeTmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-sessions-edge-"));
  tmpDirs.push(dir);
  return path.join(dir, "sdk-sessions.json");
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Real-fs deps + real proper-lockfile + rename — the production write path.
 *  The lock MUST be present so persist()'s re-read/merge branch runs. */
function realDeps(overrides?: Partial<SdkSessionsStoreDeps>): SdkSessionsStoreDeps {
  return {
    readFile: (p, e) => fsp.readFile(p, e as BufferEncoding),
    writeFile: (p, d) => fsp.writeFile(p, d),
    existsSync: (p) => fs.existsSync(p),
    mkdirSync: (p, o) => { fs.mkdirSync(p, o); },
    ensureFile: (p) => { if (!fs.existsSync(p)) fs.writeFileSync(p, ""); },
    lock: async (p) => lockfile.lock(p, { retries: { retries: 5, minTimeout: 20 } }),
    rename: (from, to) => fsp.rename(from, to),
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

/** Rewrite a single row's field on disk out-of-band (simulates another instance). */
function mutateOnDisk(file: string, taskId: string, patch: Partial<ExternalTask>): void {
  const onDisk = readDisk(file);
  onDisk.sessions[taskId] = { ...onDisk.sessions[taskId], ...patch };
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));
}

// ---------- Guard 1 (HIGH) — cross-instance delete must not resurrect ----------

describe("Guard 1 (F08) — a cross-instance delete is honored, not resurrected by a concurrent poll [RED on 7216ac9]", () => {
  it("A.delete then persist removes the row even when another instance changed it on disk", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { X: makeRow("X") });

    const a = new SdkSessionsStore(file, deps);
    await a.load();

    // Concurrent instance's transcript poll rewrote X (~1/sec) → disk != baseline.
    mutateOnDisk(file, "X", { lastJsonlSeenMtimeMs: 999_999 });

    a.delete("X");
    await a.persist();

    // Delete wins: gone on disk AND gone from A's in-memory view.
    expect(readDisk(file).sessions.X).toBeUndefined();
    expect(a.get("X")).toBeUndefined();
  }, 15_000);

  it("cascade-style multi-row delete + single persist removes every row despite concurrent changes", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { X: makeRow("X"), Y: makeRow("Y") });

    const a = new SdkSessionsStore(file, deps);
    await a.load();

    // Both rows touched out-of-band, then the project-cascade deletes both and
    // persists once (core/cascade-delete-project-tasks.ts pattern).
    mutateOnDisk(file, "X", { lastJsonlSeenMtimeMs: 111 });
    mutateOnDisk(file, "Y", { lastJsonlSeenMtimeMs: 222 });
    a.delete("X");
    a.delete("Y");
    await a.persist();

    const after = readDisk(file).sessions;
    expect(after.X).toBeUndefined();
    expect(after.Y).toBeUndefined();
    expect(a.get("X")).toBeUndefined();
    expect(a.get("Y")).toBeUndefined();
  }, 15_000);

  // Companion — pins the CORRECT case (should stay GREEN on 7216ac9): a delete
  // still propagates when disk is unchanged since baseline.
  it("delete propagates when the on-disk row is unchanged since baseline", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { X: makeRow("X") });

    const a = new SdkSessionsStore(file, deps);
    await a.load();
    a.delete("X"); // no out-of-band change → disk == baseline
    await a.persist();

    expect(readDisk(file).sessions.X).toBeUndefined();
    expect(a.get("X")).toBeUndefined();
  }, 15_000);
});

// ---------- Guard 2 (MEDIUM) — unreadable vs future-schema disk at re-read ----------
//
// Corrupt JSON has no salvageable foreign data → A's memory is authoritative,
// full-write recover (GREEN fence on f013773). A FUTURE schemaVersion DOES hold
// another (newer) instance's rows → a full-write would DOWNGRADE + destroy them,
// so persist() must ABORT and leave the newer file untouched (REVISED — RED on
// f013773, which currently downgrades).

describe("Guard 2 (F08) — re-read recovery: corrupt→full-write, future-schema→ABORT [future RED on f013773]", () => {
  it("keeps A's untouched row when the on-disk file is corrupt JSON at re-read time", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { R1: makeRow("R1"), R2: makeRow("R2") });

    const a = new SdkSessionsStore(file, deps);
    await a.load();

    // Disk goes corrupt (mid-write crash by another instance / power loss).
    fs.writeFileSync(file, "{ this is : not valid json ]");

    a.patch("R1", { title: "patched-by-a" });
    await a.persist();

    const after = readDisk(file).sessions; // must parse (not truncated/emptied)
    expect(after.R1?.title).toBe("patched-by-a");
    expect(after.R2).toBeDefined(); // A's own untouched row must survive
  }, 15_000);

  it("ABORTS (throws) and leaves the on-disk future-schema file byte-unchanged", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { R1: makeRow("R1"), R2: makeRow("R2") });

    const a = new SdkSessionsStore(file, deps);
    await a.load();

    // Another (newer) instance wrote a version this build can't parse. Full-
    // writing our v4 memory over it would DOWNGRADE the file and destroy Z, so
    // persist() must abort with a clear version-mismatch error and NOT write.
    seed(file, { Z: makeRow("Z") }, CURRENT_SCHEMA_VERSION + 1);
    const before = fs.readFileSync(file, "utf-8");

    a.patch("R1", { title: "patched-by-a" });
    await expect(a.persist()).rejects.toThrow(/version|schema/i);

    // Disk is byte-for-byte the newer instance's file — not downgraded/clobbered.
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
    const after = readDisk(file);
    expect(after.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(after.sessions.Z).toBeDefined();
    expect(after.sessions.R1).toBeUndefined(); // our rows were NOT written down
    // A's in-memory rows are intact (not dropped from memory on the abort).
    expect(a.get("R1")).toBeDefined();
    expect(a.get("R2")).toBeDefined();
  }, 15_000);
});

// ---------- Guard 3 (fence) — same-row, different-field merge stays correct ----------

describe("Guard 3 (F08) — same-row concurrent changes to DIFFERENT fields both survive [GREEN fence on 7216ac9]", () => {
  it("A's title change and the daemon's out-of-band claim on the same row both merge", async () => {
    const file = makeTmpFile();
    const deps = realDeps();
    seed(file, { X: makeRow("X", { title: "orig", lastJsonlSeenMtimeMs: 100 }) });

    const a = new SdkSessionsStore(file, deps);
    await a.load();

    // A renames X; the leadwright daemon claims X out-of-band (a field A never
    // touched).
    a.patch("X", { title: "from-a" });
    mutateOnDisk(file, "X", { claimToken: "tok-disk", claimedBy: "lead-daemon-1" });

    await a.persist();

    const x = readDisk(file).sessions.X;
    expect(x?.title).toBe("from-a"); // A's field change survives
    expect(x?.claimToken).toBe("tok-disk"); // disk's different-field change survives
    expect(x?.claimedBy).toBe("lead-daemon-1");
  }, 15_000);
});
