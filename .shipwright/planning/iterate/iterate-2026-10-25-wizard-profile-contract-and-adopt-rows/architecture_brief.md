# Architecture Brief: wizard-profile-contract-and-adopt-rows

## The problem

The Intent Wizard hands a stack-profile name to the monorepo's `/shipwright-run` inside a free-text line, and the monorepo now reads that line with strict rules; a name or a bracket in the wrong place makes the choice vanish or the run refuse. Separately, the Adopt result screen shows mostly invented sample rows next to a real "Adopt this repo" button.

## What already exists here

- `composeNewBrief` builds the one-line brief with a `(Intake ...)` trailer; the reducer only accepts profile names the server lists as valid.
- `POST /api/adopt/scan` runs the analyzer read-only and already returns the detected profile block; the Profile row is live, the other rows are samples.
- Client/server mirrors of shared rules are guarded by tests that read the other package's source.

## What would newly, permanently exist

A client mirror of the profile-name rule (pattern and length) with a drift test; user text in the trailer is cleaned and the profile item moves first; the scan response gains a small `findings` block (stack, routes, tests, CI, conventions, command names) built from the untrusted snapshot, with a mirrored type and a drift test. No new route, process, or storage.

## Options on the table

- **A:** As described: contract fix + test in the client, `findings` next to `profile` in the existing scan response, rows mapped in the client.
- **B:** Return the whole snapshot to the client and let the client pick what to show.
- **C:** Return finished, worded row strings from the server.
- **D:** Do nothing: leave the other Adopt rows as samples and leave the trailer as it is.

## Constraints that are not negotiable

The monorepo reader (`brief_profile.py`, B2b) reads only the last physical line, the last `(Intake`, requires the `Stack profile:` item before any inner bracket and treats two items as ambiguous. Snapshot text comes from an untrusted repo.
