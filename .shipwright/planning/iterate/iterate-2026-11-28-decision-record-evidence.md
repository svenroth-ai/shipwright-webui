# Iterate Spec: decision-record evidence and learning labels in the proposals window

- **Run ID:** iterate-2026-11-28-decision-record-evidence
- **Type:** feature
- **Complexity:** medium (Repo Scout: new read route reading two org files, mirrored client/server pointer grammar, two UI components, cross-repo contract + fixture)
- **Risk flags:** touches_io_boundary (reads `decisions-rejected.md` / `decision_log.md`, a format another repo reads and this repo writes), touches_public_api (new read-only POST route, additive audit `evidence` shapes)
- **Status:** draft

## Goal

Leadwright #153 (merged f79a181) lets a lead propose a **learning** and cite the operator's own words as evidence:
`rejected:<entry time>/<lead>` (the operator's `- Reason:` of a block in `<leadsRoot>/decisions-rejected.md`) and
`decision:ADR-<n>` (the operator's `- Note:` of a countersigned block in `<leadsRoot>/decision_log.md`). The proposals
window shows both as "unknown source" without the quote. This run resolves both forms the way the writer's reader does
(positionally; the lead's own line is never the operator's words), fails closed when the record cannot be read, and
shows a learning proposal's label (`Learning (this lead|all leads, importance N[, pinned][, replaces key]):`) apart from
the rule, also while the operator edits the line before countersigning.

## Acceptance Criteria

- [x] AC1 (FR-01.71) Given a proposal whose Evidence bullet is `rejected:<time>/<lead> — "<quote>"` or `decision:ADR-<n> — "<quote>"`,
  when the window lists it, then the source is named in plain words ("your reason for rejecting <lead>'s proposal of <time>",
  "your note on ADR-<n>"), and `POST /api/org/decisions/record-evidence` with the JSON body `{pointer, quote}` (`Cache-Control: no-store`) returns `confirmed` with the operator's
  reason/note when the quote occurs in it; the window shows the quote as the operator's words with the full recorded text.
- [x] AC2 Positional reading exactly like leadwright `rejectedReasons` / `decisionNote`: item 1 of a rejected block is always the lead's
  line (even when it starts with `Reason: `), only item 3 after `- Rejected: ` is a reason; a decision block counts only in the
  countersign line shape (`lineBlock`), and two blocks under one ADR number cite nothing. A quote from the lead's line returns
  `quote_not_found` / `no_words`, never `confirmed`.
- [x] AC3 Fail closed: a missing file, a symlink, a non-file, an unreadable or oversized file returns `unreadable`; no such block or no
  reason/note returns `no_words`; in every non-`confirmed` case the window says so and does NOT show the quote as the operator's words.
- [x] AC4 The audit `data.evidence` of a countersign records `{form:"rejected", time, lead}` / `{form:"decision", adr}`; never the quote.
  A fence quote (`> text — rejected:...`) or a fence quote inheriting a record pointer is shown as unknown source.
- [x] AC5 A learning proposal (decisionKey `learning.*`) shows its label apart from the rule: reach (this lead / all leads), importance,
  pinned, replaces; an unlabelled learning says it counts as this lead, importance 3; an unreadable label shows a warning naming the
  leadwright problem text. The same reading runs live under the edit field.
- [x] AC6 Countersigning an edited learning label logs exactly the edited line in the countersign line shape; a committed fixture
  `server/src/external/org/__tests__/fixtures/decision-log-countersigned-sample.md` is produced byte-for-byte by the real writer
  (`handleCountersignRequest`) and pinned by a test plus its LF-normalised SHA-256 in the contract doc.
- [x] AC7 (agent, F0.5) Playwright e2e on the org page: proposals window with a `rejected:` and a `decision:` learning proposal shows the
  confirmed operator words, a third proposal whose record is missing shows the fail-closed notice, and the learning label is shown.

**Pre-build AC record (Step 2a):** two `add` items under FR-01.71, frozen in
`.shipwright/planning/iterate/iterate-2026-11-28-decision-record-evidence/ac-record.jsonl`.

## Spec Impact

- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.71 — two new (F) acceptance-criteria lines (operator-words evidence; learning label), description gains one sentence.
- **REMOVE:** none

## Out of Scope

- Exempting operator-words quotes from the `line_contains_quote` copy guard (the guard stays as strict as today).
- A secret-gated twin of the new read route (the plain surface is the only consumer).
- Validating the learning label on the server (leadwright decides; the WebUI only shows and warns).
- Editing leadwright's guide sentence "The organisation page does not yet show these two citations" (leadwright repo).

## Design Notes

- Grammar: the mirrored pointer module (`proposed-evidence-pointer.ts` / `orgProposedEvidencePointer.ts`) gains `rejected` and
  `decision` kinds with leadwright's exact regexes; tried after the excerpt form, bounded by `MAX_POINTER_CHARS`.
- New server module `decision-record-evidence.ts`: ports leadwright `recordLines`, `blockStarts`/`fenceClose`, `markerValue`,
  `decisionLogBlocks`, `lineBlock`, `sameAdr`, `rejectedReasons`, `decisionNote`, `flat`/`recordableQuote`; reads files with the
  `O_NOFOLLOW` + fstat + `realPathGuard` pattern of `file-read.ts`, capped at 5 MB.
- New route on the plain surface, next to `rejected-keys`: `POST /api/org/decisions/record-evidence` (JSON body, so the quote stays out of URLs; the org write guard applies).
- Client: `OperatorWordsEvidence` component (React Query) in `DecisionEntryDetail`; `orgLearningLabel.ts` (port of leadwright
  `parseLearningLabel`) + `LearningLabelView` used in the detail and under the editor.
- Visual: same muted 11px text scale as the existing detail; a left-border block for words, an amber notice for fail-closed states
  (reuse existing notice styling from `SkippedEntriesNotice`).

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| webui `decisions-rejected.ts` `toRejectedBlock` | webui `decision-record-evidence.ts` `rejectedReasons` (and leadwright `lib/decision-record-evidence.ts`) | Markdown block grammar |
| webui `countersign-core.ts` `toLoggedLineBlock` | webui `decisionNote` (and leadwright `lineBlock`, `parseLearningLabel`) | Markdown block grammar |
| leadwright `renderEntry` (Evidence bullet) | webui `parseEvidence` / `parseSourceRef` | `<pointer> — "<quote>"` |
| webui server route | client `fetchRecordEvidence` | JSON |

## Confidence Calibration

- **Boundaries touched:** see table above.
- **Empirical probes run:**
  1. Reject writer -> file -> reader (real `toRejectedBlock`, temp leadsRoot, LF): a non-ASCII reason with an inline `<!-- ... -->` is confirmed from a quote in leadwright's recordable form (`...`); the lead's own non-ASCII line (emoji) is `quote_not_found`; an empty reason is `no_words`. No finding.
  2. Same blocks with a BOM and CRLF line ends: identical six answers. No finding.
  3. Countersign writer -> `decision_log.md` -> `decisionNote`: the committed fixture is produced by the real `handleCountersignRequest` and read back (fixture test). No finding.
  4. Record files: missing, directory, symlink (ELOOP seam), oversized, FIFO (POSIX test), grown past the cap (bounded read). External review found the FIFO and the unbounded read (fixed); re-probed by tests, no finding.
  5. Route JSON -> client: unknown status and HTTP error read as not checked; a background re-check never shows the cached confirmation (external review finding, fixed, test). Re-probed in the browser (e2e): no finding.
- **Asymptote:** reached for the record readers (probes 1-2 two consecutive no-finding rounds) and the client states (fix, then two no-finding runs: component test, e2e).
- **Edge cases not probed:** a leadwright-produced `decisions-rejected.md` (leadwright only reads that file, it never writes it); concurrent writes during the read (bounded read limits the effect; the check is view-time by design).
- **Test Completeness Ledger:** 11 behaviors, all tested (see F5 `test_completeness`).
- **Confidence-pattern check:** every claim above is anchored to a test or a probe run in this iterate.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `npx playwright test e2e/flows/org-page.decisions-proposed-record-evidence.spec.ts` (client/)
- **Evidence path:** `client/test-results/` + F5 `surface_verification`

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Sound design (server-side read-only route, positional port, fail-closed states, allowlist not widened); four medium gaps to close before build.
- **Findings:**
  - completeness/medium: port `quoteProblem` bounds (24..200, flattening) — fixed (`quoteOccursIn`, tests for 23 chars, short text, 201 chars, `<!--`/fence brackets).
  - completeness/medium: `lineBlock` marker decode + proposal-marker skip — fixed (undecodable marker, missing blank line, empty note, extra item cases).
  - architecture/medium: second reader of `decisions-rejected.md` (`parseRejectedBlocks`, not fence-aware) — disclosed in the contract doc (the duplicate check is not evidence).
  - performance/medium: size cap before read, O(n^2) fence rescan, one request per row — fstat size check before reading fixed; fence rescan disclosed (files written by this app, 5 MB cap); per-row request kept (only rows with a record pointer).
  - security/medium: loading/error must not render the quote as the operator's words; invalidate after reject/countersign — fixed (component + tests for checking/400/unknown answer; `RECORD_EVIDENCE_KEY` invalidated).
  - security/low: no file content unless confirmed — fixed (route test asserts no echo).
  - architecture/low: generous transport cap, quote bound as an outcome — fixed (4000-char transport cap, 200 rule yields `quote_not_found`; POST body, no URL encoding).
  - architecture/low: copy regexes literally, test leadwright examples — fixed.
  - completeness/low: label vectors pinned — fixed (leadwright's cases ported into `orgLearningLabel.test.ts`).
  - completeness/low: CRLF and symlink seam — fixed (LF-normalised compare + hash, `openSync` ELOOP seam).
- **Known limitations:** two rejected-file readers with different fence handling; Markdown fence rescan is quadratic on pathological hand edits.
- **Status:** 8 fixed, 2 disclosed

## Internal Architecture Review (architecture-internal-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** approve Option A; B is strictly worse (wider exposure, third reader copy); C is the survivable fallback.
- **Findings:**
  - necessity/low: build it, keep it to the two record forms — accepted.
  - smallest-option/medium: A over B — accepted.
  - security/medium: route must not widen reads; fixed path; bounded inputs — fixed (words only on `confirmed`, fixed file names, pointer/quote bounds before IO).
  - complexity-cost/medium: two-way fixture — partly fixed (this repo's countersigned sample for leadwright; leadwright's reader cases ported here); a leadwright-produced rejected sample pinned here is a follow-up.
  - completeness/low: view-time check wording — fixed ("found in <file> when shown"; re-run after decisions).
  - completeness/low: malformed block / grammar mismatch cases — fixed (tests).
  - completeness/low: label display independent of the route — fixed (separate component and tests).
- **Known limitations:** no leadwright-produced rejected-file sample pinned here yet.
- **Status:** 5 fixed, 1 partly fixed, 1 accepted

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-11-28-decision-record-evidence/architecture_brief.md`
- **Verdicts:** glm=revise · openai=approve
- **Smallest thing that would do (per reviewers):** openai: as proposed (one read-only lookup returning words only when confirmed); glm: Option B (client-side over the file route).
- **Findings:** glm simpler-alternative/high — rejected-with-reason: B needs `decisions-rejected.md` in the org allowlist, which is shared by read AND the generic PUT (the contract keeps that file writable only by reject), exposes the whole file instead of one confirmed reason, and still needs one reader copy (in the browser) plus the mirrored pointer grammar, which exists anyway for display and audit; the internal architecture reviewer reached the same conclusion independently. glm proportionality/low (drop the hash pin) — rejected: the hash pin is the cross-repo convention of every other fixture here and is checked by the test, so it cannot drift silently.
- **Reconciliation:** the mini-plan rejected B for the allowlist/write-surface reason above; kept A.

## External Plan Review
- **Verdicts:** glm=(findings) · openai=revise
- **Findings:** quote-matching semantics (accepted-and-fixed: candidates are the reason/note only, leadwright bounds); quote cap (fixed); editor never fetches (fixed); duplicate ADR from the writer (not possible: `nextLoggedNumber`; strict rule kept); read scope (fixed: server-selected leadsRoot, host gate + write guard, words only when confirmed); quote in URL (fixed: POST, `no-store`); empty quote (fixed: never confirms); cache identity (fixed: key = pointer + quote, single org per server, invalidated after decisions, no placeholder data); writer-to-reader test for the reject writer (fixed).

## External-Code-Review-Findings

Verdicts: openai=revise · glm=(findings, no verdict line)

| # | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai | high | A background re-check showed the cached confirmation (isPending false while refetching) | accepted-and-fixed: `isFetching` also renders "checking"; test seeds a confirmation, re-checks with a delayed answer, then `no_words` |
| 2 | openai | medium | A FIFO at a record path blocks the read-only open | accepted-and-fixed: `O_NONBLOCK` where defined, fstat refuses it as not a file; POSIX-only test with `mkfifo` |
| 3 | openai | medium | Size checked by fstat, then an unbounded read | accepted-and-fixed: bounded read of at most `MAX_RECORD_BYTES + 1` bytes, refused when it crosses the cap |
| 4 | openai | medium | A malformed label hid the proposed line behind the warning | accepted-and-fixed: the warning keeps the line visible (`-line` test id), row test asserts both |
| 5 | glm | low | An unclosed fence with a repeated nonce skips to the next identical line | rejected-with-reason: identical to leadwright `lib/markdown-blocks.ts` `fenceClose`; a port that differs would confirm what the daemon refuses; result is fail-closed (`no_words`) |
| 6 | glm | low | The "all of a shorter text" bound uses the transformed length | rejected-with-reason: leadwright `lib/evidence-quote.ts` measures the same flattened, recordable text; matching it is the point |
