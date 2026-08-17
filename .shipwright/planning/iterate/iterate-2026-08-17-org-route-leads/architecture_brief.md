# Architecture Brief: org-route-leads

## The problem

leadwright's org directory (`~/.claude/leads/**` — conventions, decision log,
per-lead charters, an org chart) currently has no network-reachable read/write
path from the webui Command Center; a PO editing these files today does so
directly on disk, outside any UI, with no optimistic-concurrency protection
against leadwright's own daemon process writing the same files. There is also
no way for a PO to countersign a leadwright-daemon-proposed decision-log entry
without hand-editing two files and hand-assigning the next sequential number.

## What already exists here

- `PUT /api/external/projects/:projectId/file` — project-relative markdown
  write with path-guard, symlink defense, atomic write, `If-Match` optimistic
  concurrency. No lock (single global writer per file in practice).
- A single application-wide bind-host resolution (`resolveHonoHost`) already
  distinguishes loopback / Tailscale / open-network deployments.
- `proper-lockfile` is already the standard multi-writer lock primitive in
  this repo (`sdk-sessions.json`, `dismissed-campaigns.json`, triage), always
  within a single process boundary until now.

## What would newly, permanently exist

A network-reachable route family under `/api/external/org/*`, gated by a new
shared secret and a bind-host allowlist, that reads and writes a small,
enumerated set of files under `~/.claude/leads/**` (a directory outside any
Shipwright project root) — plus one action (decision countersigning) that
holds a cross-process file lock shared with a second, independently-developed
process (leadwright's daemon) on the same file. The secret, the allowlist, and
the lock contract all need to stay correct as both repos evolve.

## Options on the table

- **A:** Build the route now in the webui, scoped to exactly the file set and
  actions item 2A of the triage doc names (write allowlist of 5 docs +
  charter, org-chart read, countersign action, usage-read stub).
- **B:** Wait until leadwright's §9 Schritt 0a (daemon + beat register) lands
  and ship items 2A and 2B as one combined route.
- **C:** Do not add a webui route; leave org-document editing as direct
  filesystem access outside the webui.

## Constraints that are not negotiable

- Loopback-only-by-default posture: the app already gates network exposure
  through one global bind-host value; a new route cannot introduce a second,
  independent way to reason about "is this instance reachable from outside".
- No cross-package/cross-repo source import (CLAUDE.md rule 7's discipline
  extends here) — this repo cannot depend on leadwright's build output.
