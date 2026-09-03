# FR-04.30 display half — V4b budget display (iterate spec brief)

## Acceptance Criteria
(a) The amount is labelled as CONSUMED with a currency, asserted as a present string; no remaining-allowance word ("budget") appears anywhere on the card.
(b) The display NAMES the un-counted subagent share, and does not quantify it.
(c) unpricedCallsTotal > 0 is visible; 0 is not noise.
(d) Three states render distinguishably: no data (measured: false), PARTIAL (measured: true + anyNotMeasured), and complete.
(e) costUsd: 0 on a measured window renders as a real zero, not as "not measured".
(f) A payload WITHOUT the two new fields still validates and renders — an older producer must not 502.
(g) npm run test, npm run typecheck, npm run lint green (verified independently).

## Traps to avoid
1. No invented remaining-budget number (org chart's budget.usd untouched, may be null).
2. windowDays comes from the payload, never hardcoded to 7.
3. Stat row is shared flex layout with Cadence/Parallel/Projects/Runs — a longer label must not break it.
4. costUsd: 0 is a real value — branch on `.measured`, never on the number's truthiness.

## Out of scope
leadwright changes, org-chart budget fields, claim reorder, the pre-existing hardcoded "not measured" Projects placeholder.
