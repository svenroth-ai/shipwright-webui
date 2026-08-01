# Iterate Spec: win32-spawn-followups

- **Run ID:** iterate-2026-08-01-win32-spawn-followups
- **Type:** change (SIMPLIFY sub-mode — behavior-preserving)
- **Complexity:** medium
- **Status:** draft

## Goal

Close the three cleanup follow-ups that PR #340
(`iterate-2026-07-31-win32-shell-spawn-remediation`) raised in review and
**deliberately** deferred, each recorded in that spec's "Out of Scope" section.
None is a defect and none blocks anything; all three are debts that PR took on
knowingly so its "no FR-observable change" claim would stay true.

1. **Dead export.** `probeClaudeVersionAsync` in `server/src/core/cli-compat.ts`
   has no caller anywhere in the repo. Both reviewers asked for its deletion,
   noting removal would have been a smaller change than the remediation it
   received. It was kept because dropping a public export is a behaviour change
   that did not belong in that PR. **Decide deliberately: delete, or name a
   consumer.**
2. **Misnamed and mis-homed module.** `server/src/core/preview-win32-spawn.ts`
   now has three classes of consumer plus a cross-package mirror, so the
   `preview-` prefix no longer describes it. Code review's suggestion — extract
   `core/win32-spawn.ts` (the null-returning variant) and keep the preview module
   as a thin throwing wrapper — is the shape to build.
3. **Test fidelity on paths.** The win32 branch uses the **host** `path` module
   while `platform` is injected/stubbed, so on Linux CI the win32 assertions run
   with POSIX path semantics. This repo has already paid for exactly this
   mistake once: `claude-bin-resolver.ts:168-174` records **nine** red CI runs
   caused by it. Today it is compensated by real execution on Windows rather
   than by the automated suite.

## Acceptance Criteria

- [ ] **AC-1** — `probeClaudeVersionAsync` is gone: `grep -rn
      "probeClaudeVersionAsync"` over `server/ bootstrapper/ client/` returns
      zero hits, `server/src/core/cli-compat.probe-spawn-async.test.ts` is
      deleted, and `npm run typecheck` in `server/` exits 0.
- [ ] **AC-2** — `server/src/core/win32-spawn.ts` exists and exports
      `resolveSpawn(argv, cwd): ResolvedSpawn | null` (**null** for an
      unresolvable BARE name), `splitWin32Command`, and the `ResolvedSpawn`
      type. **`preview-session-manager` is not TRANSITIVELY reachable** from
      either `win32-spawn.ts` or `cli-compat.ts`: the guard walks the relative
      import graph from each entry point and fails if the preview module appears
      anywhere in the closure, so an *indirect* re-entry is caught too. The walk
      also fails loudly on an **unresolved** edge or a **non-literal**
      `import(expr)`, so it cannot go green by seeing less. **Scope, corrected
      by Stage-3 review:** this retires `cli-compat`'s **membership** of the
      `preview-win32-spawn` ↔ `preview-session-manager` cycle (PR #340's third
      deferred item) — not the cycle itself, which `server/src/index.ts` still
      links directly and which still evaluates on every boot.
- [ ] **AC-3** — `server/src/core/preview-win32-spawn.ts` is a thin wrapper: its
      `resolveSpawn(argv, cwd)` returns the core result unchanged and **throws
      `PreviewProfileInvalidError`** when the core returns `null`. The FROZEN
      guard `server/src/core/preview-win32-resolve.test.ts` is **byte-unmodified**
      (`git diff --stat` lists it nowhere) and its Guards 3-6 all pass.
- [ ] **AC-4** — `server/src/core/cli-compat.ts` imports `resolveSpawn` from
      `./win32-spawn.js`, not from `./preview-win32-spawn.js`.
- [ ] **AC-5** — The win32 branch's **pure-string** path decisions use
      `path.win32` in BOTH the server core and the bootstrapper mirror. Pinned
      exactly and host-independently: with `ComSpec` and `COMSPEC` absent and
      `SystemRoot` set to a Windows root, the emitted cmd.exe command is exactly
      `<SystemRoot>` + `\System32\cmd.exe` — all backslashes, no forward slash —
      on every host OS.
