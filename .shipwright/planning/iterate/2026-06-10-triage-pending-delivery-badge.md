# Iterate Spec — Pending-delivery badge for outbox-only triage items (D4 capstone)

- **run_id:** `iterate-2026-06-10-triage-pending-delivery-badge`
- **Intent:** CHANGE (Spec Impact: MODIFY — FR-01.30 Triage Tab)
- **Complexity:** medium (Stage-2 escalated from classifier `small`; locked)
- **Risk flags:** `touches_public_api` (GET /api/triage/:projectId response shape gains a field), `touches_io_boundary` (JSONL outbox residence read; Python↔TS wire-contract parity fixture producer/consumer) → Boundary Probe + Confidence Calibration mandatory. UI touched → F0.5 `surface = web` mandatory.
- **FR:** FR-01.30 (Triage Tab) MODIFY. Relates to ADR-101 / ADR-106 and the monorepo campaign `2026-06-08-triage-outbox-delivery` (anchor `trg-94f70926`).
- **Follow-up to:** monorepo PR #177 (`triage_cli.py list --json` contract, merged 2026-06-10, item `trg-e2a0ebb3`) and webui PR #117 (TS union reader + residence-derived writes). This iterate is the remaining slice of "the real D4": the WebUI *reads* the union since #117 but gives the user **no way to tell** which open items are outbox-only (pending delivery), and no assurance that the Fix/Start CTAs act on them.

## Think Before Coding (Karpathy)

**Problem.** A freshly-created triage item (manual `triage_add` or an idle-main background producer) lands in the gitignored per-tree buffer `.shipwright/triage.outbox.jsonl`. Since #117 the WebUI *renders* it (union read), but it is indistinguishable from tracked items. The user cannot see that the item is not yet durable in the tracked log and "ships with the next iterate" — the exact chicken-and-egg UX gap this request names. The canonical contract for this distinction now exists: monorepo `triage_cli.py list --json` emits each open item with `pendingDelivery: bool` (TRACKED-PREFERRED: an id present in BOTH files is NOT pending — parallels `triage.mark_status` residence).

**Decision.** Surface `pendingDelivery` in the WebUI as a route-level enrichment + client badge, **parity-gated against the real CLI**:

1. **Server enrichment, not store field.** `readAllItems()` is parity-tested byte-for-byte against Python `read_all_items()`, which does NOT emit `pendingDelivery` (only the CLI list layer adds it). Mirroring the Python layering — and the existing `campaignSlug` FR-01.33 precedent — `pendingDelivery` is computed at the GET route via a new `core/triage-enrich.ts` helper: `pendingDelivery = appendIds(outbox).has(id) && !appendIds(tracked).has(id)` using the existing `appendIdsInFile` (TS mirror of `_append_ids_at`) + `outboxPathFor`.
2. **Single source of truth = the CLI, enforced by an executable parity gate.** `server/scripts/regen-triage-fixtures.py` gains a third gate that runs the REAL `triage_cli.py list --json` (subprocess, discovered like `triage.py`) over the staged union fixtures and writes `triage-union-cli-list.json`. A vitest parity test asserts `enrichPendingDelivery(filterTriage(readAllItems(...)))` deep-equals that fixture. The WebUI thereby *consumes the contract* (generated from the canonical binary) instead of free-handing a re-implementation — drift in either direction fails CI when the fixture is regenerated, exactly like the #117 union gate.
3. **Anti-ratchet compliance by extraction.** `routes/triage.ts` is grandfathered at 763/763 — it may not grow. The route-local `enrichWithCampaignRefs` moves verbatim into the new `core/triage-enrich.ts` (it consumes only the injected `listCampaignRefs` — the campaigns-no-triage-coupling import boundary is preserved), so the route file gets a net NEGATIVE delta while gaining the one enrichment call.
4. **Client badge.** New `PendingDeliveryBadge` pill in `TriageBadgeUI.tsx` (amber, label `pending delivery`, `title` tooltip: "Not yet in the tracked triage log — ships with the next iterate PR"). Rendered in `TriageItemCard` (the list surface where the chicken-and-egg gap bites) and in the `TriageDetailModal` header chips. The modal is grandfathered 374/374; the +2-line growth is taken as an in-commit baseline bump with this iterate's ADR recorded in the entry's `adr` field (the field exists for exactly this), unless a clean net-zero compensation presents itself during build.
5. **CTA assurance, not CTA change.** Fix-now builds its intent purely from item fields (`fixNowIntent.ts` — no residence gating) and the #117 residence-derived writer already routes dismiss/snooze/promote of outbox-only items to the outbox. So the CTAs already *work*; this iterate adds regression tests pinning that (route test: mutation on a pendingDelivery item; client test: Fix-now enabled on a pendingDelivery item) rather than new CTA code. Do NOT route manual items straight to the tracked log — that would reintroduce the main-tree drift the outbox exists to prevent (explicit user constraint).

