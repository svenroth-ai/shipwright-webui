# Architecture Brief: org-page

## The problem

The operator runs several autonomous AI "leads" (a separate `leadwright`
tool) but has no way to see them from inside the Command Center — no view
of who they are, what they're doing right now, or their recent activity. To
check on a lead today the operator has to leave the app entirely and read
raw files on disk.

## What already exists here

- A host+secret-gated API family (`/api/external/org/*`) that lets the
  separate `leadwright` process itself read/write a handful of organization
  files over loopback or the operator's own Tailscale network.
- The Command Center's plain `/api/*` surface, which the browser already
  calls freely with no additional gate beyond CORS.
- An existing markdown-editing modal (load-fresh / checksum-precondition /
  save) used elsewhere in the app for a different, project-scoped document
  type.
- A sidebar and a command palette, both currently populated from a fixed,
  always-visible list of destinations.

## What would newly, permanently exist

A new page in the Command Center showing the operator's leads (an org chart
plus a card per lead), a new server-side route family the browser calls to
read/edit that data, a new pair of mirrored data-shape definitions (server
and client) that must be kept in sync as the underlying data model evolves,
and a new pattern where a sidebar/palette entry can be conditionally present
depending on whether an external tool is installed. All four are things the
project keeps running and reasoning about from now on, not one-off code.

## Options on the table

- **A:** A new route family, in the same server process, that reuses the
  existing org-data logic directly (no network hop, no new secret handling)
  and serves the browser over the app's existing plain API surface.
- **B:** A new route family that calls the existing secret-gated API family
  over HTTP (loopback), with the server itself holding and attaching the
  secret on the browser's behalf.
- **C:** Expose the existing secret-gated API family directly to the
  browser, giving the browser the shared secret needed to call it.
- **D:** Don't build a page in the Command Center; leave lead visibility to
  reading files directly or to a separate tool.

## Constraints that are not negotiable

- The read route that lists all leads (`org-chart.json`) is not to be
  changed in its response shape by this work — it already has other,
  contract-tested consumers.
- Whatever is built runs only where the Command Center itself already runs
  (same machine or the operator's own Tailscale network) — nothing in this
  project is meant to be reachable over the open internet.
