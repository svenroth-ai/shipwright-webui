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
  audit-pagination truncation): `beat-effect-audit-read.ts` pages through
  `auditLogCore` (not a single `limit:200` call) until either it has covered
  every entry back to the 48h window start, or a bounded page cap (10 pages
  = 2000 entries) is reached; hitting the cap before covering the window
  degrades that lead's unclaimed-effect lookup to `{status:"unknown"}` for
  every beat in the bounded set — NEVER a false `{status:"clear"}`. A test
  forces the truncation path and asserts `unknown`, not a silently-missed
  warning.
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

**Security posture for the two new file readers** (Internal Plan Review
finding #5, sharpened by External Plan Review): both `beat-steps-read.ts`
and `beat-effect-audit-read.ts` mirror `audit-log.ts`'s exact open-first
pattern — `pathGuard` → `open(O_RDONLY | O_NOFOLLOW)` → `fstat().isFile()`
→ `realPathGuard` → read from the held fd — closing the
ENOENT-via-`realPathGuard`-first bug this repo already found and fixed once
in `file-read.ts`. Both `leadId` AND `beatId` are re-validated inside each
reader itself (`LEAD_ID_RE` from `_helpers.ts`; a new `BEAT_ID_RE` —
leadwright generates beat ids via `randomUUID()`) BEFORE either is joined
into a path — never trusting that an upstream caller (`requireChartLead`,
`beat-register.json`'s own `typeof === "string"`-only validation) already
did it, the same re-validate-don't-trust-the-caller posture
`lead-question-threads.ts` documents. A register entry whose `beatId` fails
`BEAT_ID_RE` degrades ONLY that one beat to `steps: {status:"unreadable"}`
in the composite — never the whole lead, never a 500 (AC-11).

**Audit-log pagination bound** (External Plan Review, both reviewers
independently): a single `auditLogCore(..., {limit:200})` call can still
produce a false `{status:"clear"}` if the matching
`beat_effect_not_claimed` entry has aged past the newest 200 audit
entries — exactly the fail-open class AC-2b exists to close, surviving
along the pagination axis instead of the read-failure axis.
`beat-effect-audit-read.ts` instead pages (`before` cursor) until it has
covered every entry back to the 48h beat-window start, capped at 10 pages
(2000 entries) as a bounded worst case; hitting that cap before covering
the window degrades to `{status:"unknown"}` for the lead's whole bounded
beat set rather than risking a silent miss (AC-9).

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
{populated after Build, before F0 — see Step 7.5}

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
