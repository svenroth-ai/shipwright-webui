/*
 * FR-04.22 (V5, iterate-2026-09-03-claim-holder-launch) —
 * SdkSessionsStore.refreshRowFromDisk.
 *
 * Trap #1 (the single most damaging way to get this wrong): refreshing
 * `sessions` without also refreshing `baseline` makes this instance believe
 * it OWNS the freshly-observed field and write it back to disk on the next
 * arbitrary persist(), long after a foreign writer released it.
 *
 * Trap #3: the read must not hold the lock across the caller's remaining
 * work — proper-lockfile is not reentrant, so a persist() made afterwards
 * would ELOCKED if it did.
 *
 * Same real-fs + real-lock harness as sdk-sessions-store-concurrency.test.ts
 * (D04/F08) — isolation: fresh os.tmpdir()/mkdtemp file per test, removed in
 * afterEach; the real ~/.shipwright-webui is never touched.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-sessions-refresh-"));
  tmpDirs.push(dir);
  return path.join(dir, "sdk-sessions.json");
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function realDeps(overrides?: Partial<SdkSessionsStoreDeps>): SdkSessionsStoreDeps {
  return {
    readFile: (p, e) => fsp.readFile(p, e as BufferEncoding),
    writeFile: (p, d) => fsp.writeFile(p, d),
    existsSync: (p) => fs.existsSync(p),
    mkdirSync: (p, o) => { fs.mkdirSync(p, o); },
    ensureFile: (p) => { if (!fs.existsSync(p)) fs.writeFileSync(p, ""); },
    lock: async (p) => lockfile.lock(p, { retries: { retries: 20, minTimeout: 10 } }),
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
    state: "awaiting_external_start",
    title: `title-${taskId}`,
    projectId: "proj-1",
    createdAt: "2026-09-03T00:00:00.000Z",
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

describe("SdkSessionsStore.refreshRowFromDisk", () => {
  it("picks up a claim written to disk by a foreign store instance the caller never persisted", async () => {
    const file = makeTmpFile();
    seed(file, { T: makeRow("T") });

    const webui = new SdkSessionsStore(file, realDeps());
    await webui.load();
    expect(webui.get("T")?.claimToken).toBeUndefined();

    // A separate process (leadwright) claims the task through its OWN store
    // instance and persists — `webui` above never touches disk again.
    const daemon = new SdkSessionsStore(file, realDeps());
    await daemon.load();
    daemon.patch("T", { claimToken: "tok-1", claimedBy: "lead-1", claimedAt: new Date().toISOString() });
    await daemon.persist();

    // Without refreshRowFromDisk, webui.get("T") still shows no claim — the
    // exact staleness this method exists to close.
    expect(webui.get("T")?.claimToken).toBeUndefined();

    const fresh = await webui.refreshRowFromDisk("T");
    expect(fresh?.claimToken).toBe("tok-1");
    expect(webui.get("T")?.claimToken).toBe("tok-1");
  });

  it("[trap #1] refreshes baseline too — a released claim is NOT written back on the next persist", async () => {
    const file = makeTmpFile();
    seed(file, { T: makeRow("T") });

    const webui = new SdkSessionsStore(file, realDeps());
    await webui.load();

    const daemon = new SdkSessionsStore(file, realDeps());
    await daemon.load();
    daemon.patch("T", { claimToken: "tok-1", claimedBy: "lead-1", claimedAt: new Date().toISOString() });
    await daemon.persist();

    // webui observes the claim (sessions AND baseline refreshed).
    await webui.refreshRowFromDisk("T");
    expect(webui.get("T")?.claimToken).toBe("tok-1");

    // The daemon releases the claim — reload to pick up its own write, then
    // clear the field and persist.
    await daemon.refreshRowFromDisk("T");
    daemon.patch("T", { claimToken: undefined, claimedBy: undefined, claimedAt: undefined });
    await daemon.persist();
    expect(readDisk(file).sessions.T.claimToken).toBeUndefined();

    // webui now does an UNRELATED mutation (e.g. the holder's own launch
    // stamping launchedAt) and persists. If baseline had NOT been refreshed
    // alongside sessions, webui's memory (claimToken: "tok-1") would diverge
    // from a stale baseline (claimToken: undefined) and the merge would
    // conclude webui itself ADDED the token — resurrecting the released
    // claim on disk.
    webui.patch("T", { launchedAt: "2026-09-03T01:00:00.000Z" });
    await webui.persist();

    const onDisk = readDisk(file).sessions.T;
    expect(onDisk.launchedAt).toBe("2026-09-03T01:00:00.000Z");
    expect(onDisk.claimToken).toBeUndefined(); // NOT resurrected
  });

  it("falls back to the in-memory row when the id is absent on disk (not yet persisted locally)", async () => {
    const file = makeTmpFile();
    seed(file, {});

    const webui = new SdkSessionsStore(file, realDeps());
    await webui.load();
    const born = webui.create({ title: "local-only", cwd: "/tmp", projectId: "p" });

    const fresh = await webui.refreshRowFromDisk(born.taskId);
    expect(fresh?.taskId).toBe(born.taskId);
    expect(fresh?.title).toBe("local-only");
  });

  it("[doubt-review finding] a concurrent delete() landing mid-read is not resurrected", async () => {
    const file = makeTmpFile();
    seed(file, { T: makeRow("T") });

    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });
    let readCalls = 0;
    const deps = realDeps({
      readFile: async (p, e) => {
        readCalls += 1;
        if (readCalls > 1) await gate; // gate only the refreshRowFromDisk read, not load()'s own
        return fsp.readFile(p, e as BufferEncoding);
      },
    });

    const store = new SdkSessionsStore(file, deps);
    await store.load();
    expect(store.get("T")).toBeDefined();

    const refreshPromise = store.refreshRowFromDisk("T");
    // refreshRowFromDisk is now parked inside reReadDisk's readFile await.
    // A same-process request (e.g. DELETE /tasks/T) runs its synchronous,
    // unlocked delete() right now — before the disk read resolves.
    expect(store.delete("T")).toBe(true);
    expect(store.get("T")).toBeUndefined();
    releaseGate();

    const result = await refreshPromise;
    expect(result).toBeUndefined(); // must NOT resurrect the disk row
    expect(store.get("T")).toBeUndefined(); // sessions map stays deleted

    // The delete must still win once persist() actually runs.
    await store.persist();
    expect(readDisk(file).sessions.T).toBeUndefined();
  });

  it("[AC f] does not ELOCKED when a concurrent persist() already holds the lock", async () => {
    const file = makeTmpFile();
    seed(file, { T: makeRow("T") });

    let signalReached!: () => void;
    const reached = new Promise<void>((r) => { signalReached = r; });
    let openGate!: () => void;
    const gate = new Promise<void>((r) => { openGate = r; });
    let writeCalls = 0;
    const deps = realDeps({
      writeFile: async (p, d) => {
        writeCalls += 1;
        if (writeCalls === 1) { signalReached(); await gate; }
        await fsp.writeFile(p, d);
      },
    });

    const store = new SdkSessionsStore(file, deps);
    await store.load();
    store.patch("T", { title: "mid-write" });

    const persistPromise = store.persist();
    await reached; // persist() holds the lock, parked mid-write

    const refreshPromise = store.refreshRowFromDisk("T");
    // Give refreshRowFromDisk's lock() call a moment to actually start
    // retrying against the held lock before releasing it.
    await new Promise((r) => setTimeout(r, 30));
    openGate();

    await expect(Promise.all([persistPromise, refreshPromise])).resolves.toBeDefined();
  }, 15_000);
});