- [ ] **AC-6** — The **fs-touching** candidate construction inside
      `resolveViaPathExt` (`resolve` / `join`) deliberately keeps the HOST `path`
      module, because a candidate must address the real filesystem the process is
      running on. A comment names that limit at the call site, and a test still
      pins that a bare name resolves from a really-planted file on the host fs.
- [ ] **AC-7** — `server/src/test/win32-spawn-mirror-parity.test.ts` is
      re-pointed at `server/src/core/win32-spawn.ts` and passes. The mirror's
      `DIVERGENCES` header is **corrected**, not merely re-pointed: divergence 1
      ("returns `null`") has been false since the App-Execution-Alias fix — the
      mirror returns `{command: name, args: rest}` for an unresolvable bare name
      (divergence 5), and its `@returns` JSDoc still advertised `| null`.
- [ ] **AC-8** — `server/src/test/no-shell-true-spawn.test.ts`'s `REMEDIATED`
      list covers the new `server/src/core/win32-spawn.ts`, and every entry still
      passes both of its assertions.
- [ ] **AC-9** — Behaviour is preserved, with **one** coverage deletion that is
      named rather than absorbed. `behavior_snapshot.py verify` exits 0, and the
      full `server/` + `bootstrapper/` suites are green. The **only** tests that
      disappear are the 11 in `cli-compat.probe-spawn-async.test.ts`, and they
      disappear because their subject is deleted by AC-1 — no *other* test
      vanishes, none flips green→red, and the net server test count **rises**.
      Reconciled explicitly with before/after counts, because
      `behavior_snapshot.py` collects no pytest node-ids for a vitest runner and
      prints that its removed-coverage and count-drop guards are **INERT** for
      this run; leaning on a gate that announced its own inertness would be
      exactly the silent skip this record exists to prevent.
