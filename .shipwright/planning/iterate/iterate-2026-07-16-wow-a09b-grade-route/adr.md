# Iterate ADR — A09b: read-only Grade server route + client wiring (FR-01.53)

Campaign: webui-wow-usability-2026-07-10 · sub_iterate: A09b · run_id:
iterate-2026-07-16-wow-a09b-grade-route · change_type: feature ·
complexity: medium (risk floor; parent A09 keyword-classified "large" — this is
the pre-decomposed Grade half, the split IS the de-escalation) ·
risk_flags: touches_io_boundary, touches_public_api.

## Decision
Wire the Intent-Wizard Grade door to the REAL `shipwright-grade` plugin via a
READ-ONLY server route (`POST /api/wizard/grade`) that runs
`python grade.py <target> --format json` injection-safely and returns the real
`ReportModel`, replacing A08's client stub. Grade registers no project and writes
nothing. Every grade.py outcome maps to an honest state; an underivable
dimension stays `n/a` with no client fill (AC5).

Server: `core/grade-target.ts` (validate + resolve) + `core/grade-runner.ts`
(spawn + outcome map) + `routes/grade.ts` (thin HTTP). Client:
`useGradeReport.ts` (fetch + shape-guard + state map) + `GradeResult.tsx` (real
render + honest states) + `GradeDimensionRow.tsx` (0..1→0..100 scale fix).

## Confidence Calibration (Step 3.8 — touches_io_boundary → MANDATORY)
Boundary: grade.py `--format json` (producer) → client `reportShape` +
`GradeResult/GradeDimensionRow` (consumer). Empirical probes RUN against real
grade.py (not mocked):

- Probe 1 — authoritative round-trip (real `grade.py <this repo> --format json`):
  exit 0, valid JSON, schema_version 1.0, 7 dims all `ok`. **Finding:** dimension
  `score`/`weight` are 0..1 FRACTIONS (0.935, 0.25), NOT 0..100 — the A08
  renderer assumed 0..100 (`${score}/100`, `${weight}%`), so real data would
  render `0.935/100` + a 0.9%-wide bar. → FIXED (scale ×100 in GradeDimensionRow;
  stub aligned to 0..1). Top-level `score` confirmed 0..100 (97.4) — GradeRing
  unchanged.
- Probe 2 — cold-repo round-trip (real grade of a fresh git repo, no .shipwright):
  exit 0, grade "?", `score: null`, all 7 dims `status:"n/a"` + `score:null`,
  `network_enabled:false`, empty enrichments. → confirms the n/a null pass-through
  end-to-end; the client renders "n/a" with no fabricated number.
- Probe 3 — target-error (`grade.py C:/nonexistent`): exit 2, stderr
  `path does not exist` → maps to grade-failed. Engine-unavailable (exit 3)
  reproduced before setting `SHIPWRIGHT_GRADE_COMPLIANCE_ROOT`.
- Probe 4 — argument-injection (`grade.py --format json -- <target>`): the `--`
  separator makes a `--no-clone`-style target a positional path (exit 2 target
  error), NOT a flag; without `--`, `--help-me` is an argparse option (exit 2
  usage). → drove the `--` end-of-options fix.

Asymptote: two consecutive probes after the scale fix found no further render
bug (authoritative + cold both render correctly). Edge not probed: a private-repo
remote clone needing gh auth (grade.py degrades to a local grade — its own
policy, not ours) — acceptable, grade.py owns the network policy.

## Self-Review (Step 3.6 — always)
1. Spec Compliance — PASS. Read-only route runs grade.py `--format json`; real
   ReportModel rendered with n/a pass-through; honest states for every outcome;
   no registration/writes; only /wizard/grade baseline moves; FR-01.53 allocated.
2. Error Handling — PASS. Every grade.py exit (0/2/3/-1/124/other) + non-JSON +
   invalid target maps to an honest state; client maps every server outcome +
   a network failure to an honest GradeReportState (never a fabricated card).
3. Security Basics — PASS. shell:false + fixed python binary + `--` +
   lone-positional target (shell AND argument injection defeated); target
   validated (empty/oversized/NUL/implausible-URL/credentials/SSRF-host/missing-dir)
   before spawn; read-only; reasons echo only user input, never raw stdout.
