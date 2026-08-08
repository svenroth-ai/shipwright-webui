# Architecture Brief: tests-total-skip-contract

## The problem

This webui project and a sibling toolchain repository disagree about what a
number in their shared event log means. One side treats a "skipped" test as
outside the total; the other treats it as included. Right now, any run in
this project that has a platform-gated skipped test (this has already
happened) risks being displayed somewhere in this project's UI as if it
failed, or is undercounted, even though it was genuinely green. This has
already caused incorrect-looking records that needed manual correction at
least twice in this project's own history.

## What already exists here

- A guard test (`event-test-counts-executed.test.ts`) that checks every
  recorded run's test counts follow one specific meaning of "total."
- Several UI functions (Mission tab record rail, Ship's-Log cards, a verdict
  banner) that independently read a run's recorded pass/total numbers to
  decide whether to show it as "green."
- A similar guard/reader pair for a second, separate part of the app (the
  live Mission tab's own resolver) that reads the same kind of number.

## What would newly, permanently exist

One small, pure function (plus its exact one-line mirror in the two places
the app is split into) that decides "is this run's recorded test count
accounted for" — used everywhere the app currently answers that question by
hand. It also gains one new cutover date, alongside a cutover date the guard
test already has for an earlier, unrelated correction — from that date
forward, the number is read one way; before it, the other way. Nothing new
is scheduled, nothing new writes external state, and no new credential or
service is involved — it only changes how already-recorded numbers are
interpreted when displayed.

## Options on the table

- **A:** Change this project's meaning of "total" to match the sibling repo
  (the sibling repo is the one that actually writes these numbers for every
  project, not just this one).
- **B:** Change the sibling repo back to match this project's current
  meaning.
- **C:** Do nothing — leave the disagreement as-is.

## Constraints that are not negotiable

The sibling repo's current meaning is already shipped, tested, and in active
use by other projects it manages, not just this one.
