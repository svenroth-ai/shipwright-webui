/*
 * scrollback-store-sweep-grouping.test.ts — D16 (F25) regression.
 *
 * sweepExpired must treat a task's `.log` + `.log.1` as ONE group and
 * skip the WHOLE task if ANY file in the group is fresh — independent
 * of the order readdir returns the entries in.
 *
 * The pre-fix single-pass form mutated the group map in readdir order:
 * a fresh `<id>.log` visited BEFORE an expired `<id>.log.1` executed a
 * no-op delete then let the expired sibling re-add the group, so the
 * archive was wrongly unlinked while the live `.log` was still fresh.
 * These tests force both readdir orders via the store's `readdirFn`
 * test hook (mirrors the existing `renameFn` / `now` hooks — fs module
 * namespaces are not spyable under ESM), so the order-dependent defect
 * reproduces deterministically on any filesystem.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ScrollbackStore } from "./scrollback-store";

const TASK = "11111111-2222-3333-4444-555555555555";
const OTHER1 = "22222222-3333-4444-5555-666666666666";
const OTHER2 = "33333333-4444-5555-6666-777777777777";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function makeTmpDir(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), "scrollback-sweep-"));
}

describe("ScrollbackStore.sweepExpired — per-task grouping (F25/D16)", () => {
  let dir: string;
  let now: number;
  let store: ScrollbackStore;
  let readdirOrder: string[];

  beforeEach(async () => {
    dir = makeTmpDir();
    now = Date.now();
    readdirOrder = [];
    store = new ScrollbackStore(dir, {
      maxBytesPerTask: 4096,
      now: () => now,
      // Force order over the REAL on-disk listing (not a hardcoded list) so
      // the tests still exercise sweepExpired against actual directory
      // contents: entries named in readdirOrder come first in that order,
      // any un-named real entries are appended.
      readdirFn: async (d) => {
        const real = await fs.readdir(d);
        const ordered = readdirOrder.filter((n) => real.includes(n));
        const extras = real.filter((n) => !readdirOrder.includes(n));
        return [...ordered, ...extras];
      },
    });
    await store.init();
  });
  afterEach(async () => {
    await store.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeWithAge(name: string, ageMs: number): Promise<void> {
    const p = path.join(dir, name);
    await fs.writeFile(p, name);
    const t = (now - ageMs) / 1000;
    await fs.utimes(p, t, t);
  }

  it("skips the whole task when live .log is fresh + .log.1 expired (fresh-first readdir order)", async () => {
    await writeWithAge(`${TASK}.log`, 1 * HOUR_MS); // fresh
    await writeWithAge(`${TASK}.log.1`, 5 * DAY_MS); // expired
    // Force the common alphabetical order — the fresh `.log` first.
    readdirOrder = [`${TASK}.log`, `${TASK}.log.1`];

    const r = await store.sweepExpired(1, { activeTaskIds: new Set() });

    // One fresh file vetoes the entire task — nothing is deleted.
    expect(r.deleted).toBe(0);
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log`))).toBe(true);
    // PRE-FIX BUG: this expired archive was wrongly unlinked.
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log.1`))).toBe(true);
  });

  it("skips the whole task regardless of readdir order (expired .log.1 first)", async () => {
    await writeWithAge(`${TASK}.log`, 1 * HOUR_MS); // fresh
    await writeWithAge(`${TASK}.log.1`, 5 * DAY_MS); // expired
    readdirOrder = [`${TASK}.log.1`, `${TASK}.log`];

    const r = await store.sweepExpired(1, { activeTaskIds: new Set() });

    expect(r.deleted).toBe(0);
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log`))).toBe(true);
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log.1`))).toBe(true);
  });

  it("deletes a fully-expired task as ONE deletion unit (both files gone)", async () => {
    await writeWithAge(`${TASK}.log`, 5 * DAY_MS); // expired
    await writeWithAge(`${TASK}.log.1`, 6 * DAY_MS); // expired
    readdirOrder = [`${TASK}.log`, `${TASK}.log.1`];

    const r = await store.sweepExpired(1, { activeTaskIds: new Set() });

    // .log + .log.1 count as ONE unit against maxFilesPerPass.
    expect(r.deleted).toBe(1);
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log`))).toBe(false);
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log.1`))).toBe(false);
  });

  it("a fresh file vetoes its task even when other tasks fill maxFilesPerPass (pass 1 is unbounded)", async () => {
    // Plan-review HIGH (gemini): if the per-pass cap truncated the grouping
    // pass, a mixed task read after the cap would look expired and lose its
    // archive. Two fully-expired tasks + one mixed task (fresh .log + expired
    // .log.1), with the mixed task's fresh .log dead LAST in readdir order and
    // maxFilesPerPass=1. The veto must hold: the mixed task survives intact.
    await writeWithAge(`${OTHER1}.log`, 6 * DAY_MS); // expired
    await writeWithAge(`${OTHER1}.log.1`, 7 * DAY_MS); // expired
    await writeWithAge(`${OTHER2}.log`, 5 * DAY_MS); // expired
    await writeWithAge(`${OTHER2}.log.1`, 5 * DAY_MS); // expired
    await writeWithAge(`${TASK}.log.1`, 5 * DAY_MS); // expired archive
    await writeWithAge(`${TASK}.log`, 1 * HOUR_MS); // fresh live — LAST
    readdirOrder = [
      `${OTHER1}.log`,
      `${OTHER1}.log.1`,
      `${OTHER2}.log`,
      `${OTHER2}.log.1`,
      `${TASK}.log.1`,
      `${TASK}.log`,
    ];

    const r = await store.sweepExpired(1, {
      activeTaskIds: new Set(),
      maxFilesPerPass: 1,
    });

    // Cap bounds only the delete pass: one expired task deleted, one deferred.
    expect(r.deleted).toBe(1);
    expect(r.remaining).toBe(1);
    // The mixed task is fully skipped regardless of the cap or its position.
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log`))).toBe(true);
    expect(fsSync.existsSync(path.join(dir, `${TASK}.log.1`))).toBe(true);
  });
});
