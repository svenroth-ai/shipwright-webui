# Self-Review

**Note on process:** this iterate was executed by a `fork`-type subagent
(the parent session's own conversation context forked into a background
worker) rather than the top-level session directly. Fork-type agents in this
harness are explicitly barred from spawning further Agent-tool subagents —
so the standing `spec-reviewer` → `code-reviewer` → `doubt-reviewer`
cascade (per this repo's CLAUDE.md standing request) could NOT be run as
separate, fresh-context subagent passes from inside this fork. Per
`feedback_subagent_reviews_are_not_substitutable` (this operator's own prior
guidance: a same-context self-review is not an adequate substitute for a
fresh, unbiased subagent pass), this file is recorded as a same-context
**self-review**, not as a substitute for the cascade — the actual
spec-reviewer/code-reviewer/doubt-reviewer passes are the parent session's
follow-up action (see the fork's final report).

## Spec compliance (spec-reviewer lens)

- Diff matches the iterate spec's stated fix exactly: two sibling one-line
  guard widenings (`ws-upgrade-handler.ts`, `transcript/routes.ts`), no
  unrelated changes. `git diff --stat`: 4 files touched, all either the two
  fix sites or their direct test files.
- Spec Impact NONE is correctly justified — FR-01.74's 4th AC is cited with
  the exact spec.md line range and its text is reproduced verbatim in
  spec.md; verified against the CURRENT file content (not from memory) in
  this session.
- Confidence Calibration section present and populated before F0, per
  path-c-bug.md Step 5.6 requirement.

## Code correctness (code-reviewer lens)

- Root cause (F-debug bug-report.md) traces the value from every write site
  to the one read site that matters (`CodexTaskWatcher.checkTask()`); the
  root-cause statement names the exact wrong discriminator
  (`task.actionId` vs. the correct `task.runtime`).
- Fix is a pure `||`-widening in both spots — cannot suppress the existing
  `new-plain`/Claude branches by construction, not just by test coverage.
- Both fixes are internally consistent with each other: fix 1 makes `active`
  newly reachable for Codex under non-new-plain actionIds; fix 2 makes that
  newly-reachable `active` state properly decay again. Without fix 2, fix 1
  alone would trade "stuck in awaiting_external_start forever" for "stuck in
  active forever once the pty dies" — a different but equally real stuck
  state. This coupling was caught by the external review pass (GLM,
  `--mode iterate`), not by this self-review's first pass — recorded
  honestly rather than presented as if this self-review "resolved it" first.
- Comments updated at both sites explain the *why* (Codex has no Claude
  JSONL under any actionId — the actual precondition — not merely "we
  added a runtime check"), matching CLAUDE.md's "WHY not WHAT" comment
  policy.

## Adversarial pass (doubt-reviewer lens — biased to disprove)

Attempted to break the fix:
- **Could `task.runtime` be undefined/stale for an old task?** `sdk-sessions-store.ts`
  backfills `runtime: "claude"` for pre-Codex-Light tasks with no `runtime`
  field on disk (FR-01.74 1st AC) — so `task.runtime === "codex"` is false
  for any such task, never a false positive.
- **Could this fire twice / double-patch?** No — both guards are gated on
  `task.state === "awaiting_external_start"` / `"active"` respectively;
  once patched, the state check itself prevents re-entry, identical to the
  pre-existing new-plain behavior's own idempotency (already covered by
  the "is idempotent" test in `routes.transcript-newplain-idle.test.ts`,
  unmodified and still green).
- **Could a Claude-runtime task under `actionId` containing "codex" as a
  substring, or any other string trick, accidentally match?** No — the
  check is `task.runtime === "codex"`, an exact string equality on a
  server-controlled, non-freeform field (`patch.ts` validates
  `runtime must be claude or codex`), not a substring/regex match.
- **Could the two fixes disagree with each other under a race (WS attach
  and transcript poll firing concurrently)?** Both are synchronous,
  single-threaded Node handlers operating on the in-memory store; no
  `await` sits between the state read and the `store.patch` call in either
  branch, so there is no interleaving window within a single handler
  invocation. Cross-request ordering (poll happens to run between two WS
  events) can only ever move the task in the SAME direction either fix
  already allows (awaiting→active, active→idle) — no oscillation, no data
  loss, matches the existing new-plain behavior's own tolerance for the
  identical race.
- **Objection not fully resolved:** GLM's residual point that a headless
  Codex launch (one that never opens a WS) would still never leave
  `awaiting_external_start` stands as a real, acknowledged gap — recorded
  in spec.md's Residual Risk section rather than silently dropped, and
  deliberately not fixed here (no evidence such a launch path exists in
  production; inventing a second mechanism for a hypothetical would be the
  "second special case" scope-creep the user explicitly warned against).

## Verdict

PASS, with the one residual risk above explicitly carried forward (not
silently dropped) rather than resolved. No further code changes made in
response to this self-review — it confirmed the diff already reflects the
external review's "revise" feedback (the idle-decay pairing) and found no
new defect requiring another round.
