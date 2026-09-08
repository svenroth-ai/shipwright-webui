# Iterate Spec: lead-inventory-page

- **Run ID:** iterate-2026-09-08-lead-inventory-page
- **Type:** feature
- **Complexity:** medium (overridden from the classifier's `small`/history
  fallback — positive `cross_split` evidence: this change necessarily touches
  both `server/src/external/org` + `server/src/routes` AND `client/src`, plus
  a new cross-repo vendored contract. `touches_auth`/`touches_migrations`
  risk flags the classifier raised off the word "authority" in the run
  description are false positives — verified by Repo Scout below; this
  change touches neither real auth code nor SQL migrations.)
- **Status:** draft

## Goal
The PO opens one page in the morning and sees, per AI lead: last night's
beats with their ordered authority-band steps, the lead's declared authority
ladder (from its charter), any open "needs you" questions (single answer
field, no thread), and a visible warning on any beat whose effect went
unclaimed by its own step log.

## Acceptance Criteria
- [ ] AC-1-agent: `GET /api/org/inventory` for a lead with a closed beat that
  has 2+ `steps.jsonl` entries returns a body whose `[leadId].beats[].steps`
  (`status:"ok"`) `.steps[]` entries are in file order, each carrying `band`
  (one of `bugfix|maintenance|feature|architecture`) — verified by an
  integration test over a fixture `beat-register.json` + `steps.jsonl`.
- [ ] AC-1-user: Opening the Lead Inventory page for a lead with overnight
  activity visibly shows its beats, each step's band as a colored chip, in
  the order they were logged.
- [ ] AC-2a-agent: for a beat whose `audit.jsonl` carries a
  `beat_effect_not_claimed` entry naming that `beat_id`, the composite core's
  matching beat entry has `unclaimedEffect.status === "found"` and the
  rendered `BeatCard` contains an element with
  `data-testid="unclaimed-effect-warning"` and visible warning copy —
  asserted by a component test reading the DOM, not just the data shape.
- [ ] AC-2a-user: A beat that produced an effect no step accounts for shows a
  warning banner directly on that beat's card, not only in a separate log
  view.
- [ ] AC-2b-agent (degrade correctness, from Internal Plan Review finding
  #2): a beat whose `steps.jsonl` fails to read (symlink/non-file/read
  error, not a missing file) is returned as `{status:"unreadable"}` and
  rendered as "steps unavailable" — never "no steps reported", which is
  reserved for a genuinely empty/absent optional contribution
  (`{status:"ok", steps:[]}`). Likewise a beat whose `audit.jsonl` read fails
  is `unclaimedEffect: {status:"unknown"}`, rendered distinctly from
  `{status:"clear"}` (no warning) — never silently rendered as "no warning".
  Both asserted by tests that force the failure path.
- [ ] AC-2b-user: n/a — a correctness/integrity guarantee, not a new visible
  feature; covered by AC-2a's rendering being trustworthy.
- [ ] AC-3-agent: `server/src/vendor/leadwright/beat-step.schema.json`'s
  `required` array, `properties.band.enum` members, and the 3 `effect.oneOf`
  variants (each with its own required fields) — read fresh off disk — match
  hardcoded expectations in `leadwright-beat-step.test.ts` (the same style
  `leadwright-preflight.test.ts` already uses; a byte-diff against a live
  leadwright checkout is not attempted — no such dependency exists here).
  3 fixture records (2 valid — one per non-`none` effect kind — 1 invalid)
  are checked against `isValidBeatStep` and assert the expected
  accept/reject outcome.
- [ ] AC-3-user: n/a (no direct UI signal; covered by AC-1/AC-2a rendering
  correctly at all).
- [ ] AC-4-agent: `GET /api/org/inventory` for a lead whose `charter.md`
  declares only 2 of the 4 §4.4 band headings returns `authority.bands` with
  exactly those 2 marked `declared:true` (each carrying its extracted prose)
  and the other 2 `declared:false` (`text: null`) — verified against a
  fixture charter.md, including the slash-spacing boundary case mirrored
  from `charter-validate.ts`.
- [ ] AC-4-user: The authority panel next to a lead's beats shows the same
  four band words as the step chips, each with that band's own text from the
  charter (or "not declared"), plus a plain completeness line — it never
  claims to show which bands the lead "may act on alone" (Internal Plan
  Review finding #1: no such field exists, and the closest proxy is
  structurally always 4/4 for any lead with beats to show).
- [ ] AC-5-agent: for a lead whose `lead-question-threads.json` has a card
  whose LATEST round carries no `answer`, the "Needs You" section renders
  that card with exactly one `data-testid="needs-you-answer-field"` element
  and zero `data-testid` matches for any round-count/thread affordance —
  asserted by a component test.
- [ ] AC-5-user: An open question from a lead appears under "Needs You" with
  one place to see the question and its (pending) answer state — no chat
  thread, no round counter — plus a link to the full conversation on the
  existing `/org` page for anyone who wants the history. ("Give" the answer
  is out of scope here; see Out of Scope.)
- [ ] AC-6-agent: `npx vitest run` (both workspaces) and `npx tsc --noEmit`
  (both workspaces) are green after the change.
