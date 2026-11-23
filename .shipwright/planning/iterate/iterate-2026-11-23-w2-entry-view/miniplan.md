# Mini-plan W2: structured entry view (iterate-2026-11-23-w2-entry-view)

Goal: each proposal in the countersign window shows proposed line, lead, beat, evidence pointer, and each quote as its own element; malformed pointers show "unknown source"; keyboard + screen reader work.

Work: (1) pure view-model `client/src/lib/orgProposedView.ts` (fence region parse: `>` lines = quotes, ` — pointer` suffix; pointer grammar `session:time:number` + legacy long form); (2) `DecisionEntryDetail.tsx` renders it as plain text (dl for fields, labelled quotes list); (3) `DecisionEntryRow.tsx` slimmed, labelled li + descriptive button name; (4) unit tests + real-browser E2E (roles, focus order, injection text); (5) contract doc section. Client only; no server/route change; grammar mirror untouched.

Alternative considered: extend the parser `ProposedDecisionEntry` with quotes. Rejected: it is a verbatim mirror of server code under a drift guard; a read-only display model avoids touching it.

Risks: quote format is not yet defined by leadwright (S1-E) - convention documented; no "Open source session" link as no target exists.
