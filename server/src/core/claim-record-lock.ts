/*
 * claim-record-lock.ts — FR-04.28 claim-record lock fixings, applied
 * EXPLICITLY at both of this repo's shared-file lock sites so agreement
 * with leadwright survives a `proper-lockfile` upstream default change.
 *
 * leadwright writes two files this repo also writes: `sdk-sessions.json`
 * (this module's consumer, via `index.ts`'s `lockPath`) and
 * `decisions-proposed.md` (`external/org/decisions-lock.ts`). Both call
 * sites import the SAME constant below rather than retyping numbers, so
 * they cannot drift from each other even if one is edited without the
 * other. `index.ts`'s `lockPath` local is also reused for two files
 * leadwright does NOT touch — `projects.json` and `settings.json` — so a
 * future `contractVersion` bump changing `staleMs`/`realpath` widens to
 * those too, not just `sdk-sessions.json`; harmless today only because the
 * contract's values equal `proper-lockfile`'s own defaults (code-review
 * finding).
 *
 * `core/triage-lock.ts` and `external/org/beat-register-release-core.ts`
 * are two OTHER `proper-lockfile` call sites nearby that are deliberately
 * NOT wired to this module (doubt-review finding) — do not migrate them
 * for "consistency": `triage-lock.ts` sets `lockfilePath` on purpose (to
 * dodge a Python-owned sidecar lock), which `claimRecordLockOptions` would
 * silently strip; `beat-register-release-core.ts` hand-mirrors a
 * DIFFERENT leadwright contract (`lib/file-locks.ts`) with its own
 * deliberately much longer `stale: 300_000`, and folding it into this
 * module would silently shrink that window 30x.
 *
 * The contract itself is vendored, byte-for-byte, at
 * `../vendor/leadwright/claim-record-lock-contract.json` — a copy of
 * leadwright's `schemas/claim-record-lock-contract.json` (generated there
 * from `lib/claim-contract.ts`'s `CLAIM_RECORD_LOCK_CONTRACT`, leadwright
 * PR #55, commit 3d24a46). This repo has no build-time or runtime
 * dependency on the leadwright checkout — the vendored copy is the whole
 * of the coupling, and it is deliberately weak: nothing here fails loud
 * when leadwright bumps `contractVersion`. `claim-record-lock.test.ts`
 * pins today's `contractVersion` (1) against the vendored file, so a
 * future re-copy that changes the value fails that pin until a human
 * reviews the bump and updates it deliberately — the same ratchet shape
 * this repo already uses for the Semgrep suppression set (CLAUDE.md rule
 * 31). Short of that: re-copying the file is a human's job, on being told
 * (by leadwright's own changelog, an ADR, or this comment) that the
 * upstream contract changed. Do not add a script or CI job that fetches
 * it live — that would be the cross-repo build dependency the iterate
 * spec for this change explicitly rules out.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as lockfile from "proper-lockfile";

interface VendoredClaimRecordLockContract {
  contractVersion: number;
  lockPathSuffix: string;
  staleMs: number;
  realpath: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const vendoredContractPath = join(
  here,
  "..",
  "vendor",
  "leadwright",
  "claim-record-lock-contract.json",
);

let vendoredContract: VendoredClaimRecordLockContract;
try {
  vendoredContract = JSON.parse(
    readFileSync(vendoredContractPath, "utf-8"),
  ) as VendoredClaimRecordLockContract;
} catch (err) {
  // Named explicitly (external review finding): a missing/malformed
  // vendored copy would otherwise surface as an opaque ENOENT/JSON-parse
  // error at whichever entry point first imports this module.
  throw new Error(
    `claim-record-lock.ts: failed to read the vendored FR-04.28 contract at ` +
      `${vendoredContractPath} — ${err instanceof Error ? err.message : String(err)}`,
    { cause: err },
  );
}

export const CLAIM_RECORD_LOCK_CONTRACT: VendoredClaimRecordLockContract = {
  contractVersion: vendoredContract.contractVersion,
  lockPathSuffix: vendoredContract.lockPathSuffix,
  staleMs: vendoredContract.staleMs,
  realpath: vendoredContract.realpath,
};

/**
 * `proper-lockfile` options carrying the contract's `stale` / `realpath`
 * fixings explicitly. Never sets `lockfilePath` — the lock marker must stay
 * `proper-lockfile`'s own `<canonical-target>${lockPathSuffix}`, which is
 * what a peer holding a different path string to the same file resolves to
 * as well (contract `lockPathDescription`). Enforced structurally: an
 * `extra.lockfilePath` is dropped rather than forwarded, so this invariant
 * does not rely on every caller remembering not to pass one.
 */
export function claimRecordLockOptions<T extends Record<string, unknown>>(
  extra: T,
): Omit<T, "lockfilePath"> & { stale: number; realpath: boolean } {
  const { lockfilePath: _dropped, ...rest } = extra as T & { lockfilePath?: unknown };
  return {
    ...rest,
    stale: CLAIM_RECORD_LOCK_CONTRACT.staleMs,
    realpath: CLAIM_RECORD_LOCK_CONTRACT.realpath,
  };
}

export interface LockRetryConfig {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  factor?: number;
}

/** Acquire a `proper-lockfile` lock on `path` under the FR-04.28 contract. */
export async function lockClaimRecordFile(
  path: string,
  retries: number | LockRetryConfig = 3,
): Promise<() => Promise<void>> {
  return lockfile.lock(path, claimRecordLockOptions({ retries }));
}
