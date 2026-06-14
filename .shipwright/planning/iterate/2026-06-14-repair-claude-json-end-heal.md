# Iterate: repair-claude-json end-heal (deploy self-heal timing fix)

- **Run ID:** iterate-2026-06-14-repair-claude-json-end-heal
- **Intent:** BUG (timing defect in the deploy self-heal). Spec Impact: NONE
  (deploy-ops tooling only; no product FR; webui runtime/API/UI unchanged).
- **Complexity:** small (classifier: small, prior_source=history). No risk flags.

## Problem (the bug)

PR #136 added `scripts/repair-claude-json.mjs` and wired it as **Step 0** of
`scripts/start-server-production.ps1` — i.e. **before** the build and the
server-kill. But the corruption it is meant to heal is caused **by the deploy
itself**: when the script force-kills the old Hono server (step 2), every
embedded-terminal `claude` child dies simultaneously and the racing
shutdown/restart writes to the **non-atomic, unlocked** `~/.claude.json` leave a
truncation-tail (a valid shorter object + the leftover tail of an older, longer
version). That damage happens **~13 s after** the Step-0 guard run, so Step 0
can only ever heal corruption left by a **previous** deploy — never the
corruption **this** deploy causes.

### Root cause (empirically confirmed 2026-06-14)

- The file was **valid before** the deploy (Step-0 guard reported no corruption)
  and **corrupt immediately after**; the corruption mtime coincided with the
  server-kill step.
- All running `claude` were single-version **2.1.177** → the earlier
  mixed-version theory is **disproven**: same-version concurrent writes are
  sufficient to produce the truncation tail.
- Webui is a read-only observer of `~/.claude/` and never writes the file — the
  real fix is upstream (the CLI must write `~/.claude.json` atomically +
  lock-guarded). Webui can only self-heal.

## Fix (scope of this iterate)

Invoke the existing, tested guard a **second** time at the **end** of
`start-server-production.ps1`, inside the `if ($up)` success branch — after the
"server is up" confirmation. At that point the old embedded `claude` are dead
and a UI reload has not yet spawned new ones: a clean heal window. The Step-0
run is **kept** (it still heals a previous deploy's leftover corruption). The
Step-0 comment is corrected to state the two-phase rationale.

Both invocations keep the existing **best-effort** contract: wrapped in
`try/catch`, exit code discarded (`$global:LASTEXITCODE = 0`), never gating the
deploy. The repair helper (`repair-claude-json.mjs`) is **unchanged** — this
iterate only adds a second invocation point.

The deployed guard already heals this exact signature correctly (dogfood-verified
2026-06-14: discarded 607 trailing bytes, atomic temp+rename, backup made).

**Residual risk (out of scope):** a later UI reload that spawns several sessions
at once can still collide. Root cause is upstream; tracked as a known limitation
in the step-5 comment.

## Affected Boundaries

| Boundary | Direction | Probe |
|---|---|---|
| `start-server-production.ps1` ↔ `repair-claude-json.mjs` (deploy wiring) | invocation count + ordering | static structural test over the PS1 text |

The `~/.claude.json` read→repair→write round-trip itself is **not** touched
(already covered by `repair-claude-json.test.mjs`). No HTTP route, store, WS
handler, or client code changes.

## Test plan (RED → GREEN)

New `scripts/start-server-production.test.mjs` (node:test, same convention as
`repair-claude-json.test.mjs` / `kill-targets.test.js`) reads the PS1 text and
asserts:

1. `repair-claude-json.mjs` is invoked **≥ 2** times (start + end). — *RED before fix*
2. The **first** invocation precedes the build (Step 0).
3. The **last** invocation runs **after** the server-kill (heals THIS deploy). — *RED before fix*
4. The **last** invocation runs **after** the server-up confirmation (clean window). — *RED before fix*
5. The deploy structure markers (`npm run build`, "Stopping the old server",
   server-up line) are present — guards 2-4 from silently passing on a refactor.

Prose mentions of the script in comments are excluded from the invocation count
(comment-line filter) so the count reflects real invocations only.

## Confidence Calibration (voluntary — Advisory at small, no `touches_io_boundary`)

- **Boundaries touched:** the deploy script's wiring to the repair helper
  (invocation count + position). No JSON round-trip logic changed.
- **Empirical probes run:**
  1. RED→GREEN — the new structural test fails on the unchanged script (1
     invocation, none after the kill) and passes after the second invocation is
     added. **Finding:** the bug (single, pre-kill heal) is precisely captured.
  2. PowerShell AST parse (`[Parser]::ParseFile`) — **Finding:** 0 syntax errors
     after the edit; the new block nests correctly inside `if ($up)`.
- **Test Completeness Ledger:** see F5 `test_completeness` block — every
  testable behaviour is `tested`; 0 untested-testable.
- **Confidence-pattern check:** depth — the AST-parse probe found nothing new
  (asymptote). Breadth — all observable behaviours of this diff (invocation
  count, both orderings, marker presence, syntactic validity) are covered.
  Composition — N/A (no cross-component framework machinery).
