# Iterate Spec: win32-shell-spawn-remediation

- **Run ID:** iterate-2026-07-31-win32-shell-spawn-remediation
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal

Windows-only command-invocation branches across **four files** reach the platform
shell (`shell: true`) purely to resolve a `.cmd`/PATHEXT shim, and carry **four**
inline scanner suppressions saying why that is defensible. (Branch count is five,
not four: `cli-compat.ts` has both a sync and an async probe, and only the async
one was flagged. Both are fixed — patching the flagged trigger and leaving its
unflagged twin is how this class comes back.) Replace them all with the
shell-free `.cmd` resolution this repo already ships and reviewed (`win32CmdWrap`
in `server/src/core/preview-win32-spawn.ts`, ADR-044), and **delete** the four
suppressions rather than registering them — the accepted-risk register's own
stated policy is to prefer a root remediation whenever one exists.

## Acceptance Criteria

- [ ] AC-1 — `server/src/core/cli-compat.ts` spawns the Claude version probe with
      `shell: false` on every platform; the Windows `.cmd` shim still resolves.
- [ ] AC-2 — `bootstrapper/lib/claude-cli.mjs` (`defaultRunClaude`) runs the real
      `claude` plugin CLI with `shell: false`; a `.cmd` shim still resolves and a
      genuinely absent `claude` still reports "not found" rather than throwing.
- [ ] AC-3 — `bootstrapper/lib/preflight.mjs` (`defaultRun`) probes every
      prerequisite (`claude`, `uv`, `python3`/`python`/`py`, `git`, `gh`) with
      `shell: false`; the MS-Store `python3` App-Execution-Alias stub is still
      rejected, and an absent tool still reports `ok: false`.
- [ ] AC-4 — `bootstrapper/lib/server.mjs` (`defaultOpenBrowser`) opens the
      browser with `shell: false` on Windows.
- [ ] AC-5 — all four `// nosemgrep: …spawn-shell-true…` suppressions at those
      sites are **deleted**, and no new register entry is added for them.
      The three pty-API sites (`server/src/terminal/`) are untouched.
- [ ] AC-6 — all four paths are **executed for real on Windows** after the change
      (process startup — a green unit test does not falsify this).
- [ ] AC-7 — the hono accepted-risk entry carries the dated 2026-07-30
      re-verification evidence, so its October re-review starts from evidence.
- [ ] AC-8 — the `cli-compat.ts` → `claude-bin-resolver.ts` split forced by the
      anti-ratchet gate is a **pure relocation**: no logic changed, operator-log
      strings unchanged, CLAUDE.md rule 10 still satisfied, consumers rewired,
      and the bloat-baseline entry ratcheted down rather than left stale.

## Spec Impact

- **Classification:** none
- **ADD:** none
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** **No FR-observable change.** The two user-visible
  promises involved are unchanged — FR-01.05 still shows the detected Claude CLI
  version and its too-old banner, and FR-01.49 still checks prerequisites up
  front and refuses loudly. Only the mechanism by which a Windows `.cmd` shim is
  located changes (platform shell → explicit PATHEXT resolution +
  `cmd.exe /d /s /c`). No FR row's description, priority, or acceptance criteria
  change.

  **Not claimed: byte-identical behaviour.** Three deltas exist below the FR
  line, none of them FR-observable, all deliberate:
  1. `defaultRunClaude` with no resolvable `claude` now returns
     `code: null, stderr: "claude not found on PATH"`; previously it returned the
     shell's exit code and cmd.exe's own message. Sanctioned by AC-2.
  2. `defaultRun` with a tool that PATHEXT cannot place makes **one** shell-free
     `CreateProcess` attempt on the bare name rather than giving up — that is
     what keeps a Microsoft-Store App-Execution-Alias reachable, since `realpath`
     cannot follow one. A genuinely absent tool therefore comes back as an
     ENOENT spawn error rather than a no-spawn refusal. Sanctioned by AC-3; the
     `ok: false` verdict — the only thing `runPreflight` reads — is identical
     either way. (An earlier draft of this section claimed "without spawning";
     the Store-alias fix made that false, and external plan review caught the
     stale sentence.)
  3. New public surface in the **published** package (`files: ["lib/"]`, no
     `exports` map): `lib/win32-spawn.mjs` in full, plus `SAFE_ARG` and
     `openBrowserPlan`. Exported to make security-load-bearing behaviour testable
     in both directions; additive only, nothing was removed or renamed.
