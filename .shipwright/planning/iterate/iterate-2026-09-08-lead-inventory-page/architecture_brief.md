# Architecture Brief: lead-inventory-page

The PO wants a morning-view page showing, per autonomous AI "lead" agent:
last night's units of work ("beats"), each with its ordered authority-band
decisions ("steps"), the lead's declared authority (from its charter file),
open questions needing the PO's attention, and a warning when a beat did
something no step accounts for. All data already exists on disk, written by
a separate agent-runner system ("leadwright") this repo has no build-time
dependency on; nothing here is new leadwright-side capability, only new
reading of existing files.

## Options considered

**A. New page + new roster-wide composite server route**, following this
repo's existing pattern for the adjacent `/org` page (one composite endpoint
per page, pure-core-plus-route-plus-degrade, reusing several already-guarded
readers unchanged).

**B. Fold the new data directly into the existing `/org` page's per-lead
card**, rather than a new route/page.

**C. Do nothing now — wait for a dedicated leadwright-side API** that
returns this exact assembled shape, instead of reading and assembling raw
on-disk files in this repo's server layer.
