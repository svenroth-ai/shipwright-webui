/*
 * claim-record-lock-callsites-sync.test.ts — the two files that lock a
 * target leadwright also writes (`sdk-sessions.json` via index.ts,
 * `decisions-proposed.md` via external/org/decisions-lock.ts) must source
 * the FR-04.28 `stale`/`realpath` fixings from the single shared
 * `core/claim-record-lock.ts` module, never from retyped literals — that
 * retyping is exactly how the two repos drifted before this change (see
 * `claim-record-lock.ts`'s header comment). A behavioral test proves the
 * VALUES passed to `proper-lockfile.lock` are right (`claim-record-lock.test.ts`,
 * `external/org/__tests__/decisions-lock.test.ts`); this is the companion
 * SOURCE check that the numbers cannot silently come from somewhere else
 * next time either file is edited — the same "ratchet, not a one-off"
 * shape as `create-cta-standard.test.ts` / `shell-scroll-invariant.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const indexTsPath = join(here, "..", "index.ts");
const decisionsLockPath = join(here, "..", "external", "org", "decisions-lock.ts");

describe("shared claim-record files reach for the contract, not a retyped number", () => {
  it("index.ts's sdk-sessions.json lockPath factory itself delegates to lockClaimRecordFile", () => {
    const src = readFileSync(indexTsPath, "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*\blockClaimRecordFile\b[^}]*\}\s*from\s*"\.\/core\/claim-record-lock\.js"/);
    // Tighter than "the file mentions lockClaimRecordFile somewhere"
    // (external review finding, OpenAI): this pins the `lockPath` binding
    // itself — the thing `sdkSessionsDeps.lock` / `projectManagerDeps.lock`
    // actually use — to the shared helper, so an unused import next to a
    // differently-routed `lockPath` would fail this test.
    expect(src).toMatch(/const\s+lockPath\s*=\s*async\s*\(p:\s*string\)\s*=>\s*lockClaimRecordFile\(p/);
    // The old inline `lockfile.lock(p, { retries: 3 })` shape (and any
    // hand-added `stale:`/`realpath:` literal near it) must be gone.
    expect(src).not.toMatch(/stale:\s*10[_,]?000/);
    expect(src).not.toMatch(/lockfile\.lock\(/);
  });

  it("decisions-lock.ts imports claimRecordLockOptions and does not hardcode the stale/realpath literals it used to", () => {
    const src = readFileSync(decisionsLockPath, "utf-8");
    expect(src).toMatch(
      /import\s*\{\s*claimRecordLockOptions\s*\}\s*from\s*"\.\.\/\.\.\/core\/claim-record-lock\.js"/,
    );
    expect(src).toMatch(/claimRecordLockOptions\(/);
    // The retries shape is this call site's own tuning and stays inline —
    // only stale/realpath must have moved to the shared contract.
    expect(src).not.toMatch(/stale:\s*10[_,]?000/);
    expect(src).not.toMatch(/realpath:\s*true/);
  });
});