- [ ] **AC-10** (F0.5, `surface = web`) — With the refactored boot path, the Hono
      server boots and `GET /api/diagnostics` returns 200 carrying a **parsed,
      supported** `claudeVersion`; the client's Diagnostics screen renders that
      same version with no console error. **Scope, stated precisely:** this runs
      on the Windows 11 dev machine against its really-installed Claude CLI, so
      it is a real-Windows boot regression AND real `CreateProcess` resolution —
      but that CLI is `claude.exe`, so AC-10 exercises the **direct-executable**
      branch only. The `.cmd` shim branch is covered by a separate purpose-built
      `.cmd` probe (as PR #340 did), never by AC-10. CI is ubuntu-only and
      exercises neither.
- [ ] **AC-11** — Every `path.*` call in **both** resolvers is classified and the
      classification is recorded in the module: **(a)** win32 command-string
      semantics → `path.win32`; **(b)** host-filesystem addressing → host `path`.
      The audit is exhaustive (`extname` ×2, ComSpec `join` → (a); `resolve` +
      `join` inside `resolveViaPathExt` → (b)), and the `PATH` split stays the
      hardcoded win32 `;` delimiter — already host-independent, now pinned by a
      **multi-entry** PATH test on the server side, which previously only ever
      set a single directory.
- [ ] **AC-12** — Core and wrapper are provably equivalent except at the one
      intended point: over a matrix of argv shapes (empty args, `.exe`, `.cmd`,
      spaced path, metacharacter, mixed-case extension, path-like absent, bare
      resolvable), `win32-spawn.resolveSpawn` and `preview-win32-spawn.resolveSpawn`
      return **deep-equal** results; for the unresolvable BARE name — and only
      there — the core returns `null` while the wrapper throws
      `PreviewProfileInvalidError`.

## Spec Impact

- **Classification:** none
- **ADD:** none
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** **No FR-observable change.** FR-01.05 still shows the
  detected Claude CLI version and its too-old banner; FR-01.49 still checks
  prerequisites up front and refuses loudly. This iterate deletes an export
  nothing calls, moves a module and renames it, and makes the win32 branch parse
  paths with win32 rules instead of the host's. No FR row's description,
  priority, or acceptance criteria change.
- **Affected FRs (unchanged, listed for the F5b gate):** FR-01.05, FR-01.49

**Not claimed: a zero-delta diff.** Two sub-FR deltas exist, both deliberate:

1. `probeClaudeVersionAsync` is **removed** from the module's export surface.
   **Restated after Stage-3 doubt review disproved the first justification.**
   The original wording said `server/` "is an application, not a published
   package", which is false in the way that matters:
   `bootstrapper/package.json` `files` includes `server/dist/`, and that package
   declares no `exports` map — so Node permits arbitrary deep subpath imports
   and `@svenroth-ai/shipwright/server/dist/core/cli-compat.js` has in fact
   shipped this symbol to npm. The honest footing is narrower and still
   sufficient: `server/dist` rides along inside the published tarball but has no
   `exports` entry, no documented subpath, and no known consumer; `bin` is the
   only advertised entry point. The removal is accepted as a non-breaking
   internal deletion — not as "it was never published". Sanctioned by AC-1.
2. The ComSpec fallback now yields `…\System32\cmd.exe` instead of the
   mixed-separator `…/System32/cmd.exe` whenever the win32 branch runs on a
   POSIX host. On a real **Windows** host there is no delta at all — the host
   `path` already **is** `path.win32`, and `ComSpec` is set, so the fallback is
   not even reached. **Reachability, stated precisely** (Stage-1 review
   corrected an earlier, too-narrow claim that this needed a stubbed
   `process.platform`): the server core does need the stub, but
   `bootstrapper/lib/win32-spawn.mjs` **exports `win32ComSpec`** and takes an
   *injected* platform, and that package publishes `lib/` — so a POSIX caller
   can observe the new string with no stubbing whatsoever. That is what AC-5
   asks for ("on every host OS"); the old mixed-separator string was never a
   usable path on any platform. Sanctioned by AC-5.

## Mini-Plan

**Chosen — extract the core, keep the preview module as a thin throwing wrapper.**

| # | File | Change |
|---|---|---|
| 1 | `server/src/core/win32-spawn.ts` | **new** — the resolver, `null` on an unresolvable bare name, no preview import |
| 2 | `server/src/core/preview-win32-spawn.ts` | **shrink** to a thin wrapper: re-export `splitWin32Command` + `ResolvedSpawn`, throw `PreviewProfileInvalidError` on `null` |
| 3 | `server/src/core/cli-compat.ts` | delete `probeClaudeVersionAsync`; import from `./win32-spawn.js` |
| 4 | `server/src/core/cli-compat.probe-spawn-async.test.ts` | **delete** (its subject is gone) |
| 5 | `server/src/core/win32-spawn.test.ts` | **new** — the path-flavour pins (AC-5/AC-6) + the null contract (AC-2) |
| 6 | `server/src/test/win32-spawn-mirror-parity.test.ts` | re-point at the new original; add a no-preview-import assertion |
| 7 | `server/src/test/no-shell-true-spawn.test.ts` | add `server/src/core/win32-spawn.ts` to `REMEDIATED` |
| 8 | `bootstrapper/lib/win32-spawn.mjs` | `path.win32` for the string decisions; correct the DIVERGENCES header + the stale `@returns` |
| 9 | `bootstrapper/test/win32-spawn.test.mjs` | tighten the loosened ComSpec assertions to the exact win32 string |
| 10 | `shipwright_bloat_baseline.json` | ratchet `cli-compat.ts` **down** after the deletion |
| 11 | `bootstrapper/lib/claude-cli.mjs` | **comment only** — annotate the now-unreachable `if (!plan)` branch |
| 12 | `bootstrapper/lib/preflight.mjs` | **comment only** — same annotation |

Files 11-12 were not in the first draft of this table; Stage-1 spec review
flagged them as touched-but-unlisted. They are entailed by AC-7 (its corrected
divergence-1 text promises the unreachable sites are "annotated as such at their
own sites"), carry zero behaviour, and are listed here rather than reverted.

**Work breakdown (sequential).**

1. Behavior-Snapshot the green baseline (F-simplify Phase 1) — refuses a red start.
2. Item 1: delete the dead export + its test file; ratchet the baseline down.
   *Test expectation:* typecheck green; `cli-compat.probe-spawn.test.ts` (the
   sync suite) unchanged and still green.
3. Item 2: extract `win32-spawn.ts`; reduce `preview-win32-spawn.ts` to the
   wrapper; re-point `cli-compat.ts`. *Test expectation:* the FROZEN
   `preview-win32-resolve.test.ts` passes **unmodified** — that is the proof the
   extraction is behaviour-preserving on the preview path.
4. Item 3: flavour the string decisions with `path.win32` in both files; write
   the exact-string pins RED-first, then fix. *Test expectation:* the new pins
   go green, and each is falsified by swapping `path.win32` back to `path.posix`.
5. Re-point the mirror-parity guard + the no-shell-true list; correct the mirror
   header. *Test expectation:* both guards green; parity guard falsified.
6. Behavior-Verify (F-simplify Phase 3) + full suites + F0.5.

**Alternative considered — rename the file and leave one module.**
Rename `preview-win32-spawn.ts` → `win32-spawn.ts`, keep the single throwing
`resolveSpawn`, and let `cli-compat.ts` keep catching the throw. **Rejected**,
for a reason that is not cosmetic: the throw is `PreviewProfileInvalidError`,
which lives in `preview-session-manager.ts`. A single module therefore *must*
keep that import, so the boot path keeps entering the preview ESM cycle — the
exact fragility PR #340 flagged as its third deferred item. It also forces the
boot probe to use exceptions for a non-exceptional "not found", which is why
`versionProbeSpawn` needs a `try/catch` at all. Splitting is what removes both,
and the two-line wrapper is cheaper than either.

**Also rejected — give `resolveSpawn` a `{throwOnUnresolved: boolean}` flag.**
One function, two behaviours, selected by a boolean its two callers set to
opposite constants: an options-flag with one caller each (constitution Karpathy
#2). The wrapper is the same idea with the branch resolved at the module
boundary, where a reader can see it.

## External plan review — findings and dispositions

Run via `external_review.py --mode iterate` (openrouter). **openai answered
`revise` with 6 findings; the gemini leg came back `degraded`/truncated**, so
one reviewer of two answered and the tool flagged `requires_resolution` — the
gemini finding below is the fragment it did emit before cutting off, and it is
addressed on its merits rather than discarded for being partial.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | med | AC-9 was self-contradictory: it demanded "no collected test disappeared" while the plan deletes an 11-test file. | **accepted-and-fixed** — AC-9 rewritten to name the one permitted deletion, tie it to AC-1's subject removal, and require an explicit before/after reconciliation. It also exposed that `behavior_snapshot.py`'s coverage guard is INERT for a vitest runner; that is now stated in AC-9 instead of being relied on. |
| 2 | med | The plan named only two `path.*` calls; every other (`isAbsolute`, `basename`, `normalize`, `parse`, `relative`, `delimiter`) could retain host-POSIX behaviour. | **accepted-and-fixed** — AC-11 requires an exhaustive audit with each call classified (a)/(b) in the module itself. Audit result: the resolvers use only `extname` ×2, `join` ×2, `resolve` ×1; none of the other APIs appears. |
| 3 | med | The host-fs exception gets ambiguous with multi-entry `PATH` and separator handling. | **accepted-and-fixed** — the `;` split is hardcoded win32 and therefore already host-independent, but the SERVER side only ever tested a single PATH directory. AC-11 adds a multi-entry test with the real file planted in a **later** entry, so the delimiter behaviour is intentional rather than incidental. |
| 4 | med | AC-10 claimed "real Windows resolution" without pinning a Windows runner or a deterministic CLI fixture. | **accepted-and-fixed** — AC-10 now states exactly what it does and does not prove: real Windows, real `CreateProcess`, but the **`.exe` branch only** (this machine's `claude` is `claude.exe`), with the `.cmd` branch covered by a separate purpose-built probe and CI covering neither. |
| 5 | med | A direct "no preview import" source scan cannot prove the ESM cycle is gone — an *indirect* import could restore it. | **accepted-and-fixed** — AC-2 upgraded from a direct string match to a **transitive** import-graph walk from both `win32-spawn.ts` and `cli-compat.ts`. This is a strictly stronger guard than the one originally planned. |
| 6 | low | Extraction could subtly alter handling of empty argv, quoted paths, mixed-case extensions, etc.; the frozen guard does not cover every core call pattern. | **accepted-and-fixed** — AC-12 adds a core↔wrapper **differential** matrix asserting deep-equality everywhere except the single intended divergence. |
| 7 (gemini) | med | If `versionProbeSpawn` drops its `try/catch` in favour of a `null` check, `cli-compat.probe-spawn.test.ts` will likely need edits — contradicting "unchanged and still green". | **accepted-with-modification.** The `try/catch` **stays** (Chesterton's fence: its comment says a throw must not take the boot path down, and `realpathSync`/`resolve` can still throw on pathological input); the `null` check is added beside it. What *does* change is that `versionProbeSpawn` and `gradeVersion` — introduced by PR #340 **only** because two probes shared them — become single-use once the async probe is deleted, so both are inlined (Karpathy #2). The claim "the sync suite stays unmodified" is then verified empirically, not assumed. |

## Out of Scope

- **Any change to what the preview spawn path *does*** (ADR-044 / DO-NOT #9).
  `preview-session-manager.ts` keeps importing `resolveSpawn` +
  `splitWin32Command` from `preview-win32-spawn.js` and keeps receiving a throw.
  The FROZEN guard is the proof, and it is not edited.
- **The mirror's remaining divergences (2-5).** Only the return-contract
  documentation (divergence 1) is corrected here, because the extraction is what
  makes it statable. Divergences 2-5 (signature, no `cwd`, exported
  `win32ComSpec`, bare-name fallback) are all earned and stay.
- **Making `bootstrapper/` a CI job.** `no-shell-true-spawn.test.ts` exists
  precisely because there is none; adding one is a CI-supply-chain change with
  its own risk flag and belongs in its own pass.
- **Flavouring the fs-touching `resolve`/`join`.** Deliberately NOT done — see
  AC-6. On a POSIX test host a win32-flavoured candidate path
  (`/tmp/x/a\name.EXE`) addresses no real file, so it would break the very tests
  that prove PATHEXT resolution works. The limit is documented, not hidden.

## Design Notes

n/a — no UI surface. The change is confined to process-spawn plumbing and its
tests; nothing renders differently. AC-10 reads an existing screen to prove the
boot chain still works, it does not change one.

## Affected Boundaries

No serialized format changes. The boundary touched is again the
**process-invocation boundary** (argv handed to `CreateProcess`), which has no
producer/consumer file format.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `win32-spawn.resolveSpawn()` → `{command, args, windowsVerbatimArguments}` | `child_process.spawn` / `spawnSync` | argv (win32 `CreateProcess` command line) |

## Verification (medium+)

- **Surface:** `web` — mandatory under the Backend-affects-Frontend rule. The
  diff changes the boot-time version probe, whose result reaches the UI through
  `GET /api/diagnostics`.
- **Runner:** real isolated worktree stack (Hono + Vite on non-default ports,
  temp `USERPROFILE`) + a real browser check of the Diagnostics screen.
- **Evidence path:** `shipwright_test_results.json` →
  `iterate_latest.surface_verification`.

## Confidence Calibration

- **Boundaries touched:** the win32 process-invocation boundary (argv →
  `CreateProcess`). No serialized file format; `touches_io_boundary` did not
  fire. The other boundary this diff moves is a **module** boundary (core ↔
  preview wrapper, and the server ↔ published-mirror pair), which is why AC-12
  and the parity guard exist.

- **Empirical probes run.** Windows 11, node v24.15.0. Three of these falsified
  a claim this iterate had already written down, which is the only reason to
  run them.

  1. *The POSIX-vs-win32 divergence, measured before designing the fix.*
     `path.posix.join("C:\Win","System32","cmd.exe")` → `C:\Win/System32/cmd.exe`
     (mixed separators); `path.win32.join` → `C:\Win\System32\cmd.exe`. This is
     the LIVE instance of item 3, and it is exactly why the old assertions were
     loosened to `/(?:^|[\\/])cmd\.exe$/` and `.toContain("cmd.exe")`.
  2. *`extname` on a dotted directory.* posix `.2\run` vs win32 `""` — a real
     divergence, but one that cannot flip a branch, so it was recorded as
     LATENT rather than sold as a bug fix.
  3. *`extname` on a resolved POSIX candidate* (`/tmp/x/a/toolexe.EXE`) → `.EXE`
     under both flavours. This is what makes it safe to classify a HOST realpath
     with `path.win32`.
  4. *Real boot path, end to end.* `probeClaudeVersion()` through the extracted
     core → `2.1.220 (Claude Code)`, parsed, supported.
  5. *Which branch the real binary takes.* `claude` here is `claude.exe`, so it
     takes the DIRECT branch — which is precisely why AC-10 is scoped to that
     branch and the `.cmd` branch is probed separately.
  6. *SPACED `.cmd` shim, EXECUTED* → verbatim branch, `SHIM-OK hello`, exit 0.
  7. *UNSPACED `.cmd` shim, EXECUTED* → discrete branch (`windowsVerbatimArguments`
     undefined), `DISCRETE-OK arg1`.
  8. *`&` metacharacter in the resolved path, EXECUTED* → quoted, `AMP-OK`.
  9. *BARE name off a spaced PATH entry, EXECUTED* → `SHIM-OK bare`.
  10. *core → `null` / wrapper → `PreviewProfileInvalidError`, for real.*

  **Falsification round 1 — the four new guards.** Each invariant was broken and
  the suite observed RED, then restored and observed green: the ComSpec flavour
  (`path.win32.join` → `path.posix.join`), the PATH delimiter (`;` → `:`), the
  import-closure guard (preview import re-introduced into the core), and the
  FROZEN Guard 6 (wrapper made non-throwing).

  11. **A guard was found VACUOUS and replaced.** Stage-2 review asked for proof
      that the closure walker follows a MULTI-LINE import and suggested
      `closure(preview-win32-spawn.ts) contains win32-spawn.ts`. Running the
      falsification showed that assertion passes even against the newline-blind
      walker, because that file also carries a single-line
      `export … from "./win32-spawn.js"`. **The reviewer's suggested proof was
      itself unsound.** Replaced with 9 synthetic two-file fixtures isolating one
      edge shape each (single-line, multi-line, re-export, side-effect, dynamic,
      single-quoted, + three type-only negatives), which ARE red against the
      broken walker.

  **Falsification round 2 — the doubt-review fixes.** Five more breaks, all RED:
  reverting the SECOND `extname` site only (the exact >=1-match bypass),
  reverting the first site, reverting the mirror's site, re-muting the walker's
  unresolved-edge report, and re-blinding it to a non-literal `import(expr)`.

  12. **A mangled fixture was found by the LINTER, not by 155 green tests.**
      Splitting the bootstrapper test file cost the `COMSPEC` constant one
      backslash level. Every assertion compares a resolver result *against
      `COMSPEC`*, so both sides were mangled identically and the suite passed
      while proving nothing. PR #340 recorded this same failure mode; this is
      its SECOND occurrence, which is what earns the new non-circular
      fixture-integrity test (built from `String.fromCharCode(92)`).

- **Test Completeness Ledger** (`testable ⇒ tested`; 0 untested-testable):

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | `probeClaudeVersionAsync` is gone from every tracked source file | tested | repo-wide grep: 0 source hits; `tsc --noEmit` exit 0 |
  | 2 | Deleting it did not disturb the sync probe's contract | tested | `cli-compat.probe-spawn.test.ts` passes with **no existing assertion changed** (one test ADDED, row 12) |
  | 3 | Core `resolveSpawn` returns `null` for an unresolvable BARE name | tested | `win32-spawn.test.ts` "returns null … instead of throwing" PASSED |
  | 4 | The preview wrapper turns that `null` into `PreviewProfileInvalidError` | tested | same file PASSED; + real execution probe 10 |
  | 5 | POSIX stays a pass-through and never `null` | tested | same file PASSED |
  | 6 | The FROZEN preview guard passes **unmodified** after the extraction | tested | `preview-win32-resolve.test.ts` byte-unchanged, Guards 3-6 green; falsified round 1 |
  | 7 | `preview-session-manager` is not TRANSITIVELY reachable from the core or the boot path | tested | `win32-spawn.import-closure.test.ts` PASSED; falsified round 1 |
  | 8 | The closure walker follows every load-time edge shape | tested | 9 fixture tests, one shape each; falsified round 2 (probe 11) |
  | 9 | The walker REPORTS what it cannot see rather than going green | tested | 3 fixture tests (`unresolved`, `opaqueDynamic`); falsified round 2 |
  | 10 | ComSpec fallback is the exact win32 string on every host | tested | `win32-spawn.test.ts` + `win32-spawn.resolve.test.mjs` exact `.toBe(...)`; falsified round 1 |
  | 11 | Extension classification uses win32 segment rules | tested | the `x\.exe` behavioural pin in BOTH packages; falsified round 2 (3 ways) |
  | 12 | The boot probe's `null` branch returns UNKNOWN_VERSION and spawns nothing | tested | `cli-compat.probe-spawn.test.ts` (added for doubt-7) PASSED |
  | 13 | PATH is split on `;` and scanned in order, multi-entry | tested | `win32-spawn.test.ts` ×2 (later-entry hit, earlier-entry wins); falsified round 1 |
  | 14 | fs candidates still resolve against the HOST fs | tested | the same two tests plant REAL files and resolve them |
  | 15 | Core and wrapper are deep-equal on 11 argv shapes + a resolvable bare + POSIX | tested | `win32-spawn.test.ts` AC-12 matrix PASSED |
  | 16 | …and diverge ONLY on the unresolvable bare name | tested | same file PASSED; + real execution probe 10 |
  | 17 | An un-flavoured `path.extname(` / `path.join(root,` cannot return to either file | tested | `win32-spawn-mirror-parity.test.ts` FORBIDDEN list; falsified round 2 |
  | 18 | The mirror has not drifted on any security-load-bearing decision | tested | parity guard, now matched against COMMENT-STRIPPED source; falsified round 2 |
  | 19 | `shell: true` cannot return to any of the 7 remediated files | tested | `no-shell-true-spawn.test.ts`, `REMEDIATED` extended with the new core |
  | 20 | The `COMSPEC` test fixture is not backslash-mangled | tested | `win32-spawn.test.mjs` "fixture integrity" (char-code based) — earned by probe 12 |
  | 21 | All four remediated paths still start real processes on **Windows** | tested | real execution, probes 4-10 |
  | 22 | The same paths under CI | untestable | `requires-physical-device` — CI runners are ubuntu-latest, so no win32 branch executes there; and `ci.yml` has no bootstrapper job at all. Unchanged from PR #340, and exactly why row 19 exists. |
  | 23 | Behaviour preserved across the whole change | tested | server 3198 → 3217 (−11 deleted, +30 added); bootstrapper 153 → 156; `behavior_snapshot verify` green |

- **Confidence-pattern check.**
  - *Asymptote (depth).* Three "looks fine" → reversal events in this run alone:
    (1) the plan's AC-9 was internally contradictory and external review caught
    it; (2) a guard I had just written was VACUOUS, and the reviewer's suggested
    proof for it was *also* vacuous — only running the falsification exposed
    both; (3) a fixture constant was silently mangled and 155 green tests did
    not notice. The honest reading is that "am I confident?" has been the wrong
    question three times today, so every guard in this diff has now been broken
    on purpose and observed RED (11 falsification runs across 2 rounds) rather
    than reasoned about.
  - *Coverage (breadth).* 23 rows, 22 `tested`, 1 `untestable` with a
    closed-vocabulary reason_code, **0 untested-testable**. 12 ACs, all covered.
  - *Integration composition.* `cross_component` does not fire — the diff-driven
    detector was run over the real file list and returned False, as did
    `is_ci_supplychain_change`, `is_io_boundary_change` and `touches_build_files`.
  - *Known limit, stated plainly.* `behavior_snapshot.py` collects no pytest
    node-ids for a vitest runner and **prints that its removed-coverage and
    count-drop guards are INERT** for this run. The F-simplify gate here is
    therefore green→green on exit code only; the coverage claim rests on the
    explicit before/after reconciliation in AC-9, not on that tool.
