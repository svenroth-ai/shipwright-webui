/*
 * event-log-files.race.test.ts — a release fold racing a read (events-drop-files,
 * issue 978): the fold writes its archive file, then deletes the drops. A drop
 * that vanishes between listing and reading must trigger a fresh LISTING (a retry
 * of the old path would find nothing), so the event is read from the archive and
 * never lost; the vanished file keeps an `unreadable` row.
 *
 * @covers FR-01.47
 */

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const hook: { onRead: ((absolute: string) => void) | null; failList: string | null } = { onRead: null, failList: null };

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readdirSync = ((p: Parameters<typeof actual.readdirSync>[0], o?: unknown) => {
    if (hook.failList && String(p).endsWith(hook.failList)) {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    }
    return (actual.readdirSync as (a: unknown, b?: unknown) => unknown)(p, o);
  }) as typeof actual.readdirSync;
  return { ...actual, default: { ...actual, readdirSync }, readdirSync };
});

vi.mock("./mission-context/fs-read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mission-context/fs-read.js")>();
  return {
    ...actual,
    readBoundedFile: (absolute: string, max: number) => {
      hook.onRead?.(absolute);
      return actual.readBoundedFile(absolute, max);
    },
  };
});

const { readAssembledEventLog } = await import("./event-log-files.js");
const { _clearEventIndexCache, findWorkCompleted } = await import("./mission-context/iterate-record.js");

let root = "";
afterEach(() => {
  hook.onRead = null;
  hook.failList = null;
  _clearEventIndexCache();
  if (root) rmSync(root, { recursive: true, force: true });
});

// @covers FR-01.47
describe("fold racing a read", () => {
  it("re-lists after a drop vanished and finds its event in the new archive file", () => {
    root = mkdtempSync(path.join(tmpdir(), "evrace-"));
    const drops = path.join(root, "shipwright_events.d");
    const archive = path.join(root, "shipwright_events.archive");
    mkdirSync(drops, { recursive: true });
    mkdirSync(archive, { recursive: true });
    const drop = path.join(drops, "iterate-x--0a1b2c3d--11111111.jsonl");
    writeFileSync(drop, `${JSON.stringify({ id: "e1", type: "work_completed", adr_id: "iterate-x", ts: "2026-10-01T00:00:00Z" })}\n`);
    let folded = false;
    hook.onRead = (absolute) => {
      if (!folded && absolute === drop) {
        folded = true; // the fold lands between our listing and our read of the drop
        renameSync(drop, path.join(archive, "fold-aaaaaaaaaaaa.jsonl"));
      }
    };
    const log = readAssembledEventLog(root)!;
    expect(log.lines.map((l) => JSON.parse(l).id)).toEqual(["e1"]);
    expect(log.files.map((f) => [f.path, f.status])).toEqual([
      ["shipwright_events.archive/fold-aaaaaaaaaaaa.jsonl", "ok"],
      ["shipwright_events.d/iterate-x--0a1b2c3d--11111111.jsonl", "unreadable"],
    ]);
    expect(log.files[1]?.key).toBe("iterate-x"); // its run's absence gate still fails closed
  });
});

// @covers FR-01.47
describe("a folder that exists but cannot be listed", () => {
  it("is an unreadable row, never 'no files' — every run's absence verdict is blocked", () => {
    root = mkdtempSync(path.join(tmpdir(), "evrace-"));
    mkdirSync(path.join(root, "shipwright_events.d"), { recursive: true });
    writeFileSync(path.join(root, "shipwright_events.jsonl"), "");
    hook.failList = "shipwright_events.d";
    const log = readAssembledEventLog(root)!;
    expect(log.absent).toBe(false);
    expect(log.files.find((f) => f.path === "shipwright_events.d")).toMatchObject({ kind: "drop", key: null, status: "unreadable" });
    expect(findWorkCompleted(root, "iterate-2026-11-05-x").status).toBe("unavailable");
  });
});