**Alternatives considered.**
- *WebUI shells out to `triage_cli.py list --json` at request time.* Rejected: spawns `uv run` Python per poll per project (the Triage tab polls; the all-projects counts fan out), adds a hard runtime dependency on the plugin cache being resolvable from the server process, and contradicts the repo's established #117 architecture (TS port + executable parity fixture). The parity-gate approach keeps the CLI canonical (the fixture is *generated by running it*) at zero request-time cost.
- *Set `pendingDelivery` inside `readAllItems`.* Rejected: breaks the byte-for-byte parity contract with `read_all_items()` (which never emits the field) and muddles the Python layering (resolver vs list-surface enrichment).
- *Badge only, no parity gate.* Rejected: two free-hand implementations of TRACKED-PREFERRED residence (CLI + route) would drift silently — the exact failure class the union gates exist to prevent.

## Acceptance Criteria

- **AC1 — Wire field.** `GET /api/triage/:projectId` annotates every item with `pendingDelivery: boolean`; `true` iff the item's `append` lives only in `.shipwright/triage.outbox.jsonl` (TRACKED-PREFERRED: present in both files → `false`).
- **AC2 — CLI parity.** On the staged union fixtures, the TS open-items projection with enrichment deep-equals the output of the real `triage_cli.py list --json` (new fixture `triage-union-cli-list.json`, generated by the extended `regen-triage-fixtures.py` running the actual CLI). Fixture inputs already cover all three residence classes among open items: `trg-track001` tracked-only → false, `trg-dup003` both → false, `trg-out201` outbox-only → true.
- **AC3 — Badge.** Outbox-only open items show a `pending delivery` badge in the Triage list card and the detail modal, with the ships-with-next-iterate explainer (tooltip). Tracked and both-files items show no badge.
- **AC4 — CTA on pending items.** Fix-now is enabled and builds its intent for a `pendingDelivery` item (client test); a status mutation on an outbox-only item still residence-routes to the outbox leaving tracked untouched (route-level regression test pinning #117 behavior through the enriched GET).
- **AC5 — Regression fence.** Existing single-file and union parity gates still pass; `readAllItems()` output shape is unchanged (no `pendingDelivery` at store level); campaign enrichment (`campaignSlug`/`campaignStatus`) behavior is unchanged after the move to `core/triage-enrich.ts`; `routes/triage.ts` LOC ≤ 763.
- **AC6 — E2E (author + execute).** A Playwright flow seeds a project with tracked+outbox triage files, opens the Triage tab, asserts the badge renders for the outbox-only item only, opens the modal, and asserts Fix-now is enabled. Executed against the dev stack (F0.5 `surface = web`).

## Known limitation (unchanged, documented in #117)

Mutating an item that lives only in the outbox when NO tracked `triage.jsonl` exists at all still returns 404 (route existence-guard + lock target). Out of scope here for the same anti-ratchet/extreme-edge reasons recorded in the #117 spec.

## Affected Boundaries

- `GET /api/triage/:projectId` response shape (public API) — additive optional field.
- `.shipwright/triage.outbox.jsonl` / `.shipwright/triage.jsonl` — read-only residence probe (append-id sets); no write-path changes.
- Python↔TS wire parity: new executable fixture generated by the real `triage_cli.py list --json`.
- `shipwright_bloat_baseline.json` — `routes/triage.ts` shrinks (no bump); `TriageDetailModal.tsx` +2 with ADR-recorded bump if not compensated.

## Mini-Plan

1. **RED:** extend `regen-triage-fixtures.py` (gate 3: subprocess the real CLI) → generate `triage-union-cli-list.json`; write failing vitest parity test for `enrichPendingDelivery`; failing route test for AC1/AC4; failing client tests for badge + Fix-now-enabled (AC3/AC4).
2. **GREEN:** add `core/triage-enrich.ts` (move `enrichWithCampaignRefs` verbatim + add `enrichPendingDelivery`); wire both into the GET route (net-negative delta on `routes/triage.ts`); add `pendingDelivery?: boolean` to both `TriageItem` types; add `PendingDeliveryBadge` + render in card/modal.
3. **REFACTOR/VERIFY:** Boundary Probe (round-trip vs live CLI on a scratch project); full suites server+client; typecheck+lint; author+execute Playwright flow; F-phases.

## External Review Response (OpenAI + Gemini via OpenRouter, 2026-06-10)

Both reviewers: approach sound. Findings adopted into the build:

| # | Finding | Disposition |
|---|---|---|
| OAI1 | optional-vs-always contract mismatch | Route sets a concrete boolean on EVERY item (AC1 test asserts no `undefined`); TS type stays `?: boolean` for store-level absence (campaignSlug precedent); client renders via strict truthiness |
| OAI2/Gem4 | residence key ambiguity | Key = the triage item id (`trg-…`) from append events, identical to Python `_append_ids_at`; documented in helper + pinned by the `trg-dup003` both-files fixture case |
| OAI3/OAI10 | CLI subprocess fragility/security in regen | Regen stays developer-only (fixtures committed; CI never regens); discovery confined to the same 3 known roots as `triage.py`; resolved path logged; hard error (no silent stale fixture) |
| OAI4/Gem1 | per-poll I/O cost | Residence sets built once per request AND mtime-memoized in `triage-enrich.ts` (mirrors the store cache); steady-state poll cost = 2 `stat()` calls |
| OAI5 | parity-projection brittleness | Parity test compares exactly the CLI projection: open items + `pendingDelivery`, campaign enrichment NOT applied in that test (separate helper, separately tested) |
| OAI6 | badge could disturb existing CTA/layout | Regression assertions: tracked item has NO badge; existing Fix-now tests stay green; modal header chip row test |
| OAI7/Gem2 | missing-file ENOENT | `appendIdsInFile` → empty set on missing file (verify; else fix); route tests for missing-tracked / missing-outbox return correct booleans, no 500 |
| OAI8 | other consumers of the route shape | Grep for mocks/snapshots/storybook of `/api/triage` before commit |
| OAI9 | closed items get the field | Intentional: residence is status-independent; one dismissed-item enrichment test; inbox UI renders open items only |
| OAI11/Gem5 | enrich-module coupling / DI binding | Two separate exported helpers with layering comments; `listCampaignRefs` remains an injected plain function (no `this`) |
| OAI12 | tooltip reveals internals | Intentional: Command Center's audience is the repo operator; precise mechanics are the feature; recorded in ADR |
| Gem3 | optional-boolean falsy handling | Badge renders on `item.pendingDelivery === true`-equivalent truthiness; absent → no badge |

## Confidence Calibration

- **Boundaries touched:** `GET /api/triage/:projectId` response shape (public API, additive field); `.shipwright/triage{,.outbox}.jsonl` residence reads; Python↔TS wire parity via the real `triage_cli.py list --json`; `shipwright_bloat_baseline.json` governance (route −35, modal +1 bumped per repo precedent `3def014`).
- **Empirical probes run:**
  - **CLI parity gate (fixtures):** `triage-union-cli-list.json` generated by subprocessing the REAL CLI over the staged union fixtures; vitest deep-equal vs the TS projection — green; all three residence classes pinned (`trg-track001` false / `trg-dup003` both→false TRACKED-PREFERRED / `trg-out201` true). Regen run twice → byte-stable; gates 1+2 outputs unchanged (AC5).
  - **Live round-trip probe (fresh non-fixture data):** scratch project with unicode titles (✨/中文/umlauts), a cross-file snooze (outbox status flip suppressing a tracked item) and a promoted item — real CLI output vs TS `filterTriage(readAllItems)+enrichPendingDelivery` → **DEEP-EQUAL: True** (2 open items, both outbox-only → pending).
  - **Probe finding (real bug, monorepo):** `triage_cli.py list --json` crashes `UnicodeEncodeError` on Windows-cp1252 stdout for non-ASCII items (`ensure_ascii=False` → raw stdout). Root fix belongs in the monorepo CLI (follow-up iterate); webui regen subprocess hardened with `PYTHONUTF8=1` so fixture generation is deterministic on old caches.
  - **Anti-ratchet gate probe:** `anti_ratchet_check.py --worktree --json` → `{"status": "ok", "ratchets": []}` with route 763→728 and modal 374→375 (in-commit bump + run_id `adr`, precedent `3def014`).
  - **Full-suite probes:** server 126 files / 1574+ tests green (incl. the pre-existing `triage-schema-sync` gate that caught the client-mirror gap = external review OAI8 vindicated); client 152 files / 1581 tests green; oxlint + tsc clean both workspaces (only pre-existing warnings in untouched files).
- **Test Completeness Ledger:**

  | Behavior (AC) | Disposition | Evidence |
  |---|---|---|
  | AC1 concrete boolean on every GET item | tested | `triage.outbox-union.test.ts` "annotates every item" |
  | AC1 TRACKED-PREFERRED (both files → false) | tested | route test + `triage-enrich.test.ts` + parity `trg-dup003` |
  | AC1 outbox-only → true / tracked-only → false | tested | unit + route + parity gate + live probe |
  | AC1 missing tracked → true, no 500 | tested | unit + route "NO tracked file" |
  | AC1 missing outbox → false, no throw | tested | unit ENOENT case |
  | Closed items annotated (status-independent, OAI9) | tested | unit "annotates CLOSED items" |
  | AC2 CLI parity (open projection deep-equal) | tested | CLI PARITY GATE + live probe (fresh data, unicode) |
  | Residence memo invalidates on mtime change | tested | unit memoization test (sweep simulation) |
  | Campaign-enrich move regression (rank, no-op, throw-swallow) | tested | `triage-enrich.test.ts` + existing `routes/triage.test.ts` green |
  | AC5 route ≤763 / store output shape unchanged | tested | anti-ratchet gate + existing single-file & union parity gates green |
  | AC3 card badge on `pendingDelivery: true` | tested | `PendingDelivery.test.tsx` card block |
  | AC3 no badge on false/absent (Gem3 falsy) | tested | `PendingDelivery.test.tsx` rerender case |
  | AC3 modal badge + non-pending fence (OAI6) | tested | `PendingDelivery.test.tsx` modal block |
  | AC4 Fix-now enabled + intent emitted on pending item | tested | `PendingDelivery.test.tsx` CTA test |
  | AC4 mutation on outbox item residence-routes (no drift) | tested | existing `triage.outbox-union.test.ts` dismiss test (regression fence) |
  | Server↔client TriageItem field sync | tested | existing `triage-schema-sync.test.ts` gate |
  | AC6 full-stack badge + CTA through real UI | tested | `triage-pending-delivery.spec.ts` authored; EXECUTED at F0.5 (result recorded in `surface_verification`) |
  | Regen gate-3 invocation contract (dev-only tooling) | untestable (`covered-by-existing-test`) | the CI-side protection is the parity gate consuming its committed output (stale/empty fixture ⇒ red); script executed twice → byte-stable; error guards hard-fail loud by construction |

  0 testable-but-untested behaviors.
- **Confidence-pattern check:** depth = asymptote reached (unit → parity fixture → live CLI round-trip → real-route HTTP → full suites; the last three probes found no new failures in MY diff — the one finding was an upstream CLI bug, exactly what a boundary probe is for). Breadth = all four touched surfaces covered (server read path, wire contract, client render+CTA, governance files). Residual risk concentrated in F0.5 E2E execution, which runs next and is fail-closed.
