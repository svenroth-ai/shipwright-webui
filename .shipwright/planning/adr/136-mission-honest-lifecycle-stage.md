# ADR — S4: "Where it stands" derived from the session's REAL phase

- **Run-ID:** iterate-2026-07-19-mission-s4-honest-lifecycle-stage
- **Date:** 2026-07-19
- **Section:** Iterate — change: mission lifecycle stage
- **Campaign:** `2026-07-18-mission-artifacts`, sub-iterate **S4** of 4 (serial; on merged S1 `#292` + S2 `#295` + S3 `#296`)
- **Complexity:** medium · **change_type:** change · **spec_impact:** modify
- **affected_frs:** `FR-01.66`

## Context

`inferStage` was furthest-along-wins over COARSE tool signals: the first
`Edit`/`Write` to any non-spec file set `build = true`, and Build outranks
Analyze. So the "Where it stands" stepper left Analyze while the iterate was
still scouting, interviewing and calibrating — the reported symptom.

The brief named the iterate's `TodoWrite` phase tasks as the PRIMARY replacement
signal ("gibt ja alles tasks"). Before building on that premise I probed it.

## Empirical basis (READ-ONLY probe, `~/.claude/projects`, 114 real iterate transcripts)

| Signal | Present in | Verdict |
|---|---|---|
| `gh pr` | 93% | real |
| `setup_iterate_worktree` | 89% | real |
| `finalize_iterate` | 85% | real |
| spec/planning write | 68% | real |
| `classify_complexity` | 66% | real |
| **`TodoWrite`** | **9%** | **premise falsified** |

- **The bug is real and measurable:** 17/114 (15%) had a scratch/bookkeeping
  write as their FIRST edit, ahead of every strong marker — mis-read as Build
  while in Analyze. The offenders are exactly `scratchpad/*.py`,
  `memory/*.md`, `plan.json`.
