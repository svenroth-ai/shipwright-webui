# Edit the proposed line before countersigning

Campaign shadow-proposals-webui, unit W4. Operator decisions 4 and 5: only the operator's line goes to the learnings; the audit says edited and points to the observation; quotes are shown but never written.

## Decision

Countersign takes an optional `line`. For a fenced (daemon / marker-owned) entry the log block is rebuilt from the line alone: `## ADR-NNNN [ts] lead`, the decisionKey marker (plain-identifier keys only), `<!-- proposal: <sha256 prefix of the block> -->`, and `- <line>`. This holds for the unedited path too. The server decides edited vs approved as proposed by comparing normalised lines. The audit record gains `edit` and a structured `evidence` pointer (`{session,time,message}`, bounded, known shape only). The line/quote split (`fencedParts`) lives in the mirrored grammar.

## Architecture Review

External (glm + openai): approve / approve. Internal architecture reviewer (opus): approve option A with revisions. Findings and disposition:
- Rebuild the log block for EVERY countersign, not only edited ones: accepted-and-fixed (fenced entries always go through `toLoggedLineBlock`; old unfenced entries keep the old byte-preserving move).
- Server decides edited vs unedited, never the client: accepted-and-fixed.
- Validate the line server-side (one line, non-empty, 2000 max, no structure): accepted-and-fixed (normalised to one line, written as a list item).
- Operator pastes a quote into the line: accepted-and-fixed (`line_contains_quote`, 20+ characters, case/whitespace-insensitive, with and without the pointer suffix).
- Pointer malformed or missing, old entry without a line: accepted-and-fixed (null / `edit_not_supported`, never free text).
- Stale edit (the entry changed between view and click): ACCEPTED LIMIT, NOT BUILT. A client-sent fingerprint of the displayed line with a 409 on mismatch is a tracked follow-up.
- Keep the line/quote rule server-only: rejected-with-reason; the client view needs the same split, and the brief requires one drift-guarded mirrored grammar.

## External-Plan-Review-Findings

Both providers: revise. Newline/structure injection, quote-comparison normalisation, edited-vs-unedited equality, retry recovery, pre-W4 fixtures, refusal atomicity: accepted-and-fixed (tests in countersign-edit.test.ts). Handler extraction widening the diff: rejected-with-reason (needed to keep the modal under 300 lines).

## Internal plan review (opus-plan-reviewer) findings

- Unedited line skipped the quote check: accepted-and-fixed (`checkOriginalLine`; empty or quote-repeating original needs an edit; an indented `>` counts as a quote).
- Pointer suffix bypass of the quote guard: accepted-and-fixed (needles with and without the suffix).
- Crash retry compared the logged line with itself (regression of an earlier HIGH fix): accepted-and-fixed (fingerprint of the proposed block in the log; a different proposal with the same identity gets 409; the same proposal heals whatever line the retry sends).
- Evidence pointer fields unbounded: accepted-and-fixed (session 1-64, message up to 9 digits). decisionKey stays lead-written: documented.
- Stale-view fingerprint: accepted limit (above). A lead can pre-plant its own audit line, and a missing lead folder skips the audit: accepted, documented in the contract doc next to W3's note.
- Remote images in the log tile's Markdown, repeated audit reads: accepted, not changed.

## External-Code-Review-Findings

- One-character session id escaped the pointer-suffix split: accepted-and-fixed.
- Empty proposed line offered no editor: accepted-and-fixed.
- Positional row key could carry a stale draft to another proposal: accepted-and-fixed (draft reset when the entry block changes).
- Heal-path edit state read from the log by regex: accepted; covered by a test asserting `data.edit`.

## Confidence Calibration

Boundary: decision_log.md block shape and audit.jsonl fields (producer: countersign; consumers: audit view, leadwright, the log parsers). Probes: round-trip through the real routes with real files; adversarial quote/header/marker/fence/JSON text; free-text pointer; CRLF + BOM file; pointer-suffix and one-character-session paste; forged same-identity entry; crash residue. Findings from the reviews were fixed and re-probed; the last two probes (pointer-suffix paste after the fix, CRLF + BOM) found nothing. Not probed: remote-image Markdown in the log tile, a lead planting its own audit line.

## Follow-ups (tracked, not built)

Stale-view fingerprint (409 changed_since_viewed); lead-owned audit line suppression; leadwright must agree and pin the `> text - pointer` quote shape (S1-E).