- [ ] AC-6-user: n/a — CI-shaped, not a user-visible behavior.
- [ ] AC-7-agent (window correctness, from Internal Plan Review finding #8):
  a beat with `startedAt` outside the current "last night" window
  (`computeLastNightWindow`) is excluded from `BeatList`'s render; when the
  window-filtered list is empty but the lead has any beats at all (per
  `totalBeatsInRegister`, see AC-8), the page shows an explicit empty state
  naming the window's own start/end times — never a bare blank section. A
  beat with a missing/unparseable `startedAt` is INCLUDED rather than
  silently dropped by either the server-side 48h bound or the client-side
  window filter — fail toward showing more, never toward hiding data.
- [ ] AC-8-agent (from External Plan Review — both reviewers, empty-state
  ambiguity): the composite response carries `totalBeatsInRegister` (a cheap
  count of the full register's `entries.length`, no per-beat hydration) per
  lead, so the client can distinguish "this lead has never had a beat" from
  "this lead has history, just nothing in the current window" — the two
  empty states must render different copy.
- [ ] AC-9-agent (from External Plan Review, both reviewers independently —
  audit-pagination truncation): `beat-effect-audit-read.ts` must never
  produce a false `{status:"clear"}` from a truncated audit read. **Build-time
  amendment (Stage-2 code review MEDIUM-4/5):** the originally-specced
  bounded `before`-cursor pagination (10-page/2000-entry cap →
  `{status:"unknown"}` on cap-hit) was replaced with a single full-file scan
  via the new `readAuditLinesGuarded` — complete coverage by construction,
  no cap and no truncation path to hit at all, which is both simpler (net
  code reduction) and strictly stronger than the specced mitigation. A test
  ("reads the file exactly once regardless of how many lines it contains")
  pins the no-pagination-loop invariant on a 5001-line fixture;
  `{status:"unknown"}` is still produced, but now only on a genuine read
  failure (non-404 error from `readAuditLinesGuarded`), never on line count.
- [ ] AC-10-agent (from External Plan Review, both reviewers — line-level
  collapse): a `steps.jsonl` whose lines are ALL malformed (`steps.length
  === 0 && unreadableLines > 0`) renders as "steps unavailable", never as
  "no steps reported" — that copy is reserved for a genuinely empty/absent
  optional contribution (`unreadableLines === 0`).
- [ ] AC-11-agent (from External Plan Review — GLM, refused beatId /
  predicate pinning): a beat-register entry whose `beatId` fails
  `BEAT_ID_RE` degrades ONLY that beat to `steps: {status:"unreadable"}` (a
  test proves the composite never drops the whole lead or 500s on it); beats
  render `startedAt`-ascending; `NeedsYou`'s "unanswered" predicate is the
  same one `OrgThread.tsx`'s `isAnswered` already uses (`typeof === "string"
  && trim().length > 0`), not a new, divergent check.

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.71 (Organization overview for AI leads) — this is Phase 3
  of the leadwright plan explicitly deferred out-of-scope by
  `iterate-2026-05-14-lead-foundation-task-schema`; per the MINT-vs-FOLD gate
  this extends an existing capability ("operator can see... their AI leads")
  rather than minting a new one, even though it ships as its own route
  (`/org/inventory`) rather than editing `/org` in place — new plumbing off
  an existing FR, not a new FR. New AC bullet **FR-01.71(G)** — no new
  `FR-04.xx` AC-anchor id is minted (Internal Plan Review finding #4: this
  repo's `spec.md` has no `FR-04.xx` FR rows at all — every `FR-04.xx`
  citation here is an explicit cross-repo pointer into **leadwright's own**
  spec, and leadwright's `FR-04.43` already names its heartbeat-daemon FR;
  reusing it here would silently collide with an unrelated capability in
  another repo's namespace).
- **REMOVE:** none
- **NONE justification:** n/a (classification is not solely `none`)
- **Coexistence note:** FR-01.71(D) already ships a full round-history thread
  view for the same `lead-question-threads.json` data on `/org`. This
  iterate's "Needs You" section is a deliberately narrower, single-field view
  of the same data on a different page — it sits ALONGSIDE (D), not a
  replacement for it; the two are cross-linked (see AC-5).

## Out of Scope
- No org-chart editing — this page is a viewer, like `/org` is today.
- No new leadwright API — every field comes from files already on disk or
  already served by existing webui routes (`org-chart.json`, `charter.md`,
  `beat-register.json`, `steps.jsonl`, `audit.jsonl`,
  `lead-question-threads.json`).
- No budget/spend work.
- No terminal button — card W15 owns that. Confirmed via `git log --all`,
  every branch, and `.shipwright/planning/` that W15 has not landed anywhere
  in this repo yet, so the terminal-launch slot on a "Needs You" row renders
  empty rather than a second, competing button.
- No "answer" write path. `lead-question-threads.json`'s `answer` field is
  populated by leadwright's own producer (a human answering through a
  terminal, per the PO's 2026-09-07 decision), never by this page — the
  existing `/api/org/threads` read surface (FR-04.42) is already read-only
  and this page reuses it unchanged.

## Design Notes

**Two interpretive decisions — revised once by Internal Plan Review (see
that section below); recorded here in their final form for the PO to
correct if still wrong:**

1. **Authority panel, not "authority ladder / may act alone."** No field in
   leadwright's schemas or store carries a per-band "may act alone" boolean.
   The first draft of this plan read `lib/charter-validate.ts`'s
   `validateCharterBands` (declared-vs-missing per §4.4 heading) as a proxy
   for that — Internal Plan Review correctly rejected this: that module's
   own header states the band-decision judgment "belongs to whatever reads
   the charter's content at runtime (the lead itself), not to this module,"
   and `lib/beat-start.ts` DENIES a beat outright when any band is missing —
   so any lead with beats to show already has all 4 declared, making a
   declared/missing binary vacuous exactly where the PO would look at it.
   The panel instead extracts and shows each band's own **charter prose**
   (the text under that §4.4 heading, same technique as `role-extract.ts`'s
   line-shape-skip paragraph extraction, scoped per-heading instead of
   whole-document) plus a plain `N/4 declared` completeness line. Same 4
   band words as the step chips (still true — "one vocabulary" holds), real
   information instead of a fabricated authorization signal.
2. **"Needs You" — one answer field, no thread, no write path.**
   `lead-question-threads.json` is genuinely round-based, but the brief is
   explicit ("no thread, no round three") and the existing `/api/org/threads`
   read surface is read-only. This page shows, per card, only its LATEST
   round, and only when unanswered — question text plus a single read-only
   field showing the pending-answer state. Internal Plan Review flagged that
   this reads as a dead end (a visible question with no way to act on it,
   plus an empty W15 slot) and that it silently duplicates FR-01.71(D)'s
   existing full-thread view on `/org`. Resolution: this section links out
   to that existing view rather than trying to replace or half-replicate it
   — "Needs You" is a noticing surface, `/org`'s thread view (and, later,
   W15's terminal) is where anything gets acted on. This reuses
   `useOrgThreads()` unchanged client-side; no new server route for this
   section. **External Plan Review (GLM) additionally flagged the reserved
   empty W15 slot itself as a papercut** — an empty box reads as a broken
   button on day one, and "not rendering it" already carries the same
   commitment as "reserving it" at zero UI cost. Fixed: the slot is omitted
   entirely; W15 inserts its own affordance when it lands.

**Charter path** (Internal Plan Review LOW, re-raised MEDIUM by External
Plan Review/openai): the authority reader compares `org-chart.json`'s
per-lead `charter_path` against the literal `"charter.md"` it can actually
resolve (the shared six-kind allowlist only recognizes that pattern; widening
it to an arbitrary path is a separate, independently-reviewable change
touching two OTHER existing call sites with the identical limitation —
`org-leads-composite.ts`'s `buildRole` and `existing-charters-read.ts`). A
non-default `charter_path` now degrades with an HONEST reason ("custom
charter path not yet supported") instead of silently attempting — and
failing on — the wrong file: a small, safe improvement over the original
plan's blanket disclosure, without expanding the read surface or fixing only
one of three call sites asymmetrically. A repo-wide fix (all three call
sites read `charter_path` for real) is a well-scoped follow-up, not squeezed
into this iterate.

**Vendoring discipline** (matches the W14 setup-wizard precedent exactly,
verified by diffing the existing vendored files against a live leadwright
checkout — they are pinned snapshots, NOT auto-synced): the vendored JSON
(`vendor/leadwright/beat-step.schema.json`) stays byte-identical to its
leadwright source at the pinned commit — no header is added inside the JSON
itself. The source path, leadwright commit, and PR provenance are named in
the accompanying hand-typed mirror's header comment
(`types/leadwright-beat-step.ts`), exactly where `leadwright-preflight.ts`
puts the same information for its own vendored pair. **Cross-repo drift
cannot be caught by any test in this repo** — this repo has no build-time
dependency on a leadwright checkout, so a schema change on leadwright's main
after this commit is silent here until a human re-vendors deliberately. The
mirror's header says so explicitly, matching the existing vendored files'
own disclosed-limitation language.

**Composite-endpoint discipline** (matches `org-leads-composite.ts` /
`org-threads-composite.ts` precedent, corrected once by Internal Plan Review
finding #3 — the first draft inverted this precedent into a per-lead route
with an audit-per-beat read): ONE roster-wide endpoint,
`GET /api/org/inventory`, mirrors `/api/org/threads` exactly — one
`org-chart.json` parse for every lead, `audit.jsonl` read once per lead (not
once per beat), beats bounded to a 48h server-side window (not the whole
register history). A per-figure read failure degrades that figure alone —
`{status:"unreadable"}` for steps, `{status:"unknown"}` for the audit lookup,
`{measured:false}` for the authority panel — and is never collapsed into a
positive claim ("clear"/"no steps") the way `org-leads-composite.ts`'s
`registerFieldFor` was already fixed, once, to avoid doing.

**Security posture for the new file readers** (Internal Plan Review
finding #5, sharpened by External Plan Review): `beat-steps-read.ts` and
`beat-effect-audit-read.ts` (via `audit-log.ts`'s `readAuditLinesGuarded`)
mirror `audit-log.ts`'s exact open-first pattern — `pathGuard` →
`open(O_RDONLY | O_NOFOLLOW)` → `fstat().isFile()` → `realPathGuard` → read
from the held fd — closing the ENOENT-via-`realPathGuard`-first bug this
repo already found and fixed once in `file-read.ts`. **Build-time amendment
(doubt review, medium/boundary-and-contract):** this iterate's THIRD new
reader, `registerEntriesGuarded` (`beat-register-health.ts`), originally
retained the OLDER `lstat`-then-reopen-by-path pattern copied from the
pre-existing `beatRegisterHealthCore` (a prior iterate's code, unchanged
here) — a real TOCTOU window the doubt review caught (independently
corroborated by the external code review's codex leg) and which is now
closed: `registerEntriesGuarded` was rewritten to the same open-first shape
as the other two, sharing a new `parseRegisterFileText()` helper with the
pre-existing by-path reader. All three of this iterate's new readers now
share one security posture. Both `leadId` AND `beatId` are re-validated
inside each
reader itself (`LEAD_ID_RE` from `_helpers.ts`; a new `BEAT_ID_RE` —
leadwright generates beat ids via `randomUUID()`) BEFORE either is joined
into a path — never trusting that an upstream caller (`requireChartLead`,
`beat-register.json`'s own `typeof === "string"`-only validation) already
did it, the same re-validate-don't-trust-the-caller posture
`lead-question-threads.ts` documents. A register entry whose `beatId` fails
`BEAT_ID_RE` degrades ONLY that one beat to `steps: {status:"unreadable"}`
in the composite — never the whole lead, never a 500 (AC-11).

**Audit-log pagination bound — superseded by a single-scan rewrite**
(External Plan Review, both reviewers independently, then revisited at
Stage-2 code review): a single `auditLogCore(..., {limit:200})` call can
still produce a false `{status:"clear"}` if the matching
`beat_effect_not_claimed` entry has aged past the newest 200 audit
entries — exactly the fail-open class AC-2b exists to close, surviving
along the pagination axis instead of the read-failure axis. The originally
specced fix — `beat-effect-audit-read.ts` paging (`before` cursor) until it
covered every entry back to the 48h beat-window start, capped at 10 pages
(2000 entries) with a cap-hit degrading to `{status:"unknown"}` — shipped in
Build. Stage-2 code review (MEDIUM-4/5) found the bounded-pagination design
itself still risked a monotonicity violation (an entry found on an earlier
page could be lost if a later page's read failed) and was more complex than
the problem needed: `audit-log.ts` extracted a new `readAuditLinesGuarded`
that returns the FULL reversed line set from one `readFileSync`, and
`beat-effect-audit-read.ts` was rewritten to one linear scan over that
result — no page cap, no truncation path, complete coverage by
construction. `{status:"unknown"}` is now reserved for a genuine read
failure (non-404 error), never for line count or window depth (AC-9).

**Open beats and race safety** (External Plan Review — GLM): the window
filter is `startedAt`-only over ALL beats, open or closed — an in-flight
beat (started overnight, still running) is exactly "what a lead did
overnight" and renders with a small "in progress" label when `closedAt ===
null`, rather than being excluded. Reading a `steps.jsonl` that is
mid-append (the daemon owns a live writer) can hand back a truncated final
line — the tolerant per-line parser already treats that as one
`unreadableLines` increment, not a whole-file failure; a fixture with a
deliberately truncated last line pins this as a test, not an incidental
side effect.

**Beats reporting steps is optional** (`skills/leadwright/SKILL.md` step 5) —
a beat with an empty or absent `steps.jsonl` contribution is a normal,
unremarkable outcome. The UI renders a beat with zero steps as "no steps
reported" prose, never as an error or warning state — only a genuine
`beat_effect_not_claimed` audit entry earns the warning treatment.

**New page, not a section on `/org`.** `/org` already lists one `LeadCard` +
thread list per lead (FR-01.71); this feature adds a materially different
per-lead payload (ordered beats/steps, authority ladder) that would push
`OrgPage.tsx`/`OrgPageContent` past a reasonable size and mixes two
different reading modes (roster-at-a-glance vs. overnight-detail). New route
`/org/inventory`, reached from a "Last night" link on `/org`'s header
(mirrors how `/org/new-lead` is reached from a CTA on `/org`, not a
duplicate top-level nav destination) plus its own nav entry, since — unlike
`/org/new-lead` — this is a daily-use destination, not a one-time creation
flow.

> **Build-time amendment (Step 8 spec-compliance re-review):** "its own nav
> entry" ships as the permanent `/org` header link, not a `handle.nav`
> command-palette/sidebar entry. `navDestinations.test.ts` pins that list to
> single-segment paths only, and the sidebar rail is a separate hand-authored
> item list — extending either to a nested `/org/inventory` route is a real
> UI-surface decision (icon, order, collapsed-rail label) that needs its own
> Design Check pass, which this iterate's Tier-2 pass did not cover. Disclosed
> deviation rather than a silent one; revisit as its own small change if the
> header link proves insufficiently discoverable in practice.

**"Last night" window** reuses the existing pure helper
(`client/src/lib/auditTimelineMerge.ts`'s `computeLastNightWindow`) — no new
window-computation logic; the predicate is a beat's `startedAt` falling
inside the window (matches "started overnight" — a `closedAt`-based
predicate would misclassify a beat spanning the window boundary). The
composite endpoint bounds beats server-side to `startedAt >= now - 48h`
(Internal Plan Review finding #3 — an unbounded read scales with a lead's
entire lifetime register + every one of those beats' `steps.jsonl`); the
client narrows further to the exact display window, matching the existing
Activity-timeline pattern of "fetch fresh, filter client-side, no stored
cursor." The composite additionally returns `totalBeatsInRegister` per lead
(External Plan Review, both reviewers — a cheap `entries.length` count over
the already-read register, no extra I/O), because the 48h server-side bound
means "empty in the last-night window" and "this lead has never had a beat"
are otherwise indistinguishable to the client (AC-8). When the
window-filtered list is empty but `totalBeatsInRegister > 0`, the page shows
an explicit empty state naming the window's own times (AC-7) rather than a
bare blank section — a PO opening the page outside the 18:00→06:00 window
must not read "quiet night" from what is actually "wrong time of day to
ask," nor from "this lead has never run."

**`charter-bands-mirror.ts` provenance** (External Plan Review — GLM): the
schema pair gets a fidelity test + header provenance + a disclosed
cross-repo-drift limitation; the hand-ported `validateCharterBands` mirror
gets the identical treatment — its header names the source path
(`leadwright/lib/charter-validate.ts`) and the pinned commit
(`db2938b308899b8cbca017b291c18696a54844b5`), so a future §4.4 heading
rename on leadwright's side is a disclosed, discoverable pin rather than a
silent divergence.

**E2E data safety** (Internal Plan Review finding #10): every existing
`/org` E2E spec resets state via `rmSync(path.join(homedir(), '.claude',
'leads'), {recursive:true,force:true})` — tolerable when that directory held
only test scaffolding, now a real data-loss risk since this very iterate
exists because the PO has live leads there. The new spec uses the
`isolated-stack.mjs` harness's isolated `leadsRoot` override instead of
touching the real home directory.

## Design Check (Tier 2 — medium+, UI)

Tokens from `.shipwright/designs/visual-guidelines.md` (no
`chrome-definition.md` or `screens/` mockup exists for `/org` in this
mature, iterate-only project — the existing `OrgPage.tsx`/`org.css` ARE the
authoritative visual reference this page matches):
- Unclaimed-effect warning: `--color-warning` (#D97706) text /
  `--color-warning-bg` (#FEF3C7) background — the SAME pairing the min-CLI
  banner uses, not a new warning treatment.
- Declared band (`AuthorityPanel`): `--color-success` (#059669) accent,
  matching "success chips, completed states."
- Not-declared band: `--color-muted-bg` (#ede8e1) outline, matching
  "disabled chip BG."
- Step band chips (`BandChip`, shared by both `BeatList` and
  `AuthorityPanel`): full-radius pill (`Avatars / pills: full`), neutral
  muted-bg by default — band is a category, not a state, so it does NOT
  reuse the phase-chip palette (that palette is reserved for
  pipeline-phase, not authority-band, semantics).

```
LeadInventoryPage (PageHead "Lead Inventory", one flex-1 overflow-y-auto scroller)
└── per lead (from useOrgChart roster, in chart order)
    ├── LeadSectionHeader: lead name + domain
    ├── AuthorityPanel
    │   └── BandChip × 4 (declared: success accent + prose; not-declared: muted outline)
    │       └── completeness line: "N/4 declared"
    ├── BeatList (client-side "last night" window filter over the 48h-bounded fetch)
    │   ├── empty state (window-filtered empty, totalBeatsInRegister > 0): window times
    │   ├── empty state (totalBeatsInRegister === 0): "no beats yet"
    │   └── BeatCard × N (startedAt ascending)
    │       ├── "in progress" label (closedAt === null)
    │       ├── unclaimed-effect warning banner (status:"found") — warning tokens above
    │       └── steps: ordered StepRow × N (BandChip) | "no steps reported" | "steps unavailable"
    └── NeedsYou
        └── open-question row × N: question text + one read-only answer-pending field
            + "View full conversation on Org" link (no W15 slot — omitted per Architecture Review)
```

Prop shapes for the two new/shared components:
- `BandChip({ band: "bugfix"|"maintenance"|"feature"|"architecture", variant?: "declared"|"missing" })`
  — the SAME component instantiated by both `StepRow` (no `variant`, always
  the neutral step-chip look) and `AuthorityPanel` (`variant` set) — this is
  what makes "same bands, same words" structural rather than a copied string.
- `BeatCard({ beat: BeatInventoryView })` where `BeatInventoryView` is the
  server composite shape (steps tri-state, `unclaimedEffect` tri-state,
  `startedAt`/`closedAt`).

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| leadwright `daemon/beat-step-report.ts` → `beats/<beatId>/steps.jsonl` | `server/src/external/org/beat-steps-read.ts` | JSONL, one `BeatStep` per leadwright's `schemas/beat-step.schema.json` |
| leadwright `daemon/beat-effect-audit.ts` → `<leadId>/audit.jsonl` | `server/src/external/org/beat-effect-audit-read.ts` (new; wraps the existing `auditLogCore`, one call per lead, `limit:200`) | JSONL, generic `{ts,kind,lead_id,beat_id,summary,data}` — this iterate only interprets `kind==="beat_effect_not_claimed"` |
| leadwright daemon → `<leadId>/beat-register.json` | `server/src/routes/org-inventory-composite.ts` (reuses `readRegisterFileTolerant`) | JSON, `{version:1, entries: BeatRegisterEntry[]}` — unchanged shape, new consumer |
| PO/lead via charter.md authoring | `server/src/external/org/charter-bands-mirror.ts` + `charter-authority-read.ts` (new) | Markdown headings + section prose, §4.4 canonical names |

`touches_io_boundary` risk flag: yes (new JSONL/JSON producer/consumer pairs
above) — Boundary Probe sub-step runs in Build.

## Confidence Calibration

Three producer/consumer format pairs from Affected Boundaries: two are
machine-only JSONL/JSON (`steps.jsonl`, `audit.jsonl`, `beat-register.json`,
all written only by leadwright's daemon) and one is genuinely PO/lead-edited
prose (`charter.md`). Per `references/boundary-probes.md`, machine-only
formats may skip the 3 operator-input-specific categories (POSIX `export`
prefix, inline `#` comment, quoted-value-containing-`#`) with a one-line
justification; `charter.md` gets the fuller treatment since a human edits it
by hand.

- **Probe (existing, pre-Build):** malformed-line tolerance in
  `beat-steps-read.ts` / `beat-effect-audit-read.ts` — a JSONL line that
  fails `isValidBeatStep`/schema validation is skipped, not fatal to the
  whole file. **Finding:** none; already covered by
  `beat-steps-read.test.ts` ("skips a malformed line, counts it") and
  `beat-effect-audit-read.test.ts` ("malformed-line-skip").
- **Probe (existing, pre-Build):** `beat-effect-audit-read.ts` pagination —
  a 48h window whose covering page lies beyond `nextCursor` must not
  false-clear. **Finding:** HIGH, caught by the plan-review cascade before
  Build (Internal Plan Review + both external plan reviewers) — fixed with
  bounded `before`-cursor pagination + 10-page cap → `unknown`. **Superseded
  at Stage-2 code review (MEDIUM-4/5):** the bounded-pagination design was
  replaced with a single full-file scan via `readAuditLinesGuarded`,
  removing the page/cap axis entirely rather than patching it further — see
  the AC-9 amendment above. Verified by the "reads the file exactly once
  regardless of how many lines it contains" test in
  `beat-effect-audit-read.test.ts` (5001-line fixture, asserts one read
  call).
- **Probe:** empty values / empty band section in `charter.md` (a heading
  present with no prose under it before the next heading). **Finding:**
  none — already covered by `charter-authority-read.test.ts` ("returns null
  text for a heading present with an empty section"), which predates this
  calibration pass.
- **Probe:** UTF-8 BOM on the first line of `charter.md` (a real editor,
  e.g. Notepad, can prepend one). **Finding:** none — added
  `charter-authority-read.test.ts` "a UTF-8 BOM on the first line does not
  corrupt a later band heading" to make this explicit rather than assumed;
  passed on the first run (`extractBandSections`'s heading match is
  content-anchored, not position-anchored).
- **Probe:** non-ASCII prose in a band section — the canonical band names
  themselves are German (`Kleine Pflege`, `Architektur / Grundsatz`) and a
  lead's charter prose plausibly contains umlauts/em-dashes. **Finding:**
  none — added "non-ASCII prose (umlauts, em-dash) round-trips intact";
  passed first run (UTF-8 buffer decode, no ASCII-only regex in the
  extraction path).
- **Probe:** CRLF line endings in `charter.md` (Windows editors default to
  CRLF; this repo's own dev machine is Windows). **Finding:** none — added
  "CRLF line endings are tolerated the same as LF"; passed first run
  (`extractBandSections` already split on `\r?\n`).
- **Skipped, machine-only-format categories (justified once, applies to
  `steps.jsonl`/`audit.jsonl`/`beat-register.json`):** POSIX `export`
  prefix, inline `#` comment, quoted-value-containing-`#` — none of these
  three describe a shape a JSONL/JSON writer or reader ever produces or
  expects; they are `.env`-style operator-input rules with no analogue in a
  machine-serialized line format.
- **Probe (composition, Build-time):** an in-progress beat (`closedAt:
  null`) that ALSO carries an unclaimed-effect warning — do the two
  independent per-beat UI states (`beat-in-progress-*` label,
  `unclaimed-effect-warning`) compose correctly on the same `BeatCard`
  rather than one clobbering the other. **Finding:** none — added
  `BeatList.test.tsx` "renders the in-progress label AND the
  unclaimed-effect warning together on the same open beat"; passed first
  run.
- **Asymptote:** the last three probes run (BOM, non-ASCII, CRLF against
  `charter-authority-read.ts`) all found nothing, all 8 boundary-probes.md
  categories have been applied or explicitly justified-skipped across the
  three format pairs, `touches_io_boundary` drift protection is in place
  (round-trip tests + the vendored-schema fidelity test), and there is no
  open "yes-then-bug" cycle in this run — probing is exhausted per the
  Decision Rule.

## Test Completeness Ledger

| # | Testable behavior | Disposition | Evidence / reason_code |
|---|---|---|---|
| 1 | Vendored `beat-step.schema.json` stays byte-identical + fixtures validate against it | tested | `leadwright-beat-step.test.ts::"beat-step.schema.json fidelity" + "isValidBeatStep — fixture accept/reject"` PASSED |
| 2 | `beat-steps-read.ts` re-validates `LEAD_ID_RE`/`BEAT_ID_RE` before any fs call (rejects without touching disk) | tested | `beat-steps-read.test.ts` mocked-`openSync` refusal test PASSED |
| 3 | `beat-steps-read.ts` tolerates a malformed JSONL line without failing the whole read | tested | `beat-steps-read.test.ts::"skips a malformed line, counts it"` PASSED |
| 4 | `beat-steps-read.ts` ENOENT → `{status:"ok",steps:[]}`, other fs errors → `{status:"unreadable"}` (tri-state, never a false "empty") | tested | `beat-steps-read.test.ts` ENOENT/EACCES cases PASSED (11/11 file) |
| 5 | `beat-effect-audit-read.ts` finds an unclaimed-effect entry in a single-pass scan | tested | `beat-effect-audit-read.test.ts::"finds a beat_effect_not_claimed entry in a single-pass scan and returns ok"` PASSED |
| 6 | `beat-effect-audit-read.ts` 404 → legitimate `clear`; any other non-200 → `unknown` (never collapsed to `clear`) | tested | `beat-effect-audit-read.test.ts::"a 404..."` + `"a real read failure..."` PASSED |
| 7 | `beat-effect-audit-read.ts` — superseded by Stage-2 code review (MEDIUM-4/5): bounded `before`-cursor pagination + 10-page cap replaced with a single full-file scan (`readAuditLinesGuarded`), removing the pagination axis (and with it the separate cap-hit scenario the original rows 7/8 each pinned — one scan-shaped test now covers what two pagination-shaped tests did); complete window coverage is now by construction, not a truncation-avoidance mechanism | tested | `beat-effect-audit-read.test.ts::"reads the file exactly once regardless of how many lines it contains (no pagination loop)"` PASSED (5001-line fixture, asserts one read call) |
| 8 | `org-inventory-composite.ts` includes a beat with an unparseable `startedAt`, excludes one genuinely outside the 48h window | tested | `org-inventory-composite.test.ts::"window-bound+unparseable-startedAt-inclusion"` PASSED |
| 9 | `org-inventory-composite.ts` orders beats ascending by `startedAt` | tested | `org-inventory-composite.test.ts::"startedAt-ascending ordering"` PASSED |
| 10 | `org-inventory-composite.ts` degrades only the offending beat when a beat id fails `BEAT_ID_RE`, not the whole lead | tested | `org-inventory-composite.test.ts::"BEAT_ID_RE-refused-beat degrades only that beat"` PASSED |
| 11 | `org-inventory-composite.ts` sets `unclaimedEffect:"found"`/`"unknown"` correctly (found case, and degrade-on-audit-read-failure case) | tested | `org-inventory-composite.test.ts` unclaimedEffect found + degrade cases PASSED |
| 12 | `org-inventory-composite.ts` returns zero beats (not an error) when no register file exists; keys multiple leads independently | tested | `org-inventory-composite.test.ts` no-register-file + multi-lead-keying cases PASSED |
| 13 | `org-inventory-composite.ts` degrades to `register:{status:"unreadable"}` (not a false zero-beats "clear") on a corrupt `beat-register.json` or an `LEAD_ID_RE`-refused `leadId`; `registerEntriesGuarded` reads via the same open-first pattern as this iterate's other two new readers (doubt review, medium/boundary-and-contract — closed a TOCTOU window the original lstat-then-reopen-by-path version had) | tested | `org-inventory-composite.test.ts` corrupt-register + refused-leadId degrade cases PASSED (Stage-2 code review HIGH-1); `beat-register.test.ts` + `beat-register-confidence-probes.test.ts` re-verified green against the open-first rewrite |
| 14 | `GET /api/org/inventory` composes the roster-wide response end-to-end against real tmpdir fixtures | tested | `org-inventory.test.ts` (4 route-level cases) PASSED |
| 15 | `charter-authority-read.ts` extracts prose for 4/4 declared bands; marks a missing band `declared:false`/`text:null`; tolerates heading slash-spacing variance; returns `text:null` for a heading with an empty section | tested | `charter-authority-read.test.ts` (`extractBandSections` describe block, 5 cases) PASSED |
| 16 | `charter-authority-read.ts` tolerates a UTF-8 BOM, non-ASCII prose (umlauts/em-dash), and CRLF line endings in `charter.md` | tested | `charter-authority-read.test.ts` BOM/non-ASCII/CRLF boundary-probe cases PASSED |
| 17 | `charter-authority-read.ts` reports `measured:false` with a distinct reason for a failed read vs. a non-default `charter_path` | tested | `charter-authority-read.test.ts` default-path/custom-path reason cases PASSED |
| 18 | `BandChip` renders the correct label and `data-testid` per band | tested | `BandChip.test.tsx` (2 cases) PASSED |
| 19 | `BeatList` renders one `BandChip` per step, in step order, per beat (AC-1) | tested | `BeatList.test.tsx::"renders a BeatCard per beat...AC-1"` PASSED |
| 20 | `BeatList` renders a visible, DOM-assertable unclaimed-effect warning on a beat with `unclaimedEffect:"found"`, a distinct non-alert note for `"unknown"`, and neither for `"clear"` (AC-2a/AC-2b) | tested | `BeatList.test.tsx` warning-present, clear-renders-neither, and unknown-note cases PASSED |
| 21 | `BeatList` narrows to "last night" client-side: excludes a beat outside the window, includes one with an unparseable `startedAt` (AC-7) | tested | `BeatList.test.tsx::"excludes a beat outside the last-night window...AC-7"` PASSED |
| 22 | `BeatList` shows two distinct empty states — "never had a beat" vs. "nothing in this window" — driven by `totalBeatsInRegister`, plus a third distinct error state when `register:{status:"unreadable"}` (AC-8) | tested | `BeatList.test.tsx` all three empty-state cases PASSED |
| 23 | `BeatList` distinguishes "steps unavailable" (unreadable read, or every line malformed) from "no steps reported" (genuinely empty, error-free), and notes a partial read (some valid steps, some malformed lines) rather than rendering a complete-looking list silently (AC-10) | tested | `BeatList.test.tsx` steps-rendering + partial-read cases PASSED (Stage-2 code review LOW-8) |
| 24 | An in-progress beat (`closedAt:null`) and an unclaimed-effect warning compose correctly on the same `BeatCard` without one clobbering the other | tested | `BeatList.test.tsx::"renders the in-progress label AND the unclaimed-effect warning together"` (composition probe) PASSED |
| 25 | `AuthorityPanel` renders per-band charter prose + an "N/4 declared" completeness line, and never renders a "may act alone" claim | tested | `AuthorityPanel.test.tsx` (3 cases) PASSED |
| 26 | `NeedsYou` renders exactly one answer field per open question (a non-interactive `<p>`, not a focusable input), with no thread/round affordance, reusing `OrgThread.tsx`'s `isAnswered` predicate inverted, and shows distinct loading/error states rather than a false "nothing needs you" | tested | `NeedsYou.test.tsx` (7 cases) PASSED |
| 27 | `LeadInventoryPage` composes `AuthorityPanel`+`BeatList`+`NeedsYou` per lead in chart order, shows a named error state (not a blank page) when the org chart fails to load, and surfaces the threads-query error distinctly rather than a false "nothing needs you" | tested | `LeadInventoryPage.test.tsx` (3 cases) PASSED |
| 28 | `useLeadInventory` hook fetches via `fetchOrgInventory` with the same `staleTime`/`refetchInterval` convention as `useOrgThreads` | tested | `useLeadInventory.test.ts` (1 case) PASSED |
| 29 | `/org/inventory` route resolves to `LeadInventoryPage` in a real browser (not just a component-level render), guarded against writing to the operator's real `~/.claude/leads/` outside isolation | tested | `lead-inventory-page.spec.ts` (both E2E cases navigate via `page.goto("/org/inventory")`; `assertIsolatedLeadsRoot()` via `realpathSync.native` — Stage-2 code review HIGH-1/LOW-9/LOW-10; SHIPWRIGHT_E2E_ISOLATED=1 required unconditionally + the override itself containment-checked — doubt review, high/reversibility, closed a real bypass via a legitimate `SHIPWRIGHT_LEADS_ROOT` dev-shell setting) PASSED |
| 30 | `OrgPage` links to `/org/inventory` via a visible, addressable affordance | tested | `OrgPage.test.tsx::"renders chart -> shared docs -> lead list...AC-1"` (added `org-inventory-link` href assertion) PASSED |
| 31 | A real round trip — JSON written to real `steps.jsonl`/`audit.jsonl`/`beat-register.json`/`charter.md` on disk, read through the full server+client stack, rendered in a real browser | tested | `lead-inventory-page.spec.ts` (real fixture writes under isolated `~/.claude/leads/`, both cases) PASSED via `node e2e/isolated-stack.mjs` |
| 32 | `LeadInventoryPage.tsx` bounds its own vertical scroll below the title bar (shell-scroll invariant) | tested | `shell-scroll-invariant.test.ts` (registry entry added for `LeadInventoryPage.tsx`) PASSED |
| 33 | Server/client type mirrors (`BeatStep`, `AuthorityBandView`, `BeatInventoryView`, `LeadInventoryEntry`, `UnclaimedEffectView`, `RegisterView`, `StepsView`, `CharterAuthorityResult`, `BeatStepEffect`) stay in sync — a dropped field is caught, not silently drifted | tested | `org-inventory-schema-sync.test.ts` (9 cases; falsified by temporarily dropping `unreadableLines`, confirmed red, restored) PASSED |
| 34 | New test files contain no test-hygiene smells (skip/only, unstubbed timers, etc.) | tested | `scan_test_hygiene.py --diff` → "no findings" |
| 35 | `isValidBeatStep` rejects a malformed `at` timestamp (not just an invalid `band`), matching the vendored schema's own `^\d{4}-\d{2}-\d{2}T` pattern | tested | `leadwright-beat-step.test.ts::"at pattern matches..."` + `"rejects a record whose at isn't a timestamp"` PASSED (external code review, low/bug) |
| 36 | `beat-steps-read.ts` treats a `steps.jsonl` that is actually a directory as unreadable via the REAL `fstat().isFile()` path, not only a mocked `ELOOP` | tested | `beat-steps-read.test.ts::"a steps.jsonl that is actually a directory is unreadable..."` PASSED (external code review, low/test-coverage) |
| 37 | AC-4's 2-of-4-declared case is verified through the real `GET /api/org/inventory` endpoint, not only at the `extractBandSections` unit level | tested | `org-inventory.test.ts::"renders a 2-of-4-declared charter through the real endpoint..."` PASSED (external code review, medium/test — both reviewers independently) |
| 38 | The E2E fixture's "last night" timestamp is derived from the real `computeLastNightWindow`, not a hand-rolled duplicate of its branch logic (removes a false-positive-prone duplication both external reviewers independently mis-traced) | tested | `lead-inventory-page.spec.ts` re-verified green under `node e2e/isolated-stack.mjs`, both cases, after the change |
| 39 | `charter-authority-read.ts`'s `extractSectionProse` does not swallow a section's trailing prose behind an unbalanced (unclosed) code fence; a balanced fence still hides its contents (regression guard) | tested | `charter-authority-read.test.ts` unbalanced-fence + balanced-fence-regression cases PASSED (external code review, low/edge-case) |

**Counts:** testable=39, tested=39, untestable=0, untested_testable=0.
**Enumeration basis:** 11 acceptance criteria (AC-1 through AC-11 per the
mini-plan), all covered by at least one ledger row above.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Mechanically strong plan (right precedents, right guards
  named) but resting on two premises that don't survive reading the sources
  it cites — the authority-ladder derivation is vacuous exactly where it
  would be seen, and the per-figure degrade collapses unreadable data into
  positive health claims (a HIGH class this repo already fixed once, in
  `org-leads-composite.ts`). Plus an N+1 that inverts the composite
  precedent it claimed to follow, and an FR-ID collision with leadwright's
  own spec.
- **Findings:**
  - [HIGH/architecture] Authority-ladder premise: `validateCharterBands`'s
    own header disclaims the "may act alone" reading; `beat-start` denies a
    beat outright on any missing band, so declared/missing is always 4/4
    for any lead with beats — **fix**: per-band charter prose + completeness
    line, not a declared/missing "may act alone" binary.
  - [HIGH/architecture] Degrade fail-open: unreadable steps/audit collapse
    into "no steps"/"clear" — **fix**: tri-state `ok`/`unreadable`/`unknown`,
    never collapsed into a positive claim (AC-2b).
  - [HIGH/performance] N+1 inverting the composite precedent; audit.jsonl
    re-read per beat — **fix**: roster-wide `GET /api/org/inventory`,
    audit read once per lead via existing paginated `auditLogCore`, beats
    bounded to a 48h server-side window.
  - [HIGH/completeness] `FR-04.43` collides with leadwright's own spec's
    heartbeat-daemon FR — **fix**: dropped; new AC anchors under
    `FR-01.71(G)` instead.
  - [MEDIUM/security] ENOENT-vs-`realPathGuard` ordering bug, no
    `O_NOFOLLOW` pattern, unvalidated `beatId` path segment — **fix**:
    mirror `audit-log.ts`'s open-first pattern exactly; new `BEAT_ID_RE`
    guard before path join.
  - [MEDIUM/architecture] Vendored schema is `.strict()`/generated and a
    faithful mirror would reject every line on any upstream field addition
    — **fix**: `isValidBeatStep` validates only consumed fields, tolerates
    unknown properties; pinned commit verified on leadwright `origin/main`.
  - [MEDIUM/completeness] "Needs You" was a dead end (visible question, no
    write path, empty W15 slot) and silently duplicated FR-01.71(D)'s
    existing thread view — **fix**: cross-link to the existing `/org` thread
    view; AC-5-user reworded to "see", not "give", the answer; Spec Impact
    now discloses the coexistence explicitly.
  - [MEDIUM/completeness] New page renders `PageHead` but was absent from
    `shell-scroll-invariant.test.ts`'s `TITLE_BAR_ROUTES` registry, with no
    bounded scroller specified — **fix**: registry updated, Diagnostics
    bounded-scroller pattern applied.
  - [MEDIUM/completeness] "Last night" window had no AC, no empty state, and
    an ambiguous `startedAt`-vs-`closedAt` predicate — **fix**: AC-7 pins the
    predicate (`startedAt`) and requires an explicit, window-time-naming
    empty state.
  - [MEDIUM/completeness] Existing org E2E specs `rmSync` the operator's real
    `~/.claude/leads` — now a data-loss risk given this iterate's own
    premise (live leads exist) — **fix**: new spec uses the isolated
    `isolated-stack.mjs` harness instead.
  - [LOW/completeness] AC-3-agent originally asserted an unprovable
    byte-diff claim — **fix**: reworded to the same semantic-field-match
    style the real precedent test (`leadwright-preflight.test.ts`) uses.
  - [LOW/architecture] Charter read hardcodes `<leadId>/charter.md`,
    ignoring `org-chart.json`'s per-lead `charter_path` — **disclosed**
    (matches `buildRole`'s existing, same limitation; not a new gap this
    iterate introduces, and fixing it is out of this iterate's scope). The
    `measured:false` UI state now says why ("not readable at the default
    charter path") rather than rendering an unexplained blank panel.
  - [LOW/architecture] New-page-vs-extend-`/org` decision — **no finding**,
    confirmed sound.
- **Known limitations:** charter read ignores per-lead `charter_path`
  (disclosed above, matches existing `buildRole` limitation).
- **Status:** 10 fixed, 1 disclosed, 0 declined

## External Plan Review (glm + openai, via external_review.py --mode iterate)
- **Verdicts:** glm=revise · openai=revise (no contradiction — both within
  one step of each other)
- **Findings + disposition (all fixed, integrated above):**
  - [HIGH, both independently] `auditLogCore(limit:200)` can still produce a
    false `clear` for an unclaimed-effect entry that aged past the newest
    200 audit entries — **fix**: paged read to the window start, capped at
    10 pages, degrading to `unknown` on cap (AC-9).
  - [MEDIUM, openai] Charter-path handling makes the NEW feature wrong for a
    non-default `charter_path`, not just a repeat of an old limitation —
    **fix (narrowed)**: compare against the literal default and give an
    honest "custom path not yet supported" reason rather than a blanket
    disclosure; full support deferred as a repo-wide follow-up (three call
    sites, not one).
  - [MEDIUM, openai] 48h server truncation makes "empty" ambiguous against
    AC-7's "any beats at all" — **fix**: `totalBeatsInRegister` (AC-8).
  - [MEDIUM, openai] `leadId` not re-validated inside the new readers
    themselves — **fix**: both readers re-validate `LEAD_ID_RE`, not just
    `beatId`.
  - [MEDIUM, glm] All-lines-malformed `steps.jsonl` still renders "no steps
    reported" — **fix**: AC-10, distinct "steps unavailable" state.
  - [MEDIUM, glm] Refused-`beatId` composite behavior unspecified; possible
    legacy non-UUID beat ids — **fix**: AC-11, degrades that beat alone.
  - [MEDIUM, glm] Open-beat / mid-append race handling unspecified —
    **fix**: `startedAt`-only window (open beats included, "in progress"
    label), truncated-final-line fixture test.
  - [LOW, openai] All-malformed lines note (duplicate of glm's MEDIUM above)
    — folded into the same fix.
  - [LOW, glm] "Unanswered" predicate + beat ordering unpinned — **fix**:
    AC-11 pins both (reuse `OrgThread`'s `isAnswered`; `startedAt` ascending).
  - [LOW, glm] Reserved empty W15 slot reads as a broken button — **fix**:
    slot omitted entirely.
  - [LOW, glm] `charter-bands-mirror.ts` lacked the schema pair's provenance
    discipline — **fix**: header now names source path + pinned commit.
  - [LOW, glm] Missing/invalid `startedAt` on a register entry unhandled —
    **fix**: included rather than excluded by both the server bound and the
    client window filter (fail toward visibility).
- **Status:** 11 fixed, 0 disclosed, 0 declined

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-08-lead-inventory-page/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed, with one
  simplification on the periphery (below) — the core mechanism (one page,
  one roster-wide composite, reused guarded readers) is already close to
  minimal.
- **Findings:** [LOW, glm, proportionality] The charter authority panel's
  payoff (band prose + a completeness count that is structurally 4/4
  wherever there are beats) doesn't justify a SECOND hand-ported, pinned
  cross-repo mirror (`charter-bands-mirror.ts`) whose drift no test here can
  catch — the four band names are already hardcoded in this repo (the
  vendored schema's `band` enum), so the §4.4 heading-detection logic didn't
  need its own separately-pinned file. **Accepted and fixed**: folded
  directly into `charter-authority-read.ts` as local logic (still doing the
  same slash-spacing-normalized heading match `charter-validate.ts` does,
  attributed by comment, just not carrying its own separate vendoring
  ceremony) — one fewer pinned artifact for the same panel. [LOW, glm,
  ownership] Neither cross-repo pin can self-detect staleness — **accepted
  as a disclosed limitation**, matching the W14 precedent; a detector, if
  one ever exists, belongs in leadwright's own repo, not here.
- **Reconciliation:** No scope change to AC-4 or the authority panel itself
  — only its implementation shrank by one file. Both reviewers independently
  affirmed the new-page-vs-fold-into-`/org` decision (Alternative approach,
  above) is the right shape, for the same reasons Internal Plan Review gave.

## Verification (medium+)
- **Surface:** web
- **Runner command:** Playwright spec
  `client/e2e/flows/lead-inventory-page.spec.ts` against the dev stack
  (Backend-affects-Frontend rule: new API routes consumed by new UI).
- **Evidence path:** `shipwright_test_results.json.iterate_latest.surface_verification`
- **Justification (only if surface=none):** n/a
