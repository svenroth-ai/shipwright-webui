# One assembled event-log reader for both plugin layouts

Run: `iterate-2026-11-07-events-drop-files-reader` (shipwright campaign `events-drop-files`, issue 978, units S1 + S5b).
Full contract, acceptance criteria and review dispositions: `.shipwright/planning/iterate/iterate-2026-11-07-events-drop-files-reader.md`.

## Decision

Every WebUI reader of the project event log reads it through ONE pure assembler
(`server/src/core/event-log-assemble.ts`), fed by a working-tree loader (`event-log-files.ts`) or an
`origin/main` loader (`mission-context/ref-event-log.ts`, `git ls-tree -z` + one `git cat-file --batch`).
The assembler is the TypeScript twin of the plugin's `events_read.py`: legacy file in file order, then archive +
drop records sorted by (instant, id); per-file status; the duplicate-id rule; drop/archive `event_amended`
overlays for run projections only. Campaign status reads the raw lines (Python parity).

Bullet drops (`decision-drops/bullets/*.md`) are read by `doc-bullets.ts`: the Mission Decisions artifact shows a
run's documentation updates (folded + pending, Python `insert_bullets` rules), and the Documents column shows the
pending ones as their own group. No `.md` file is ever read as an ADR.

## Options considered

- **A — one assembler, projections unchanged on top** (chosen): one place to keep in step with Python; the existing
  reader tests stay the "no folders = no change" regression check.
- **B — teach each projection the new layout:** six copies of the order/dedup/amendment rules, each able to drift.
- **C — read the drop folder only, no archive / status:** breaks at the first release fold (runs disappear) and
  reads a damaged file as "no record".
- **D — do nothing:** blocks the plugin's layout flip (S9a precondition 1).

## Deliberate divergences from Python

Listed in the iterate spec ("Divergences from Python, by decision"): corrupt fragments kept as raw lines, legacy-file
amendments not overlaid, campaign status without amendments (monorepo follow-up), the Documents panel's separate
pending group, learnings left out of per-run doc updates, merged-not-pulled pending bullets not read from
`origin/main`.
