/*
 * ref-event-log.test.ts — the event log as it exists on `origin/main`
 * (events-drop-files, issue 978): ONE `git ls-tree -r -z`, ONE
 * `git cat-file --batch`, assembled like the working tree.
 *
 * @covers FR-01.66
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCatFileBatch, readAssembledEventLogAtRef, type BlobReader } from "./ref-event-log.js";
import { _clearMergedEventsCache, findWorkCompletedFromMergedRef } from "./merged-events.js";
import type { GitRunner } from "./worktree-roots.js";

const wc = (runId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: `id-${runId}`, type: "work_completed", adr_id: runId, ts: "2026-11-01T10:00:00Z", commit: "", ...extra });

afterEach(() => _clearMergedEventsCache());

// @covers FR-01.66
describe("parseCatFileBatch", () => {
  it("frames blobs by BYTE size (multi-byte content is not torn)", () => {
    const a = Buffer.from("äöü — ✓\n", "utf-8");
    const b = Buffer.from("x", "utf-8");
    const out = Buffer.concat([
      Buffer.from(`${"a".repeat(40)} blob ${a.length}\n`), a, Buffer.from("\n"),
      Buffer.from(`${"b".repeat(40)} blob ${b.length}\n`), b, Buffer.from("\n"),
    ]);
    const blobs = parseCatFileBatch(out);
    expect(blobs.get("a".repeat(40))?.toString("utf-8")).toBe("äöü — ✓\n");
    expect(blobs.get("b".repeat(40))?.toString("utf-8")).toBe("x");
  });

  it("rejects a missing object and a truncated stream", () => {
    expect(() => parseCatFileBatch(Buffer.from(`${"a".repeat(40)} missing\n`))).toThrow();
    expect(() => parseCatFileBatch(Buffer.from(`${"a".repeat(40)} blob 10\nabc`))).toThrow();
  });
});

// @covers FR-01.66
describe("readAssembledEventLogAtRef (fake git)", () => {
  const listing = [
    `100644 blob ${"1".repeat(40)}\tshipwright_events.jsonl`,
    `100644 blob ${"2".repeat(40)}\t.shipwright/events/drops/iterate-b--0a1b2c3d--11111111.jsonl`,
    `120000 blob ${"3".repeat(40)}\t.shipwright/events/drops/link--0a1b2c3d--11111111.jsonl`,
    `100644 blob ${"4".repeat(40)}\t.shipwright/events/drops/nested/x--0a1b2c3d--11111111.jsonl`,
    `100644 blob ${"5".repeat(40)}\t.shipwright/events/archive/fold-aaaaaaaaaaaa.jsonl`,
    `100644 blob ${"6".repeat(40)}\t.shipwright/events/drops/.keep`,
  ].join("\0") + "\0";
  const contents = new Map<string, string>([
    ["1".repeat(40), `${wc("iterate-a")}\n`],
    ["2".repeat(40), `${wc("iterate-b")}\n`],
    ["5".repeat(40), `${wc("iterate-c")}\n`],
  ]);

  it("reads only the eligible blobs, in the assembler's order, with one batch call", async () => {
    const asked: string[][] = [];
    const git: GitRunner = (args) => {
      expect(args.slice(0, 3)).toEqual(["ls-tree", "-r", "-z"]);
      return listing;
    };
    const readBlobs: BlobReader = async (oids) => {
      asked.push(oids);
      return new Map(oids.map((o) => [o, Buffer.from(contents.get(o) ?? "")]));
    };
    const log = await readAssembledEventLogAtRef("/p", "origin/main", git, readBlobs);
    expect(asked).toEqual([["1".repeat(40), "5".repeat(40), "2".repeat(40)]]);
    expect(log?.files.map((f) => f.path)).toEqual([
      "shipwright_events.jsonl",
      ".shipwright/events/archive/fold-aaaaaaaaaaaa.jsonl",
      ".shipwright/events/drops/iterate-b--0a1b2c3d--11111111.jsonl",
    ]);
  });

  it("is null (unavailable) when the ref is unreadable or holds no event file", async () => {
    const throwing: GitRunner = () => {
      throw new Error("fatal: Not a valid object name origin/main");
    };
    expect(await readAssembledEventLogAtRef("/p", "origin/main", throwing)).toBeNull();
    expect(await readAssembledEventLogAtRef("/p", "origin/main", () => "")).toBeNull();
    const failingBatch: BlobReader = async () => {
      throw new Error("cat-file: timeout");
    };
    expect(await readAssembledEventLogAtRef("/p", "origin/main", () => listing, failingBatch)).toBeNull();
  });
});

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// @covers FR-01.66
describe.runIf(hasGit())("real git repository", () => {
  let repo = "";
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  // @covers FR-01.47
  it("finds a run that exists only as a drop (and an archived one) on the ref", async () => {
    repo = mkdtempSync(path.join(tmpdir(), "refev-"));
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
    g("init", "-q");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    g("config", "core.autocrlf", "false");
    mkdirSync(path.join(repo, ".shipwright/events/drops"), { recursive: true });
    mkdirSync(path.join(repo, ".shipwright/events/archive"), { recursive: true });
    writeFileSync(path.join(repo, "shipwright_events.jsonl"), `${wc("iterate-legacy")}\n`);
    writeFileSync(path.join(repo, ".shipwright/events/drops", "iterate-drop--0a1b2c3d--11111111.jsonl"),
      `${wc("iterate-drop", { summary: "Grüße — ✓ multi-byte" })}\n`);
    writeFileSync(path.join(repo, ".shipwright/events/archive", "fold-aaaaaaaaaaaa.jsonl"), `${wc("iterate-archived")}\n`);
    g("add", "-A");
    g("commit", "-q", "-m", "events");
    const git: GitRunner = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf-8" });

    const drop = await findWorkCompletedFromMergedRef(repo, "iterate-drop", { git, ref: "HEAD" });
    expect(drop.status).toBe("found");
    if (drop.status === "found") expect(drop.run.summary).toBe("Grüße — ✓ multi-byte");
    expect((await findWorkCompletedFromMergedRef(repo, "iterate-archived", { git, ref: "HEAD" })).status).toBe("found");
    expect((await findWorkCompletedFromMergedRef(repo, "iterate-legacy", { git, ref: "HEAD" })).status).toBe("found");
    expect((await findWorkCompletedFromMergedRef(repo, "iterate-nope", { git, ref: "HEAD" })).status).toBe("absent");
    _clearMergedEventsCache();
    expect((await findWorkCompletedFromMergedRef(repo, "iterate-drop", { git, ref: "no-such-ref" })).status).toBe("unavailable");
  });
});
