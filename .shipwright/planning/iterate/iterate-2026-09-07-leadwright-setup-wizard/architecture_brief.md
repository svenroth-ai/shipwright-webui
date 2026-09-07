# Architecture Brief: leadwright lead-setup wizard

## The problem

Setting up a new leadwright lead today means a person hand-edits three
separate files (`org-chart.json`, a `charter.md`, `daemon-config.json`) that
must agree with each other in ways nothing checks before the daemon is
restarted. A typo'd domain string, a relative path where an absolute one is
required, or a missing charter band fails silently — the lead either never
claims work or the daemon errors at a point far removed from the mistake.

## What already exists here

- A read-only org-chart view and a charter-only write route
  (`PUT .../charter`) in webui's org routes.
- A leadwright-side preflight checker (`scripts/check-setup.ts --stdin
  --json`) that can validate a *proposed* setup (org chart + charters +
  daemon config) and report every unsatisfied requirement — but nothing
  today calls it from outside leadwright's own repo interactively.
- A generic step-by-step wizard UI pattern already used for other flows in
  this app (one question per screen, a live summary panel beside it).
- A file-locking pattern already used for two other multi-writer JSON/MD
  files in this app.

## What would newly, permanently exist

A new wizard flow that collects the answers needed to create one lead, calls
the leadwright checker as a subprocess to get a real pass/fail verdict before
allowing the user to finish, and then writes the three files itself (through
the existing/adapted locking pattern). A new webui config setting pointing at
a local leadwright checkout is required for the subprocess call to work at
all — its absence must block finishing the wizard, not silently skip the
check. A new shared list of "known lead domains" that both this wizard and
an existing free-text field draw from, replacing an unchecked string match.

## Options on the table

- **A:** Build the guided wizard as described — collects answers, calls the
  external checker as a subprocess for a live verdict, writes the three
  files itself once the verdict passes.
- **B:** Build a lighter-weight form (not a multi-step wizard) that still
  calls the external checker before writing, skipping the step-by-step /
  live-summary UI treatment.
- **C:** Do nothing in webui — document the three-file process and rely on
  a person running the existing CLI checker manually before hand-editing the
  files themselves.

## Constraints that are not negotiable

- The three underlying files' shapes and validation rules are owned by
  leadwright, not this app; webui must not re-implement or duplicate that
  logic — it may only call the existing checker and act on its answer.
- The webui process must never write into a file it does not have exclusive,
  lock-protected access to at write time, matching how this app already
  treats every other multi-writer file it touches.
