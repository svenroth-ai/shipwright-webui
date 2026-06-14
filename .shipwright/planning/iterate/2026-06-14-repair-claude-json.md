# Iterate: repair-claude-json (ops deploy self-heal)

- **Run ID:** iterate-2026-06-14-repair-claude-json
- **Intent:** CHANGE (ops self-heal helper) — Spec Impact: NONE (no product FR; deploy-tooling only)
- **Complexity:** small (classifier: small, prior_source=history); voluntarily applying
  the `touches_io_boundary` discipline (round-trip probe + Confidence Calibration)
  because the change is a JSON read→repair→write round-trip over the user's global config.

## Problem

The global `~/.claude.json` repeatedly goes corrupt, time-correlated with the
production deploy (`scripts/start-server-production.ps1`). Every running
`claude` CLI then fails ("settings/config corrupt"). The signature is always
identical: `JSON.parse` → "Unexpected non-whitespace character after JSON at
position N" — a valid, **shorter** JSON object followed by the leftover tail of
an older, longer version (a *truncation tail*).

## Root cause (already diagnosed — not re-investigated)

- Neither the deploy script nor the webui server writes `~/.claude.json`
  (architecture rule: webui = read-only observer of `~/.claude/`).
- `~/.claude.json` is written **only** by the `claude` CLI processes —
  non-atomically, without a lock.
- The Command Center hosts many parallel `claude` sessions (embedded
  terminals), sometimes mixed versions. A deploy force-kills the server → all
  embedded ptys/`claude` die → on reload many `claude` processes start
  ~simultaneously → competing, non-truncating writes → truncation-tail
  corruption. The deploy only *triggers the burst*; it is not the writer.
- This is an upstream Claude Code robustness bug (the file should be written
  atomically + lock-guarded). webui cannot fix the writer — but the deploy can
  heal itself.

## Solution (scope of this iterate)

A small Node ESM helper `scripts/repair-claude-json.mjs` that runs at the very
start of the deploy and repairs a corrupt `~/.claude.json` (with backup) before
server + embedded sessions restart.

Behaviour:

1. Read `~/.claude.json`; absent → no-op, exit 0.
2. `JSON.parse` OK → no-op (no backup, no write), exit 0.
3. Invalid → string/escape-aware brace scan finds the longest valid top-level
   object prefix (first `{` to its matching `}`); the discarded tail is the rest.
   - Validate the candidate prefix with `JSON.parse`.
   - Sanity guard: only overwrite when the candidate parses **and** has a
     plausible structure (≥ 3 top-level keys and contains `"projects"`).
     Otherwise do **not** overwrite.
   - Backup the corrupt original to `~/.claude.json.corrupt-<timestamp>.bak`.
   - Write the repaired file atomically (temp + rename).
   - Prune old backups (keep the last ~10).
4. Not repairable (no balanced top-level object / implausible structure):
   do **not** overwrite, loud WARN, exit ≠ 0.
5. The deploy call is **best effort** — it must never abort the deploy.

Hook: `scripts/start-server-production.ps1` step 0 (before the build), exit code
not gated.

## Mini-Plan

**Chosen approach:** one self-contained `.mjs` exporting pure, testable
functions (`findFirstBalancedObject`, `isPlausibleClaudeConfig`,
`repairJsonText`, `repairFile`, `pruneBackups`) + a thin `main()`/CLI guard. The
sole I/O-boundary parameter is the target path, so `repairFile(targetPath)` is
fully testable against a temp dir without touching the real homedir.

**Alternative considered (rejected):** repair inline in PowerShell. Rejected —
PowerShell has no string/escape-aware JSON brace scanner, the logic would be
untestable with `node --test` (the repo's existing script-test convention, cf.
`kill-targets.test.js`), and cross-platform parity (Git-Bash + PowerShell) is
free with Node.

**File budget:** helper ≤ 300 LOC, test ≤ 300 LOC. PS1 hook = ~2 lines.

## Affected Boundaries

| Boundary | Direction | Probe |
|---|---|---|
| `~/.claude.json` (JSON config file) | read → repair → write | round-trip: corrupt-in → repair → parse-back-out |

The webui runtime is **not** affected — this is deploy-time ops tooling only.
No HTTP route, store, WS handler, or client code changes.

## Confidence Calibration

- **Boundaries touched:** `~/.claude.json` — read corrupt bytes, write repaired
  bytes (atomic temp+rename), write/prune `.corrupt-<ts>.bak` backups.
- **Empirical probes run:**
  1. Round-trip — real truncation-tail signature (valid object + `}` then
     `   "lastUsedNumStartups": 98 … }`) → repaired, only tail discarded,
     re-parses clean. **Finding:** repaired prefix is byte-identical to the
     valid short object; tail fully removed.
  2. String/escape-aware scan — `}` inside a JSON string value and an escaped
     `\"` before a brace must not close the object early. **Finding:** scanner
     ignores in-string braces; object boundary correct.
  3. Sanity guard — a balanced-but-implausible object (`{"a":1}`, no `projects`)
     must NOT overwrite. **Finding:** returns `unrepairable`, file untouched.
  4. Empty/whitespace + pure-garbage + already-valid inputs → no overwrite /
     no-op. **Finding:** no backup, no write. (asymptote: this probe found
     nothing new — area exhausted.)
- **Test Completeness Ledger:** see table below — every testable behaviour is
  `tested`; 0 untested-testable.
- **Confidence-pattern check:** depth — last probe (no. 4) found nothing
  (asymptote reached). Breadth — all 4 behaviours of the diff are covered.
  Composition — N/A (no cross-component framework machinery; single helper).

### Test Completeness Ledger

| Behaviour | Disposition | Evidence |
|---|---|---|
| valid JSON → no-op (no write) | tested | `repairJsonText valid` + `repairFile valid → noop, no backup` |
| truncation-tail → repaired, only tail discarded, prefix byte-preserved | tested | `repairJsonText truncation-tail` + `repairFile real signature round-trip` |
| `}` / escaped quote inside string does not close object early | tested | `findFirstBalancedObject string-aware` + `escape-aware` |
| implausible structure (parses but <3 keys / no projects) → no overwrite | tested | `repairJsonText implausible` + `repairFile unrepairable → file unchanged` |
| garbage / no balanced object → no overwrite | tested | `repairJsonText garbage` + `repairFile unrepairable` |
| empty / whitespace → no overwrite | tested | `repairJsonText empty` + `repairFile empty → noop` |
| absent file → no-op | tested | `repairFile absent → noop` |
| backup created + corrupt original preserved | tested | `repairFile creates backup with original bytes` |
| atomic write leaves valid parseable file | tested | `repairFile round-trip → file parses` |
| prune keeps the newest ~10 backups | tested | `pruneBackups keeps newest 10` |

Counts: testable 10 · tested 10 · untestable 0 · untested_testable 0.
