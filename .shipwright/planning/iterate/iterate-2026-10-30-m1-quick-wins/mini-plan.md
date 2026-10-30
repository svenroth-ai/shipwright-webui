# Mini-plan M1 - quick wins: no error cards, compact subrunner row

Acceptance criteria (spec AC was TBD; defined here):
- AC1 A failed plain command (is_error, not test/subrunner bucket) renders NO card: no "A command failed: ..." text, no blocker kind, no red err pill, no raw output.
- AC2 The "This run ended before the blocker was resolved..." / "Claude may retry..." reconcile explanation is gone. kind "blocker" no longer exists.
- AC3 Genuine interactive blockers/questions are unaffected: they are kind "user-input" (AskUserQuestion bucket), produced by a different path (bucket user-input), kept and still covered by tests. Test-failure cards (kind test, Failing pill) and failed subrunner cards ("failed") remain.
- AC4 Shipwright-specific cards (delivery card w/ commit message + PR box, stop-hook card, gate/decision cards) untouched.
- AC5 (amended after Stage-1 round 1 and the external plan review: a title attribute is hover-only and unreliable on touch/keyboard) Subrunner card: the status glyph inside the report link is line-size (1em) via CSS; the readable dispatch title (card.text) is shown as VISIBLE text on the card directly above the link, never a hash. No title attribute. Subagent transcript view NOT built.

Changes: delete missionActivityFeedBlockerError.ts / BlockerText.ts(+test); attachDetail moved to missionActivityFeedDetail.ts; resolve: generic is_error => continue (no mutation), recovery branch + unresolvedBlockers removed; reconcile blocker explanation loop removed; Card.tsx blocker disclosure + textLiteral removed; ActivityKind "blocker" removed; icons/accent/CSS cleanup; tests updated; e2e transcript-fidelity spec flipped to assert absence.
