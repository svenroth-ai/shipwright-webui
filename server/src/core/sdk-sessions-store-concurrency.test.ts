/*
 * D04 (F08) — persist() concurrency + re-read-I/O guards.
 *
 * Run-ID: iterate-2026-07-10-store-multi-instance-clobber
 *
 * Independent MAX-hardening guards (author != fixer, must-not-modify). These
 * pin a HIGH regression + a residual the final data-integrity review found in
 * the remediation commit f013773.
 *
 *   Guard 1 (HIGH) — swap-after-write lost update. persist() computes `next`
 *     (a cloned/merged map) BEFORE `await atomicWriteFile`, then does
 *     `this.sessions = next` AFTER the write resolves. Any mutation that lands
 *     during the write-await hits the OLD live map and is discarded by the
 *     wholesale swap. RED on f013773 (concurrent patch / create / delete lost).
 *   Guard 3 (residual) — a transient re-read I/O error (EBUSY/EPERM) is caught
 *     and treated as "empty disk", so persist() full-writes A's memory and
 *     CLOBBERS a concurrent instance's rows. It must instead retry-then-REJECT,
 *     leaving the on-disk file untouched. RED on f013773.
 *
 * Seam note: both guards drive existing deps seams — `writeFile` (gated to park
 * persist mid-write) and `readFile` (made to throw a transient error at re-read
 * time). No new production seam is required.
 *
 * Isolation: fresh os.tmpdir()/mkdtemp file per test; the real ~/.shipwright-webui
 * is NEVER touched; temp dirs removed in afterEach. OS-deterministic (path.join;
 * no Windows-only path/case reliance) — runs on ubuntu CI. The real
 * proper-lockfile is used so persist()'s re-read/merge branch (release truthy)
 * actually runs — that branch is what makes `next` a distinct map.
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

const tmpDirs: string[] = [];

function makeTmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-sessions-conc-"));
  tmpDirs.push(dir);
  return path.join(dir, "sdk-sessions.json");
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Real-fs deps + real proper-lockfile + rename — the production write path. */
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

function seed(file: string, sessions: Record<string, ExternalTask>): void {
  const payload: SdkSessionsFile = { schemaVersion: 4, sessions };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function readDisk(file: string): SdkSessionsFile {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as SdkSessionsFile;
}

/**
 * Deps whose FIRST writeFile (the atomicWriteFile temp-stage) parks until the
 * test opens the gate — persist() is then suspended mid-write with `next`
 * already computed but not yet swapped into `this.sessions`.
 */
function gatedWriteDeps(): { deps: SdkSessionsStoreDeps; reached: Promise<void>; open: () => void } {
  let signalReached!: () => void;
  const reached = new Promise<void>((r) => { signalReached = r; });
  let openGate!: () => void;
  const gate = new Promise<void>((r) => { openGate = r; });
  let calls = 0;
  const deps = realDeps({
    writeFile: async (p, d) => {
      calls += 1;
      if (calls === 1) { signalReached(); await gate; }
      await fsp.writeFile(p, d);
    },
  });
  return { deps, reached, open: openGate };
}

// ---------- Guard 1 (HIGH) — swap-after-write must not discard live mutations ----------

describe("Guard 1 (F08) — a mutation during the persist write-await survives the post-write map swap [RED on f013773]", () => {
  it("a concurrent patch during the write is not discarded by the swap", async () => {
    const file = makeTmpFile();
    const { deps, reached, open } = gatedWriteDeps();
    seed(file, { X: makeRow("X"), Y: makeRow("Y", { title: "orig-y" }) });

    const store = new SdkSessionsStore(file, deps);
    await store.load();

    const p1 = store.persist();
    await reached; // parked mid-write, `next` already computed

    store.patch("Y", { title: "concurrent" });
    open();
    await p1;

    expect(store.get("Y")?.title).toBe("concurrent"); // survived in memory
    await store.persist();
    expect(readDisk(file).sessions.Y?.title).toBe("concurrent"); // and reached disk
  }, 15_000);

  it("a concurrent create during the write is not dropped by the swap", async () => {
    const file = makeTmpFile();
    const { deps, reached, open } = gatedWriteDeps();
    seed(file, { X: makeRow("X") });

    const store = new SdkSessionsStore(file, deps);
    await store.load();

    const p1 = store.persist();
    await reached;

    const born = store.create({ title: "born-mid-write", cwd: "/tmp", projectId: "p" });
    open();
    await p1;

    expect(store.get(born.taskId)).toBeDefined();
    await store.persist();
    expect(readDisk(file).sessions[born.taskId]).toBeDefined();
  }, 15_000);

  it("a concurrent delete during the write is not undone (delete-set entry not wiped)", async () => {
    const file = makeTmpFile();
    const { deps, reached, open } = gatedWriteDeps();
    seed(file, { X: makeRow("X"), Z: makeRow("Z") });

    const store = new SdkSessionsStore(file, deps);
    await store.load();

    const p1 = store.persist();
    await reached;

    store.delete("X");
    open();
    await p1;

    expect(store.get("X")).toBeUndefined(); // delete not undone
    // The deletedSinceBaseline entry must not have been wiped by the swap's
    // clear() — a subsequent persist must keep X deleted on disk.
    await store.persist();
    expect(readDisk(file).sessions.X).toBeUndefined();
  }, 15_000);
});

// ---------- Guard 3 (residual) — transient re-read I/O error must not clobber ----------

describe("Guard 3 (F08) — a transient re-read I/O error retries then rejects, never full-write-clobbering the disk [RED on f013773]", () => {
  it("leaves another instance's row on disk intact and rejects (no full-memory overwrite)", async () => {
    const file = makeTmpFile();
    let failReads = false;
    const deps = realDeps({
      readFile: async (p, e) => {
        if (failReads) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        return fsp.readFile(p, e as BufferEncoding);
      },
    });
    seed(file, { R1: makeRow("R1"), R2: makeRow("R2") });

    const a = new SdkSessionsStore(file, deps);
    await a.load(); // reads succeed here

    // A concurrent instance adds a foreign row A's memory never knew.
    const withForeign = readDisk(file);
    withForeign.sessions.F = makeRow("F", { title: "from-other-instance" });
    fs.writeFileSync(file, JSON.stringify(withForeign, null, 2));
    const before = fs.readFileSync(file, "utf-8");

    // Re-read under the lock now hits a transient error.
    failReads = true;
    a.patch("R1", { title: "patched-by-a" });

    await expect(a.persist()).rejects.toThrow(); // retry-then-reject, not silent full-write

    // Disk untouched: the foreign row F survives and A's memory was NOT flushed.
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
    expect(readDisk(file).sessions.F).toBeDefined();
    expect(readDisk(file).sessions.R1?.title).not.toBe("patched-by-a");
  }, 30_000);
});