4. Test Quality — PASS. New RED-able tests cover validation, resolution, all
   outcomes, argv injection-safety, SSRF, route HTTP mapping, client state
   mapping, n/a pass-through, honest states, synthesized-score rejection.
   Subprocess mocked in CI.
5. Performance Basics — PASS. execFile async (event loop free); 120s timeout +
   16MB maxBuffer bound a hung clone / verbose output; grade is a rare
   user-initiated op, so the 3-probe python resolve is negligible.
6. Naming & Structure — PASS. grade-target / grade-runner / grade route — a
   cohesive split, all <300 LOC; mirrors readiness-probe + pr-status discipline.
7. Affected Boundaries (ADR-024) — PASS. Producer/consumer identified; a REAL
   round-trip probe run (see Confidence Calibration), caught + fixed the scale bug.

## External-Plan-Review-Findings (Step 3.5 — openrouter, gemini + openai)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G1 | HIGH | Argument injection via leading-dash target (`--no-clone`) | accepted-and-fixed — `--` end-of-options separator + reordered argv (probe-verified) |
| G3/O3 | MED | Path/URL validation branch collision (URL fails dir stat) | rejected-with-reason — validation forks on looksRemote FIRST; a URL never hits statDir |
| O6/G2 | MED | SSRF / DoS via remote clone | accepted-and-fixed — credential-URL + loopback/private/link-local/CGNAT host block; 120s timeout + 16MB maxBuffer already bound clone |
| G4 | LOW | python resolve per request | rejected-with-reason — grade is a rare minute-scale op; 3 fast `--version` probes negligible; caching adds staleness |
| G5/O8 | LOW/MED | move shape guard server-side | rejected-with-reason — reportShape is the client cross-repo contract guard (ADR-045); a server mirror crosses the package boundary (DO-NOT #7); server does a JSON-object check (defense-in-depth) |
| O1/O2 | HIGH | "Grade must launch /shipwright-grade via terminal" | rejected-with-reason — grade.py is a pure Python tool (verified, NOT Claude); the read-only route is the brief-specified design; terminal-launch is for Claude sessions (New/Adopt); GradeRequest.actionId=null encodes "not a task" |
| O4 | HIGH | Grade→Adopt underspecified for a URL | rejected-with-reason — A09a's AdoptResult already gates a remote adopt ("clone first", disabled CTA) |
| O9 | MED | stale/duplicate grade requests | rejected-with-reason — React Query keys on the target; a target change switches cache entries, so an in-flight old response can't overwrite the new |
| O10 | MED | repair command misleading/unsafe | rejected-with-reason — the repair command is the readiness CONSTANT, never generated from target/cache/stderr |

## External-Code-Review-Findings (Step 3.7 — openrouter; gemini garbled/no findings, openai)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| O1/O2 | HIGH | Grade must launch /shipwright-grade via terminal; tests only cover API | rejected-with-reason — same as plan O1/O2; grade is API-driven by design (pure Python tool) |
| O3 | HIGH | SSRF: remote validation permits internal hosts (169.254.169.254) | accepted-and-fixed — hostIsBlocked() blocks loopback/private/link-local/CGNAT IP literals + localhost |
| O4 | MED | AC7: New/Adopt launching-state baselines not covered | rejected-with-reason — out of scope; A09b owns ONLY the grade baseline per the brief; New/Adopt are A09a (merged) |
| O5 | MED | AC4: grade wire-outcome type declared locally, not in contract | accepted-partial — exported `GradeServerOutcome` from useGradeReport so it's one declared shape; not moved into contract.ts (at 300-LOC limit; server mirror can't cross the package boundary) |

## Review markers
- reviews.plan: completed (openrouter, 2 actionable fixes applied)
- reviews.self_review: completed (7/7 pass)
- reviews.code (internal cascade): delegated_to_orchestrator (runner has no Agent tool)
- reviews.external_code: completed (openrouter, 1 HIGH SSRF fix applied)
- reviews.confidence_calibration: completed (4 real probes; asymptote reached)
