# Iterate ADR — iterate-2026-07-10-launch-resume-on-jsonl (D18)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D18 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive — the spec
designates STANDARD; D01–D17 identical) · Type: bug (spec_impact: none).
Findings: F14 (MEDIUM), F28 (LOW).

## Change summary
Two launch branches decided fresh-launch vs resume from the STALE persisted
`firstJsonlObservedAt` instead of disk ground-truth, so a launch issued while
the pre-bound `<uuid>.jsonl` already existed re-emitted `--session-id` and
Claude rejected it with "Session ID already in use".

- `server/src/external/launch/master-run-branch.ts` (F14) — before the fresh
  `/shipwright-run` path, probe on-disk JSONL existence for the master uuid
  (`jsonlExistsOnDisk`, short-circuited when the stamp is already present). When
  established (persisted OR disk), build `claude --resume <masterUuid>` (no slash
  command) and stamp `firstJsonlObservedAt` on first discovery. Fixes the ~5-15 s
  first-write window where the board CTA sends `resume:false`.
- `server/src/external/launch/phase-task-branch.ts` (F28) — after full
  phase_task validation, emit `resume:true` (dropping the slash command — Claude
  already holds the phase conversation) when the phase uuid's JSONL exists;
  stamp on discovery. Fixes re-Continue after a pre-claim crash (phase_task still
  `awaiting_launch`).
- `server/src/external/launch/routes.ts` — new optional `jsonlExistsOnDisk` dep
  on `LaunchRouterDeps`, passed to both branches.
- `server/src/external/routes.ts` — wire `jsonlExistsOnDisk` from
  `watcher.findByUuid(uuid) !== null` (filename-first, CLAUDE.md rule 3).
- `client/src/hooks/useLaunchMasterRun.ts` + `MasterRunLaunchButton.tsx` (F14
  label) — new shared `masterShadowIsEstablished()` predicate derives resume /
  CTA-label from `firstJsonlObservedAt` OR the LIVE `lastJsonlSeenMtimeMs`
  overlay (GET /tasks, ADR-102), so the label flips to "Resume" the instant the
  transcript hits disk — matching the server's disk-truth launch decision.
- New `server/src/external/launch/resume-on-jsonl.test.ts` — the AC2 regression
  (real SessionWatcher + real on-disk jsonl through `createExternalRoutes`); a
  cohesive sibling because the two natural homes are anti-ratchet-blocked
  (`phase-task-launch.test.ts` is grandfathered at 383/300 — growing it ratchets
  the baseline; H3 HIGH).

Invariants preserved: rule 1 (launcher only builds command strings; webui never
spawns Claude); rule 9 (`--plugin-dir` re-passed on the resume shape too —
asserted in the new test); read-only-observer rules 1/12 (no run_config / JSONL
writes). Legacy new-plain resume semantics UNTOUCHED — the fix is localized to
the two branches, so `routes.launch-newplain-resume.test.ts` stays a green pin.

## Self-Review (7-item)
1. Spec Compliance — PASS. Both branches probe disk via `SessionWatcher.findByUuid`
   (the mechanism the new-plain memory already trusts) and emit `--resume`
   regardless of the client flag, stamping `firstJsonlObservedAt` on discovery —
   matches the Fix direction verbatim. Client CTA label aligned. Footprint honored
   (spec files + 1 sanctioned bloat-split sibling test).
2. Error Handling — PASS. `jsonlExistsOnDisk` is optional (`?.`) → absent probe
   degrades to "no JSONL" (existing behavior). `findByUuid` already swallows fs
   errors → null (torn-read retry). No new throw paths; dryRun still returns
   before persist.
3. Security Basics — PASS. The probe resolves only the server-bound task uuid
   under the fixed `~/.claude/projects` root — no client-supplied path, no
   traversal (CLAUDE.md rule 3/10). No new inputs, auth, or secrets.
4. Test Quality — PASS. AC2 proven RED on pre-fix (both F14 + F28 emitted
   `--session-id`; captured via `git stash` of the 4 source files) then green.
   Regression pins (no-jsonl → fresh `--session-id` + slash command), rule-9
   plugin-dir survival on resume, and a repeated-launch idempotency case all
   covered. Client live-mtime label/resume alignment covered.
5. Performance Basics — PASS. One extra `findByUuid` walk per launch ONLY when
   the persisted stamp is absent (`||`/`&&` short-circuit); it reuses the same
   single-dir scan the transcript endpoint already runs. No loops added.
6. Naming & Structure — PASS. `jsonlExistsOnDisk` / `masterShadowIsEstablished`
   read true; control flow < 3 levels; no dead code. All touched source < 300 LOC;
   no baseline ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = Claude's `<uuid>.jsonl` on
   disk; consumer = the launch route's resume decision. Real round-trip probe run
   (real jsonl written to a temp projects dir → real SessionWatcher → launch route
   → `--resume`). See Calibration.