- **Affected FRs (unchanged, listed for the F5b gate):** FR-01.05, FR-01.49

## Mini-Plan

**Chosen — reuse the reviewed resolver; mirror it once for the published package.**

1. `server/src/core/cli-compat.ts` is in the same package as
   `preview-win32-spawn.ts`, so it calls the existing exported `resolveSpawn()`
   directly — no duplicated dispatch logic. It does add one small local helper
   (`versionProbeSpawn`) shared by the sync and async probes, plus the
   `gradeVersion` / `UNKNOWN_VERSION` dedup that pays for those lines
   (see "Forced work" below for why the line budget is load-bearing here).
2. `bootstrapper/` is a **separately published npm package**
   (`@svenroth-ai/shipwright`) and DO-NOT #7 forbids cross-package imports, so it
   gets a small dependency-free **verbatim mirror**, `bootstrapper/lib/win32-spawn.mjs`,
   carrying the same three rules: PATHEXT resolution, PATH-only lookup for bare
   names (never the cwd), and the `cmd.exe /d /s /c` wrap with the verbatim
   outer-quoted form for spaced paths. Three callers in that package use it, so
   the module is earned rather than speculative.
3. The mirror **returns `null`** for an unresolvable bare name where the server
   original throws `PreviewProfileInvalidError`. Deliberate: the bootstrapper's
   whole job is to report a missing prerequisite as a verdict line, not to crash.

