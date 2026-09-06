# Architecture Brief: org lead staleness + open beat-register findings on the card

## The problem

A lead whose last run is overdue relative to its own cadence looks
identical, in the webui org page, to a lead that is fine — both read
"Resting." Separately, when a lead's beat-register file has an entry that
was opened and never closed, the operator has no way to see that from the
org page or take any action on it; they would have to inspect a JSON file
on disk by hand. Both facts are already computed by the server on every
roster read; the browser client currently discards them before they reach
the screen.

## What already exists here

- The server computes staleness and the register's open/clear/fault state
  on every `GET /api/org/leads` read (already-existing per-lead file
  reads, no new I/O).
- A release action for a stuck register entry already exists as an HTTP
  route, but only on the secret-gated (non-browser) route family.
- The org page already has a card-based lead roster UI that renders other
  per-lead figures (usage, cadence, role) the same way this data would be
  rendered.

## What would newly, permanently exist

A second HTTP route exposing the SAME release action to the browser
(currently only reachable with a shared secret, not from the UI). It is a
thin proxy — no new locking, mutation, or audit logic — but it is a new
network-reachable, state-mutating entry point that the project must keep
secured (leadId membership check, session-id validation) for as long as
the org page exists. The response payload each roster entry carries also
permanently grows by two fields.

## Options on the table

- **A:** Add the fields to the existing roster response and add a
  browser-facing proxy route for the existing release action.
- **B:** Add the fields to the roster response, but leave the release
  action reachable only through the secret-gated route (the operator uses
  a separate tool/terminal command to clear a stuck entry; the UI only
  shows the finding, not a button).
- **C:** Do nothing — leave both facts uncomputed for the browser and rely
  on the existing secret-gated routes for anyone who needs them.

## Constraints that are not negotiable

The webui architecture rule that the server is stateless on transcript
reads does not apply here (this is a different subsystem — leadwright org
data, not Claude session transcripts). No other hard constraint applies;
this is a net-new UI surface over existing data, not a change to an
established contract.