## External Plan Review (Step 3.5, openrouter: openai + gemini) — findings merged
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | HIGH (gem) / MED (oai) | New test file + `external/routes.ts` edit outside the footprint (AC4) | rejected-with-reason. `external/routes.ts` is the SOLE composition point holding the watcher — wiring the probe there is unavoidable and additive (1 block). The new cohesive test is REQUIRED: the two listed homes are anti-ratchet-blocked (`phase-task-launch.test.ts` 383/300 grandfathered → growing it ratchets the baseline, hook-blocked). Serial iterate #18 → zero parallel-safety cost. Mirrors the sanctioned D07 split. |
| B | HIGH (oai) | Stamping `firstJsonlObservedAt` on launch → concurrent double-stamp / duplicate launch | accepted-mitigated. Stamp is CONDITIONAL (`!firstJsonlObservedAt`); two concurrent requests write the same field with near-identical values (harmless) and both emit `--resume` (idempotent, the finding concedes duplicate-resume is benign). The route's O20 guard already rejects re-launch on `done`. Added a repeated-launch idempotency test. NOTE: the plan review said DROP the stamp; the CODE review (below) + the spec Fix direction MANDATE it — spec wins. |
| C | MED (both) | SRP: a command-builder branch should not write state | accepted-clarified. The branch stays a PURE function returning `{commands, taskUpdate}`; the ROUTE persists (unchanged pattern — the branches already returned taskUpdate). No new write channel. |
| D | MED (oai) | Client label "eventually consistent", not exact disk truth | accepted-scoped. Server is authoritative (probes disk every launch); the label is best-effort via the LIVE `lastJsonlSeenMtimeMs` overlay + self-corrects on the next poll. Objective narrowed to best-effort alignment; label is pure-derived per render (no sticky state). |
| E | MED (oai) | "JSONL exists" too loose (zero-byte/stale) | accepted. Uses the IDENTICAL `findByUuid` existence criterion the established new-plain resume path trusts; not a weaker signal. |
| F | MED (oai) | Slash-command drop on resume is broader than a flag swap; assert parity | accepted-and-fixed. Added an explicit rule-9 assertion that `--plugin-dir` survives on the resume shape; resume shape matches the legacy `--resume` (no slash command). |
| G | LOW (oai) | Optional dep = unnecessary abstraction; pass the watcher | rejected-with-reason. A narrow `(uuid)=>Promise<boolean>` keeps the command-builder branches decoupled from the concrete `SessionWatcher` (unit-tested in isolation); both branches consume it. |
| H | LOW (oai/gem) | Security (arbitrary path scan) / client type presence | accepted-verified. Probe uses server-bound uuid + fixed projects root; `lastJsonlSeenMtimeMs` already on `ExternalTask` (externalApi.ts:63) — builds green. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | HIGH (gem) / MED (oai) | Fix direction mandates stamping `firstJsonlObservedAt`; the first draft (post-plan-review) DROPPED it | accepted-and-fixed. RESTORED the conditional stamp in both branches + added store-readback assertions to the test. Resolves the direct spec/AC1 violation; supersedes plan-review finding B's "drop" suggestion (spec is authoritative). |
| 2 | MED (oai) | Test doesn't assert the stamp side-effect | accepted-and-fixed. Added `store.get(...).firstJsonlObservedAt` truthy assertions for both master-run + phase-task. |
| 3 | LOW/MED (oai) | New test file not in footprint / newplain pin not extended | rejected-with-reason (footprint: same as plan-review A). The newplain resume suite is an UNCHANGED green regression pin — the localized fix never touches that path, so it needs no new assertions to keep pinning. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(orchestrator runs the spec-reviewer → code-reviewer cascade over the pushed diff
before merge).

## Confidence Calibration (Step 3.8, medium + touches_io_boundary)
Boundary: Claude's `<uuid>.jsonl` on disk (producer) → the launch route's
resume-vs-fresh decision (consumer), via `SessionWatcher.findByUuid`.
Probes run:
1. RED-first round-trip (committed, `resume-on-jsonl.test.ts`): a REAL jsonl
   written to a temp projects dir → REAL SessionWatcher → REAL
   `createExternalRoutes` launch route. Pre-fix (4 source files stashed): F14
   master-run + F28 phase-task both emitted `--session-id` (RED, 2 failed / 2
   regression-pins passed); post-fix both emit `--resume` (green).
2. Rule-9 parity probe: on the resume shape, `--plugin-dir '/plugins/shipwright'`
   is re-passed (asserted) — the resume path does NOT drop plugin dirs.
3. Idempotency probe: two back-to-back masterRun launches on an established
   master both stay `--resume` (no duplicate `--session-id`), and the store
   carries `firstJsonlObservedAt` after discovery.
4. Negative-control probe: with NO jsonl on disk, both branches emit the fresh
   `--session-id` (+ slash command) byte-shape — proving the probe does not
   over-fire.
Findings: probe 1 found the pre-fix bugs (RED → fixed). Probes 2-4 found no new
issues. Two consecutive clean probe rounds (post-fix full launch suite 74/74 +
the negative controls) → asymptote reached, boundary calibrated.
Edge cases not probed + why acceptable: a zero-byte/torn `<uuid>.jsonl` — the
probe reuses `findByUuid`, whose torn-read retry already governs this and which
the established new-plain resume path already trusts; a truly concurrent
two-process launch race — the stamp is a conditional idempotent field patch on
the existing store-persist path (covered by the F08 merge-under-lock suite); the
display-only board label when the `lastJsonlSeenMtimeMs` overlay lags a poll —
cosmetic (the server still emits the correct `--resume`), self-corrects next poll.
