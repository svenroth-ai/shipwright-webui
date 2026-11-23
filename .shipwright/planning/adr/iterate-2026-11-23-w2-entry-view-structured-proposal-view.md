# ADR: Structured proposal view in the proposed-decisions window (W2)

Run: iterate-2026-11-23-w2-entry-view. Campaign shadow-proposals-webui, unit W2.

## Decision
A read-only client display model (`client/src/lib/orgProposedView.ts`) derives proposed line, beat, evidence pointer and quotes from an entry's raw block; `DecisionEntryDetail.tsx` renders them as plain text. The shared entry parser and its server mirror are untouched. Quote convention (proposal, needs leadwright S1-E sign-off): `> text — pointer` lines inside the fence.

## Architecture Review
- External (glm, openai): approve / approve.
- Internal (architecture-internal-reviewer, opus): approve; option 2 smallest. Fallback to the markdown body for unfenced entries kept.

## Plan review findings (external glm+openai: revise; internal opus-plan-reviewer: medium)
| Finding | Disposition |
|---|---|
| Quote format unagreed with leadwright | accepted: contract doc marks it PROPOSAL needing S1-E sign-off |
| Em-dash in quote text mis-split | accepted-and-fixed: split only when suffix looks like a pointer (id of 4+ chars + colon, or `session ...`) |
| Absent vs malformed pointer | accepted-and-fixed: "unknown source (none given)" vs raw text |
| Classifier only on client, W4 needs it on server | accepted: W4 must move it into the mirrored grammar (note in source + contract) |
| Beat regex unanchored | accepted-and-fixed |
| Inherited pointer claims a source | accepted-and-fixed: labelled "(entry evidence)" |
| section landmark / aria-label hides pending state | accepted-and-fixed: role=group, label follows state |
| Focus restore after close | accepted-and-fixed (OrgSharedDocs hands focus back) |
| Unfenced bodies still markdown | accepted: documented |

## External-Code-Review-Findings (glm, openai: revise)
| Finding | Disposition |
|---|---|
| E2E rmSync deletes real ~/.claude/leads | rejected-with-reason: existing specs share it; runs under the isolated temp-HOME harness |
| Malformed suffix inherits entry evidence | rejected-with-reason: em-dash prose must survive; a non-pointer-shaped suffix is text, not a pointer |
| `2:1` heuristic corrupts text | accepted-and-fixed: id must be 4+ chars |
| Focus-trap assertion weak | accepted-and-fixed: pinned to Close button |
| Modal split not done | rejected-with-reason: modal is 211 lines, under the limit |

## Confidence Calibration
Probes: real-browser E2E with a fixture-shaped entry carrying two quotes, an injected `<img onerror>` quote, a free-text pointer, keyboard tab order and Escape; unit probes for em-dash, ratio suffix, empty quote, anchored beat. Findings fixed and re-probed (two clean runs). Not probed: real daemon output with quotes (none exists yet).

## Self-Review
1 Spec compliance pass; 2 Error handling pass; 3 Security pass (plain text); 4 Test quality pass; 5 Performance pass; 6 Naming/structure pass; 7 Affected boundaries pass; 8 Test hygiene n/a.
