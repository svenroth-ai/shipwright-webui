# External Code Review — Findings & Dispositions

Both providers returned `revise` (contradiction: none — verdicts agree).

1. **Timing-race flakiness in `claim-record-lock-symlink.test.ts`'s first
   test** (GLM medium, OpenAI low) — fixed 30ms sleep before the alias
   attempt could race on a slow/loaded runner.
   **accepted-and-fixed**: replaced the sleep with a deferred signal
   resolved the instant the real-path lock is actually held, so the alias
   attempt only starts once the first lock is confirmed acquired.

2. **Same flakiness class in the second (sanity-check) test** (GLM low) —
   15ms head start vs. an 80ms hold.
   **accepted-and-fixed**: same deferred-signal pattern; `b` (a genuinely
   different, non-contending file) now only starts once `a`'s lock is
   confirmed held, removing the arbitrary timing margin.

3. **`decisions-lock.test.ts`'s new callsite test compared against
   `CLAIM_RECORD_LOCK_CONTRACT` (the shared module's own export), which is
   circular** (GLM low, OpenAI medium) — a bug that fed the wrong file into
   the shared helper would still pass.
   **accepted-and-fixed**: the test now reads
   `src/vendor/leadwright/claim-record-lock-contract.json` independently
   from disk (same pattern as `claim-record-lock.test.ts`) and asserts
   against those parsed values.

4. **`claim-record-lock-callsites-sync.test.ts`'s index.ts check only
   proves the file mentions `lockClaimRecordFile` somewhere, not that the
   actual `lockPath` used for `sdk-sessions.json` delegates to it**
   (OpenAI medium).
   **accepted-and-fixed**: tightened the regex to pin the `lockPath`
   binding itself (`const lockPath = async (p: string) => lockClaimRecordFile(p`).

5. **`claim-record-lock.ts`'s top-level `readFileSync` throws an opaque
   error at import time if the vendored file is missing/malformed**
   (GLM low, edge-case).
   **accepted-and-fixed**: wrapped in try/catch, rethrows naming the
   resolved `vendoredContractPath`.

6. **The pin test in `claim-record-lock.test.ts` retypes `staleMs` (10000),
   `realpath` (true), and `lockPathSuffix` (".lock") as literals — OpenAI
   read this as tension with the "never retyped numbers" requirement**
   (OpenAI medium).
   **rejected-with-reason**: this test is a DELIBERATE ratchet pin, not the
   call-site fidelity check the "never retyped numbers" requirement is
   about (that requirement targets `decisions-lock.ts`/`index.ts` proving
   they reach the real contract, not a snapshot test). The dedicated
   fidelity test directly above it (`matches the vendored JSON file, read
   independently from disk`) already proves `CLAIM_RECORD_LOCK_CONTRACT`
   equals the vendored file — deriving the pin test's expected values from
   that SAME vendored file would make it tautological (comparing the file
   to itself) and remove the one property it exists to provide: catching a
   future silent re-copy that changes a value, forcing a human to update
   the pin deliberately. Retyping is required for a pin to have teeth; see
   `claim-record-lock.ts`'s header comment and this test file's own doc
   comment, which already state this rationale.

All accepted findings fixed; full server test suite re-run green
(350 files / 3926 passed, 1 file / 2 tests self-skipped on this
unprivileged Windows host, as designed) after the fixes.
