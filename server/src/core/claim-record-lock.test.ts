/*
 * claim-record-lock.test.ts — proves the vendored FR-04.28 contract copy is
 * what `CLAIM_RECORD_LOCK_CONTRACT` actually exposes, and that the options
 * builder derived from it never lets a caller reintroduce `lockfilePath`
 * (which would defeat the "marker derives from the canonical target path"
 * fixing — a test comparing two identical path strings would prove nothing
 * here, this instead inspects the actual options object).
 *
 * `contractVersion: 1` below is a DELIBERATE pin, not a retyped constant —
 * it is compared against the vendored file's own value, so it only ever
 * fails when the vendored copy itself changes (a human re-copied it after
 * leadwright bumped the contract) or when someone edits the pin without
 * re-copying. Either way a human must look, which is the point.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as lockfile from "proper-lockfile";

import {
  CLAIM_RECORD_LOCK_CONTRACT,
  claimRecordLockOptions,
  lockClaimRecordFile,
} from "./claim-record-lock.js";

vi.mock("proper-lockfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("proper-lockfile")>();
  return { ...actual, lock: vi.fn(actual.lock) };
});

const here = dirname(fileURLToPath(import.meta.url));
const vendoredPath = join(here, "..", "vendor", "leadwright", "claim-record-lock-contract.json");

describe("CLAIM_RECORD_LOCK_CONTRACT — vendored copy fidelity", () => {
  it("matches the vendored JSON file, read independently from disk", () => {
    const vendored = JSON.parse(readFileSync(vendoredPath, "utf-8")) as {
      contractVersion: number;
      lockPathSuffix: string;
      staleMs: number;
      realpath: boolean;
    };
    expect(CLAIM_RECORD_LOCK_CONTRACT).toEqual({
      contractVersion: vendored.contractVersion,
      lockPathSuffix: vendored.lockPathSuffix,
      staleMs: vendored.staleMs,
      realpath: vendored.realpath,
    });
  });

  // Pinned against today's vendored copy (leadwright PR #55, commit
  // 3d24a46). Bump this alongside a deliberate re-copy of the vendored
  // file — see claim-record-lock.ts's header comment.
  it("pins the vendored contractVersion so a silent re-copy is caught", () => {
    expect(CLAIM_RECORD_LOCK_CONTRACT.contractVersion).toBe(1);
    expect(CLAIM_RECORD_LOCK_CONTRACT.staleMs).toBe(10000);
    expect(CLAIM_RECORD_LOCK_CONTRACT.realpath).toBe(true);
    expect(CLAIM_RECORD_LOCK_CONTRACT.lockPathSuffix).toBe(".lock");
  });
});

describe("claimRecordLockOptions", () => {
  it("carries stale/realpath explicitly and merges caller-supplied extras", () => {
    const opts = claimRecordLockOptions({ retries: 3 });
    expect(opts).toEqual({
      retries: 3,
      stale: CLAIM_RECORD_LOCK_CONTRACT.staleMs,
      realpath: CLAIM_RECORD_LOCK_CONTRACT.realpath,
    });
  });

  it("drops a lockfilePath override rather than forwarding it — the marker must stay canonical-target-derived", () => {
    const opts = claimRecordLockOptions({ retries: 3, lockfilePath: "/tmp/should-not-win" } as {
      retries: number;
      lockfilePath: string;
    });
    expect(opts).toEqual({
      retries: 3,
      stale: CLAIM_RECORD_LOCK_CONTRACT.staleMs,
      realpath: CLAIM_RECORD_LOCK_CONTRACT.realpath,
    });
    expect(opts).not.toHaveProperty("lockfilePath");
  });
});

describe("lockClaimRecordFile", () => {
  it("acquires the lock with the contract's stale/realpath, no lockfilePath override", async () => {
    // Override the forwarding mock for this one call so no real filesystem
    // lock is attempted against a path that doesn't exist — this test is
    // about the OPTIONS `lockClaimRecordFile` passes, not about
    // proper-lockfile's own real behavior (that's two-process-lock.test.ts
    // and the *-symlink.test.ts realpath proof).
    vi.mocked(lockfile.lock).mockImplementationOnce(async () => async () => {});
    const release = await lockClaimRecordFile("/tmp/does-not-need-to-exist-for-the-mock", 3);
    expect(vi.mocked(lockfile.lock)).toHaveBeenCalledWith(
      "/tmp/does-not-need-to-exist-for-the-mock",
      {
        retries: 3,
        stale: CLAIM_RECORD_LOCK_CONTRACT.staleMs,
        realpath: CLAIM_RECORD_LOCK_CONTRACT.realpath,
      },
    );
    const calledOptions = vi.mocked(lockfile.lock).mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(calledOptions).not.toHaveProperty("lockfilePath");
    expect(typeof release).toBe("function");
  });
});
