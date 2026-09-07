# Architecture Brief: ac-scoped-layer-promotion

## The problem
This repo's CI job that regenerates and diffs the traceability manifest
checks out a fixed commit of a sibling repo's compliance tooling; that
pinned commit predates a compatible schema upgrade in the sibling repo, so
the pinned collector cannot yet write the new schema shape.

## What would newly, permanently exist
Nothing. This changes machinery that already exists: the pinned `ref:` on
an existing "Checkout shipwright-compliance plugin (pinned)" CI step moves
to a newer commit of the same already-pinned, already-reviewed sibling
repository.
