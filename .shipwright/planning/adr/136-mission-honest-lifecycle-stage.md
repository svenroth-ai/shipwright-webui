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

**Asymptote:** probes 3 and 4 are two consecutive passes with no defect found.
Boundary declared calibrated.

**Not probed, and why acceptable:** transcripts from other Claude Code major
versions (the parser layer already normalises event shapes and is separately
tested); non-Shipwright repositories (the markers are Shipwright-specific by
design, and an unrecognised session correctly degrades to the coarse read).

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