- **The premise is not:** `TodoWrite` appears in 9% of sessions, and where it
  does the task text is free-form campaign unit lists ("A18
  files-terminal-three-card — RISKIEST: ...") rather than the phase vocabulary
  (repo_scout → interview → iterate_spec → …).

## Decision

### 1. `TodoWrite` stays an Analyze marker; it is NOT the primary signal

Keyword-matching a lifecycle stage out of free-form task text would FABRICATE a
phase — the precise thing this campaign's honesty principle forbids — and would
do so on 9% of sessions while doing nothing on the other 91%. Building the
headline mechanism on a signal that is inert on real data is the campaign's
recurring failure shape (a mechanism provable only by a fixture I wrote myself).

This is a **deliberate, measured deviation from the brief**, raised three times
across the two external review rounds and rejected each time on the same
evidence. It is pinned by a test (a realistic `TodoWrite` payload naming later
phases must not move the stepper), so the decision is enforced rather than
merely documented.

### 2. Only an INCIDENTAL edit is prevented from advancing — a product edit still does

`classifyEditPath` is the single edit-path authority:
`spec | finalize | incidental | product`. `incidental` (scratch, `/tmp`, `/temp`,
plan/todo state, `.shipwright` bookkeeping, memory notes, `*.log`) is scope
activity; `product` still reaches Build.

The external code review argued (HIGH) that the spec's letter makes Build a
build/typecheck command only. **Rejected with measurement:** a build/typecheck
command appears in 31% of real sessions while product edits are the real
evidence of build work in 76%. Claiming Analyze for hours of product editing
would be a worse lie than the one being fixed, and the spec's own AC1 scopes the
sticky rule to an "**incidental** early Edit". Accepted trade-off: the 13% of
sessions with a product edit before the spec write read Build slightly early.

Anchors are filename/segment-exact, never loose substrings, so
`subscription-plan.ts`, `todo-list.tsx` and `planner.ts` stay `product`
(external plan review, Gemini 2 — tested).

### 3. Spec requires a spec that was actually WRITTEN

Invoking a command merely NAMED `…-plan` / `…-spec` used to set the Spec marker.
It writes nothing, so under AC2 it is not Spec evidence. Removed (external code
review, GPT 1 — HIGH). Spec now comes only from a real spec/planning/ADR write.

### 4. Evidence is STRUCTURAL — prose cannot spoof a stage

Markers are read from `tool_use` blocks only. A message that merely mentions
`npm run build` moves nothing. The transcript is untrusted third-party input
(external code review, GPT 5/11 — tested).

### 5. Scenario gating, and the two asymmetries in it

- `iterate` / `campaign` → phase markers over the `currentIterateEvents` window
  (**preserved unchanged** — a merged earlier sub-iterate never latches the
  current one's stage).
- `pipeline` → the authoritative run-config phase. An unreadable phase yields an
  honest "—" and NEVER falls back to the tool guess the phase exists to replace
  (the S2/S3 finding shape: an unreadable value folding into a benign one).
- `plain` → **no lifecycle position at all**, plus a coarse activity line.

**Asymmetry A — UNRESOLVED is not `plain`.** `null` means the resolver has not
answered; `plain` is a positive finding. Collapsing the first into the second
would strip the stage off every card whenever the resolver is merely slow, and
would treat missing information as a definite claim. I built it the other way
first, broke 10 shipped assertions, and traced it to exactly this conflation.

**Asymmetry B — a `plain` card WITH a kickoff marker still gets the lifecycle.**
`plain` means "no RECORD found", not "no iterate ran": a campaign whose record
has not landed, or an iterate whose pointer was pruned, both resolve `plain` with
the kickoff plainly in the transcript. The external code review called this a
gate violation (HIGH); **rejected with reason** — refusing real, structural,
first-party evidence is a fabrication in the other direction, and the existing
FR-01.67 campaign E2E depends on it. The gate still holds where it matters: a
card with neither scenario nor kickoff evidence never gets the iterate rule.

### 6. A plain session renders NO formal step labels

Initially the six labels stayed (greyed) with the activity in the none-slot.
The external plan review (GPT 8) was right that this still frames the work as a
position in a lifecycle it is not running. The labels are now omitted entirely
when there is no stage but a known activity. With no activity either, the
stepper is byte-identical to before — which is why **no visual baseline moved**
(the baselines seed no transcript), pinned by a unit test.

## Consequences

- **Behaviour change:** a plain/ad-hoc session no longer shows a lifecycle stage.
  This supersedes one shipped FR-01.66 E2E assertion, updated deliberately.
- Pure client-side. No server change, no new endpoint, no second write surface,
  no writes to `~/.claude/projects` (DO-NOT #1), terminal byte-identical.
- `inferStage` / `summarizeTranscript` DELEGATE to one implementation — there is
  no mirrored second copy of the rules to drift (the S3 finding shape).
- Two new modules because `narrator-transcript.ts` sits at 274 LOC and the
  project ceiling is 300. Both external reviewers proposed inlining; **rejected**
  — the split is forced by the bloat rule, not chosen. Test file split likewise
  (S3's precedent: split, never baseline a crossing). Bloat baseline NOT ratcheted.

## Self-Review

1. **Spec Compliance** — PASS. AC1–AC6 covered; AC1/AC5 proven RED before the
   fix. One measured, documented deviation (TodoWrite) and one accepted
   trade-off (product edit before spec).
2. **Error Handling** — PASS. Empty/unparseable transcript → honest `—`, never a
   default Analyze; unreadable pipeline phase → `—`, never a guess.
3. **Security Basics** — PASS. Structured `tool_use` reads only; no prose
   parsing, no new I/O, no new surface; JSONL stays read-only.
4. **Test Quality** — PASS. 13 of 25 new unit tests + both new E2E proven to
   FAIL against the reverted fix (two separate reverts, isolating each rule).
   Guards that pass before AND after are labelled as such rather than presented
   as new coverage.
5. **Performance Basics** — PASS. One extra linear pass over an already-parsed
   window; memoised on `transcriptContent, scenario, phase`.
6. **Naming & Structure** — PASS. All files ≤300 LOC; one authority per concept.
7. **Affected Boundaries** — PASS. The boundary is the Claude JSONL (untrusted,
   third-party). Probed with real transcripts plus BOM/CRLF/torn-line/Windows-path
   fixtures; producer (Claude) → file → consumer (derivation) exercised end-to-end
   through the real server in the E2E.

## Confidence Calibration

Probes were empirical, not assertions of confidence.

- **Probe 1** — marker frequency over 114 real iterate transcripts. **Finding:**
  the brief's primary signal is present in 9%. Design changed.
- **Probe 2** — bug incidence. **Finding:** 15% of sessions mis-read as Build.
  Confirmed the fix targets a real defect.
- **Probe 3** — ran the derivation over 188 real transcripts × 3 time-slices
  (564 samples), before vs after. **Finding:** 23 changed, ALL
  Build→Analyze/Spec; Merge/Test/Finalize distributions byte-identical. This
  falsifies the brief's stated risk that sticky-Analyze would make the stepper
  stick.
- **Probe 4** — audited every session whose FINAL stage changed. **No findings:**
  each was a post-PR window containing only memory/scratch writes. Honest.

**Asymptote:** probes 3 and 4 were two consecutive passes with no defect found,
so the boundary was declared calibrated. **That declaration was wrong**, and the
next section says why.

**Not probed, and why acceptable:** transcripts from other Claude Code major
versions (the parser layer already normalises event shapes and is separately
tested); non-Shipwright repositories (the markers are Shipwright-specific by
design, and an unrecognised session correctly degrades to the coarse read).

### Probe blind spot (internal code review, post-hoc)

**Probe 3 is a differential probe: it compares before-vs-after on the same
inputs. It is therefore structurally incapable of surfacing a defect present in
BOTH versions.** Probes 1 and 2 measured the world; probe 4 audited only the
sessions probe 3 had already flagged as changed. So the whole battery inherited
probe 3's blind spot, and three defects walked straight through it:

- **The backwards-to-Analyze bug (FIX 1).** Probe 4 looked *directly* at these
  windows — post-`pr-link` tails containing only memory/scratch writes — and
  recorded "each was a post-PR window containing only memory/scratch writes.
  Honest." It confirmed the window's *contents* and never asked whether the
  *stage* those contents produced was right. Pre-S4 that window read Build,
  post-S4 Analyze; both wrong, so the diff was silent and the audit rationalised
  its own hit. **An audit that explains a finding instead of testing it is not an
  audit.**
- **The furthest-along `activity` (FIX 2)** and **the loose `changelog`
  substring (FIX 3)** were likewise unchanged-and-wrong in both versions.

What the probes did establish stands: probe 3's byte-identical
Merge/Test/Finalize distributions are a real falsifier that an over-sticky fix
would have tripped. The lesson is about **coverage, not validity**: a
differential probe needs an absolute companion — assert the stage a known window
*should* yield, not merely that it changed. The FIX 1–4 tests are that
companion, which is why they are written as absolute expectations.

**Revised asymptote claim:** the incidental-edit boundary is calibrated; the
*window-boundary* and *activity-tail* boundaries were not probed at all until
the code review found them by reading.

## External-Plan-Review-Findings

| # | Sev | Finding | Disposition |
|---|---|---|---|
| G1 | High | File sprawl — inline into `narrator-transcript.ts` | rejected-with-reason (300-LOC ceiling; inlining would breach it) |
| G2 | Med | Loose path match would eat `subscription-plan.ts` | accepted-and-fixed (anchors verified + tests added) |
| G3 | Med | Unresolved-scenario UI fallback unspecified | accepted-and-verified (typed result; `—` path tested) |
| G4 | Low | Signature ripple to call sites | accepted-and-verified (optional options; tsc clean) |
| O1 | High | Product edit should not establish Build | rejected-with-measurement (31% vs 76%; see Decision 2) |
| O2 | High | TodoWrite must be the primary signal | rejected-with-measurement (9%, free-form; Decision 1) |
| O3 | High | Campaign must use S3 active-sub-iterate, not markers | accepted-and-verified (`currentIterateEvents` does exactly this; test added) |
| O4 | High | Verify exact S1/S3 API shapes | accepted-and-verified (`MissionContext.scenario`, `PhaseArtifact.detail.phase`) |
| O5 | High | Evidence semantics: prose, failed commands | accepted-and-fixed (structural-only; prose test added) |
| O6 | Med | Path classification brittle | accepted-and-fixed (tests added) |
| O7 | Med | Verify live update / memoisation | accepted-and-verified (E2E drives 3 transitions, no reload) |
| O8 | Med | Plain must not retain the formal stepper | accepted-and-fixed (labels omitted — Decision 6) |
| O9 | Med | Unresolved needs an explicit outcome | accepted-and-verified (test added) |
| O10 | Low | File sprawl | rejected-with-reason (as G1) |
| O11 | Low | Prose spoofing | accepted-and-fixed (as O5) |

## External-Code-Review-Findings

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | High | Slash command named "spec"/"plan" reached Spec without a write | **accepted-and-fixed** (real bug; Decision 3) |
| C2 | High | `plain` + kickoff escape violates the gate | rejected-with-reason (Decision 5, Asymmetry B) |
| C3 | Med | Loading window can briefly show a stage on a plain card | rejected-with-reason (Asymmetry A; suppressing on unknown is the worse failure) |
| C4 | High | TodoWrite not used as the primary signal | rejected-with-measurement (as O2) |
| C5 | Med | Campaign not wired to an S3 phase resolver | rejected-with-reason (`SubIterateDetail` carries `status`, not a phase — no such field exists) |
| C6 | Med | E2E rides the plain-with-kickoff escape, not the iterate branch | **accepted-and-fixed** (E2E now resolves `scenario: iterate`/`plain` explicitly) |
| C7 | Med | No realistic TodoWrite fixture | **accepted-and-fixed** (decision now pinned by a test) |
| C8 | Med | `spec.md` AC line + changelog missing | **accepted-and-fixed** (FR-01.66 AC (K) + `Fixed/` fragment) |

Gemini's code-review response returned malformed (it emitted partial reasoning
about a `toolPath` helper rather than findings). Checked its concern anyway:
`toolPath`/`toolCommand` both remain in use by the narration path — no dead code.

## Internal-Code-Review-Findings (cascade, post-PR)

All four fixes are behaviour bugs the external reviewers and my own probes
missed. Each is pinned by an absolute-expectation test, and each was verified to
FAIL against its own reverted fix (five separate reverts, 9 tests).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| I1 | High | Stepper walks BACKWARDS to Analyze once housekeeping follows the `pr-link`: the boundary dropped the Merge evidence and the clamp only rescued a trailing `pr-link` | **accepted-and-fixed** — the `pr-link` boundary is withdrawn unless REAL work follows it |
| I2 | High | `activity` was a furthest-along maximum over an order-INDEPENDENT marker set, rendered as `aria-label="current activity: …"` — contradicting the narration panel beside it | **accepted-and-fixed** — `lastActivity` is a tail scan |
| I3 | Med | `classifyEditPath`'s first rule was a bare substring, contradicting the file's own doc: `ChangelogPanel.tsx` classified as `finalize` | **accepted-and-fixed** — segment-anchored; guard loop extended |
| I4 | Med | `gh pr view` / `gh run list` / `cat CHANGELOG.md` / `cat vitest.config.ts` claimed their phases — the same name-vs-evidence class as C1, left unswept | **accepted-and-fixed** — verb markers require a command position; script markers stay unanchored because they are arguments by nature |
| I5 | Low | `custom_actions` mapped onto the `null` unresolved sentinel — Asymmetry A running backwards | **accepted-and-fixed** — `stageScenario()` maps it to `plain` |
| I6 | Low | A window with events but zero markers returned `basis: "coarse_activity"` with null values | **accepted-and-fixed** — collapses to `NOTHING` |
| I7 | Low | `inferStage` had no production callers; its "kept for existing callers" comment was stale | **accepted-and-fixed** — removed; the two windowing tests call `deriveStage` |
| I8 | Low | `doc-sync` `REQUIRED_TOKENS` not extended | **accepted-and-fixed** — added `stage-markers` + `stage-derivation`. NOTE: S1–S3 share this omission; campaign-wide follow-up, not S4's to close |
| I9 | Info | `schemaVersion !== 1` nulls the context, so one server schema bump silently disables the AC4/AC5 gate for every card, with no signal | **recorded, not fixed** — inherited from the S1 compat design (`isSupportedSchema`); changing it here would alter S1's deliberate version-skew contract. Worth a campaign-level follow-up: the gate should degrade to "unresolved" loudly rather than silently |
