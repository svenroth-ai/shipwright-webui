import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
  utimesSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createTriageLock } from "./triage-lock.js";

describe("createTriageLock — collision-safe triage.jsonl lock (ADR-106)", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  it("acquires when a Python _FileLock regular-file `<file>.lock` sidecar is present", async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "triage-lock-"));
    const target = path.join(workDir, "triage.jsonl");
    writeFileSync(target, '{"v":1,"schema":"triage"}\n');

    // Simulate the shipwright Python `_FileLock` sidecar: a 0-byte
    // REGULAR FILE at `<file>.lock`, backdated so proper-lockfile would
    // treat it as a stale lock if it tried to use that path.
    const sidecar = `${target}.lock`;
    writeFileSync(sidecar, "");
    const stale = new Date(Date.now() - 120_000);
    utimesSync(sidecar, stale, stale);

    const lock = createTriageLock();
    const release = await lock(target); // must NOT throw ELOCKED
    expect(typeof release).toBe("function");

    // The webui lock lives at `<file>.weblock` (a directory), disjoint
    // from the Python `<file>.lock` regular file.
    expect(existsSync(`${target}.weblock`)).toBe(true);
    expect(statSync(`${target}.weblock`).isDirectory()).toBe(true);
    expect(statSync(sidecar).isFile()).toBe(true); // Python sidecar untouched

    await release();
    expect(existsSync(`${target}.weblock`)).toBe(false); // released cleanly
    expect(existsSync(sidecar)).toBe(true); // not ours to remove
  });

  it("serializes concurrent acquisitions of the same file (webui-vs-webui exclusion holds)", async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "triage-lock-"));
    const target = path.join(workDir, "triage.jsonl");
    writeFileSync(target, "{}\n");
    // retries:0 → deterministic fast-fail on contention (no 7s wait).
    const lock = createTriageLock(0);

    const release1 = await lock(target);
    await expect(lock(target)).rejects.toMatchObject({ code: "ELOCKED" });
    await release1();

    // Once released, acquisition succeeds again.
    const release2 = await lock(target);
    await release2();
  });
});