**Alternative considered — extract one shared module used by both packages.**
Rejected. It is the shape that looks cleanest and is wrong here: the only way to
share real code across `server/` and `bootstrapper/` is a cross-package import
(DO-NOT #7, ADR-080 — it breaks `rootDir` and drags client/server TS into each
other's compilation) or a new published workspace package. Both cost far more
than ~70 mirrored lines, and the repo already answers this exact question with
verbatim mirrors (`server/src/types/action-schema.ts`). A drift guard is cheaper
than a dependency.

**Also rejected — keep `shell: true` and register the four as accepted risks.**
That is what the brief explicitly rules out and the register agrees: a remediation
exists in-tree, already reviewed, already handling the awkward quoting cases.

### Forced work — the `cli-compat.ts` split (declared, not smuggled)

`server/src/core/cli-compat.ts` sat at **334 lines against a 300 limit**, carried
in `shipwright_bloat_baseline.json` as a `grandfathered` entry. The anti-ratchet
gate blocks any commit that grows an existing baseline entry past its `current`,
so this remediation — which legitimately needs a handful of net lines there —
**could not be committed at all** without paying that debt down first. Verified
empirically: `scripts/hooks/anti_ratchet_check.py` printed
`ANTI-RATCHET BLOCK … cli-compat.ts 334 → 343`. Its own remediation menu is
"shrink the file, split it, or write a bloat-exception ADR".

Golfing comments down to fit was rejected: it buys line count by deleting
rationale, which is the wrong trade in a security change. A bloat-exception ADR
was rejected as perpetuating a violation that has a clean fix.

So the file is **split along the seam it already had**. `cli-compat.ts` describes
itself as the CLI *version gate*; binary *discovery* (`resolveClaudeBin`,
`resolveClaudeBinWith`, `curatedCandidates`, `selfHealClaudePath`) was bolted on
in v0.8.8 and is a different concern. It moves to
**`server/src/core/claude-bin-resolver.ts`** (250 lines) and `cli-compat.ts` drops
to 111 — under its limit for the first time, retiring the grandfathered overage
rather than perpetuating it.

- It is a **pure relocation**: not one line of logic changed in the move. The
  `[cli-compat]` operator-log prefixes are deliberately left untouched, because
  they are observable output and changing them would make the move non-pure.
- CLAUDE.md architecture rule 10 ("MIN_SUPPORTED_CLI is pinned in
  `core/cli-compat.ts`") still holds — the constant did not move.
- Consumers updated: `server/src/index.ts`; the two resolver test files are
  renamed to match their new subject.
- `shipwright_bloat_baseline.json` is touched: the `cli-compat.ts` entry ratchets
  **down** 334 → 111, following the existing `ActionsConfigCard.tsx` precedent
  (a post-split entry kept and re-pointed rather than deleted).

## Out of Scope

- The **three** further sites matching the same scanner rule —
  `server/src/terminal/ws-upgrade-handler.ts` and two in
  `server/src/terminal/routes.ts`. Those are genuine false positives on the
  in-house `ptyManager.spawn()` API, whose `shell` option is a whitelisted binary
  **name** (ADR-067 allowlist), not a `child_process` flag. No code change is
  possible; only scanner tailoring would help. Their suppressions stay.
- Any change to what the preview spawn path does (ADR-044 / DO-NOT #9). This
  iterate only *reads* `resolveSpawn`; `preview-win32-spawn.ts` is unmodified.
- **Deferred follow-ups raised by review and deliberately NOT done here** (each
  is a real observation; none blocks this change):
  - `probeClaudeVersionAsync` has zero production callers. Both reviewers flagged
    it as dead code whose deletion would be smaller than its remediation. Left in
    place because removing a public export is a behaviour change that does not
    belong in a PR whose claim is "no FR-observable change"; it now at least has
    tests. Someone should decide its fate deliberately.
  - `preview-win32-spawn.ts` would be better named and homed now that it has
    three consumer classes plus a cross-package mirror — the code-review's
    suggestion to extract `core/win32-spawn.ts` with a null-returning
    `resolveSpawn` and keep the preview module as a thin throwing wrapper is
    right, and would erase mirror divergence 1. Out of scope: it touches the
    frozen ADR-044 guard surface.
  - `cli-compat.ts` now joins the `preview-win32-spawn ↔ preview-session-manager`
    ESM cycle from the boot path. Verified safe today (neither module does
    module-load-time work), but it is a new fragility.
  - The win32 branch uses the HOST `path` module while `platform` is injected, so
    the win32 unit assertions run POSIX path semantics on Linux CI. This repo has
    been burned by exactly that before (`claude-bin-resolver.ts` records 9 red CI
    runs from it).
- The two remaining `shell: true` call sites in tracked source,
  `server/scripts/sdk-poc.ts:65` and `:857`. That is a one-off PoC script: it is
  `.semgrepignore`d, is not in the shipped server, and carries no suppression to
  delete. Naming them here so AC-5's "all four" is not misread as "the repo now
  contains no `shell: true`".
- Repo-wide EOL renormalization. One shebang file is pinned (below) because it
  blocks this iterate's own Windows verification; the other CRLF shebang files
  are spawned as `node <path>` and are unaffected.

## Incidental fix (called out, not smuggled)

`bootstrapper/bin/shipwright.mjs` is the published npm `bin` entry and carries a
shebang. `core.autocrlf=true` checks it out CRLF, and esbuild's hashbang handling
leaves the stray CR, so `bootstrapper/test/bin.test.mjs` fails to parse
(`SyntaxError: Invalid or unexpected token`) in **any** Windows worktree — green
on Linux CI, red locally. That red blocked the green baseline this iterate needs
before touching three files in that same package. It is also a latent publish bug:
`npx` executes that file through its shebang, so a CRLF pack dies on macOS/Linux
with `bad interpreter: /usr/bin/env node^M` — precisely what the neighbouring
`*.sh text eol=lf` rule already guards. Fix is one `.gitattributes` line.

## Design Notes

n/a — no UI surface. The change is confined to process-spawn plumbing; nothing
renders differently.

## Affected Boundaries

No serialized format changes. The boundary this diff touches is the
**process-invocation boundary** (argv handed to `CreateProcess`), which has no
producer/consumer file format — but it is the one that can only be falsified by
real execution, which is why AC-6 exists.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `resolveSpawn()` → `{command, args, windowsVerbatimArguments}` | `child_process.spawn` / `spawnSync` | argv (win32 `CreateProcess` command line) |

## Confidence Calibration

- **Boundaries touched:** the win32 process-invocation boundary (argv →
  `CreateProcess`); no serialized file format.

- **Empirical probes run** (all on the Windows 11 dev machine, node v24.15.0):

  1. *PATHEXT resolution of every real tool.* **Finding that changed the design:**
     `realpathSync.native` on the Microsoft-Store App-Execution-Alias
     `…\WindowsApps\python3.EXE` throws **EACCES**, not ENOENT. Had the resolver
     treated only ENOENT as "keep looking", a machine with a perfectly good
     `python` would have been reported as having no Python. The catch-all in
     `resolveViaPathExt` is load-bearing because of this, and is commented as such.
  2. *`claude` on this machine is `claude.exe`, not `.cmd`.* So the shim branch —
     the one that used to REQUIRE `shell: true` — would have gone unexercised by
     a naive "run it and see". Every `.cmd` assertion below therefore uses a real
     shim (`npx.cmd`, or a purpose-built `.cmd` in a spaced directory).
  3. *Real `.cmd` in a SPACED directory, executed.* argv
     `["/d","/s","/c","\"\"…\\Program Files Fake\\sw-probe.cmd\" hello\""]` with
     `windowsVerbatimArguments: true` → printed `SHIM-OK hello`, exit 0. Also
     verified resolving the same shim as a BARE name off a spaced PATH entry.
  4. *Both cli-compat probes against a spaced `.cmd`* → `2.1.250 (Claude Code)`,
     graded supported, sync and async agreeing.
  5. *Both cli-compat probes against the real binary* → `2.1.220 (Claude Code)`,
     plan carries no cmd.exe and no manual quoting.
  6. *`runPreflight()` for real* → claude 2.1.220 / uv 0.11.9 / python 3.13.13 /
     node v24.15.0 / git 2.54.0 / gh 2.92.0, `pluginPhaseOk = true`; `python3`
     UNRESOLVED and correctly falling through to real `python` (probe 1's case).
  7. *`npx` — a genuine `.cmd`* → resolved via cmd.exe-wrap, ran, reported 11.17.0.
  8. *Real browser open* — `cmd.exe /d /s /c start "" http://localhost:3847`,
     detached, `shell: false` → spawned with a pid and no error event.
  9. *The drift guard was falsified before being trusted:* replacing
     `statSync(real).isFile()` with `true` in the mirror turns
     `win32-spawn-mirror-parity.test.ts` RED; restored after.
  10. *The `.gitattributes` pin was falsified the same way:* before it,
      `bootstrapper/test/bin.test.mjs` failed to parse in this worktree
      (`SyntaxError: Invalid or unexpected token`); after renormalising, the
      bootstrapper suite went 84 → 85 passing with no other change.

  **Second round — probes run in response to code review + doubt review.** Two
  of these falsified a claim this spec had already made, which is the point of
  running them:

  11. *A cmd metacharacter in a resolved path SPLITS the command.* A `.cmd` under
      `…\R&D\` via discrete argv → `'C:\…\R' is not recognized as an internal or
      external command`; quoted → the shim runs. **This was a regression this
      iterate introduced**: the old `shell: true` path pre-quoted the binary, the
      new discrete-argv path did not, and making `cli-compat` a consumer of the
      ADR-044 resolver carried the gap onto the boot probe. Fixed in BOTH files
      (`WIN32_CMD_SPECIAL`), not just the mirror.
  12. *A bare-name spawn under `shell: false` is PATH-only.* A planted
      `.\swplantedexe.exe` with `cwd` set to its own directory returns ENOENT.
      So falling back to a bare `CreateProcess` spawn does **not** reintroduce
      the cwd-first hijack that delegating to `cmd /c <bare>` would.
  13. *`realpath` cannot follow an App-Execution-Alias — but `CreateProcess` can.*
      `spawnSync("python3", …, {shell:false})` reaches the alias and it answers
      (exit 9009, the Store nag). **This falsified probe 1's framing**: rejecting
      the alias is not "correctly rejecting the stub", it is failing to resolve
      *any* Store app — so a genuinely INSTALLED Store Python would have been
      reported absent and the installer would have hard-refused on a working
      machine. Fixed by the bare-name fallback; the stub stays rejected by the
      unchanged `\d+\.\d+` output requirement instead.
  14. *The DISCRETE branch now really executes.* Every earlier `.cmd` probe used
      a SPACED path, so all of them took the verbatim branch — the doubt review
      was right that the branch carrying probe 11's bug had no real-execution
      evidence at all. An unspaced `.cmd` now runs (`DISCRETE-OK arg1`), as does
      the `&`-bearing one, explicitly asserting which branch each took.
  15. *The parity guard was falsified against the doubt review's own bypasses.*
      Swapping the mirror's bare-name consequent to `win32CmdWrap` → RED.
      Injecting `process.cwd()` into the PATH scan → initially GREEN, because my
      anchor started after the injection point; the window was moved to the loop
      header and it is now RED. The first version of this guard would have
      missed the more dangerous of the two.
  16. *The never-fatal contract was falsified:* deleting the browser opener's
      `child.on("error", …)` surfaces an uncaught ENOENT from the detached child.

- **Test Completeness Ledger** (`testable ⇒ tested`; 0 untested-testable):

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Version probe passes `shell:false` on win32/linux/darwin | tested | `cli-compat.probe-spawn.test.ts` "passes shell:false on %s" PASSED |
  | 2 | win32 `.exe` bin → spawned directly, no cmd.exe, no quoting | tested | same file, ".exe binary is spawned DIRECTLY" PASSED |
  | 3 | win32 `.cmd` bin → `cmd /d /s /c` + discrete argv | tested | same file, ".cmd shim goes through an explicit cmd" PASSED |
  | 4 | win32 spaced `.cmd` → verbatim outer-quoted + `windowsVerbatimArguments` | tested | same file, "SPACED .cmd path" PASSED |
  | 5 | POSIX probe stays a plain direct spawn | tested | same file, "POSIX stays a plain direct spawn" PASSED |
  | 6 | No resolvable bin → unknown-version, zero spawns | tested | same file, "no resolvable binary" PASSED |
  | 7 | Garbage stdout → unsupported, no crash | tested | same file, "garbage on stdout" PASSED |
  | 8 | Mirror: POSIX pass-through | tested | `win32-spawn.test.mjs` "POSIX is a pass-through" PASSED |
  | 9 | Mirror: `.exe`/`.com` direct; backslashes verbatim (F31) | tested | same file, "win32 executables spawn directly" PASSED |
  | 10 | Mirror: `.cmd`/`.bat` → cmd.exe, discrete argv, never a `shell` key | tested | same file, ".cmd/.bat shims" PASSED |
  | 11 | Mirror: spaced target / spaced arg / empty-string arg quoting | tested | same file, "SPACED path" ×3 PASSED |
  | 12 | Mirror: bare name → PATHEXT; `.EXE` beats `.CMD`; earlier PATH wins; `Path` casing | tested | same file, "bare names resolve from PATH" ×5 PASSED |
  | 13 | Mirror: an unusable candidate does not abort the scan (the EACCES case) | tested | same file, "skips a directory named like the executable" PASSED |
  | 14 | Mirror: unresolvable bare → `null`; never resolved from cwd; path-like still wraps | tested | same file, "security posture inherited from ADR-044" ×3 PASSED |
  | 15 | `win32ComSpec` env precedence + fallbacks | tested | same file, "win32ComSpec" ×4 PASSED |
  | 16 | `SAFE_ARG` rejects every cmd metacharacter, and does so WITHOUT spawning | tested | `claude-cli.test.mjs` "refuses %s" ×9 PASSED |
  | 17 | `SAFE_ARG` still accepts every installer arg shape (gate not over-tightened) | tested | same file, "still ACCEPTS" PASSED |
  | 18 | Unreachable `claude` → `ok:false` verdict, never a throw | tested | same file, "unreachable claude is a verdict" PASSED |
  | 19 | `defaultRun` really starts a process (`node --version`) | tested | `preflight.test.mjs` "resolves and runs node --version" PASSED |
  | 20 | `defaultRun`: absent tool → `ok:false`; exit-0-but-no-version → `ok:false` (the Store-stub rule) | tested | same file, ×2 PASSED |
  | 21 | `defaultRun` resolves a real `.cmd` shim (npx) without a shell | tested | same file, win32-gated case PASSED on this machine |
  | 22 | `openBrowserPlan`: win32 → ComSpec + `/d /s /c start "" <url>`, no `shell`; darwin/linux bare | tested | `server.test.mjs` "openBrowserPlan" ×5 PASSED |
  | 23 | Mirror has not drifted from the server original on any security-load-bearing decision | tested | `win32-spawn-mirror-parity.test.ts` 30 PASSED; guard falsified (probe 9) |
  | 24 | The `cli-compat` split is a pure relocation | tested | the two relocated suites pass **unchanged** against the new module; full server suite 3140 PASSED |
  | 25 | Register/suppression pairing still reconciles after the evidence fold | tested | `accepted_risks_cli.py check` + `expire` both exit 0 |
  | 26 | The npm `bin` entry stays LF, so `npx` cannot ship a CRLF shebang | tested | `git ls-files --eol` → `i/lf w/lf attr/text eol=lf`; `bin.test.mjs` parses again |
  | 27 | All four remediated paths actually start processes **on Windows** | tested | real execution, probes 3–8 + 11–14 |
  | 28 | The same four paths under CI | untestable | `requires-physical-device` — CI runners are ubuntu-latest, so no win32 branch executes there at all; and `.github/workflows/ci.yml` has **no bootstrapper job**, so the bootstrapper suite is a local-dev guard, not a CI gate. Recorded rather than hidden — and it is exactly why row 33 exists. |
  | 29 | A cmd metacharacter in a target or argument is quoted, never parsed by cmd.exe | tested | `win32-spawn.test.mjs` "cmd METACHARACTERS" ×11 PASSED; real execution probe 11 (`R&D` dir runs) |
  | 30 | An unresolvable bare name reaches CreateProcess (PATH-only), never `cmd /c <bare>` | tested | `win32-spawn.test.mjs` "security posture" ×3 PASSED; probes 12 + 13 |
  | 31 | A real Store-installed Python stays detectable; the Store STUB stays rejected | tested | probe 13 — the alias is reached (exit 9009) and rejected on the `\d+\.\d+` rule, and `resolvePython` still returns 3.13.13 |
  | 32 | `openBrowserPlan` quotes a url carrying a cmd metacharacter | tested | `server.test.mjs` "QUOTES a url carrying a cmd metacharacter" PASSED; probe: `"start "" "http://h/?a=1&b=2""` |
  | 33 | A future change cannot silently restore `shell: true` on the four sites | tested | `server/src/test/no-shell-true-spawn.test.ts` — a CI-RUNNING source scan over all six files (the bootstrapper's own suite never runs in CI), plus a check that the three pty suppressions are still exactly 3 |
  | 34 | The mirror↔original guard catches realistic drift, not just deletion | tested | `win32-spawn-mirror-parity.test.ts` 35 PASSED; falsified against both doubt-review bypasses (probe 15) |
  | 35 | The browser opener is non-fatal when the opener cannot launch | tested | `server.test.mjs` "NEVER fatal" PASSED; falsified by deleting the listener (probe 16) |
  | 36 | The ASYNC probe is remediated identically to the sync one | tested | `cli-compat.probe-spawn-async.test.ts` 11 PASSED (mocked `spawn`); real execution via both probes agreeing |
  | 37 | A bare name that already carries a `.cmd` extension skips resolution (known narrow gap) | tested | `win32-spawn.test.mjs` "ALREADY carries a shim extension" PASSED — pinned so it cannot widen unnoticed; unreachable from all three callers |

- **Confidence-pattern check:**
  - *Asymptote (depth).* Five "looks fine" → finding reversals so far, so the
    answer to "are you confident?" has been wrong repeatedly and the only useful
    response is another probe: (1) the EACCES finding; (2) eaten backslashes in a
    heredoc-appended test, which made four assertions compare two identically
    mangled strings — passing while proving nothing; (3) the metacharacter
    regression, which I had explicitly reasoned was out of scope and which was in
    fact introduced by this change; (4) the App-Execution-Alias framing, where my
    own probe 1 confirmed the outcome I wanted on a machine where the alias
    happened to be the stub; (5) the parity guard's cwd bypass, which my first
    negative assertion missed. Every guard in this diff has now been falsified
    rather than assumed (probes 9, 10, 15, 16).
  - *Coverage (breadth).* 37 rows, 36 `tested`, 1 `untestable` with a
    closed-vocabulary reason_code, **0 untested-testable**. 8 ACs, all covered.
  - *Integration composition.* `cross_component` does not fire — no merge/churn
    resolver, hook fan-out, phase validator, or campaign-drain file is touched.
  - *Known limit, stated plainly.* Removing `shell: true` is a real reduction in
    attack surface but **not** its elimination for `.cmd` targets: a shim is still
    ultimately parsed by cmd.exe. What changed is that the command line is now
    built explicitly (discrete argv, or a verbatim line we quote ourselves)
    instead of being handed to Node's shell, and that an `.exe` target involves no
    cmd.exe at all. `SAFE_ARG` remains load-bearing for exactly this reason.
