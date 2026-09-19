# Architecture Brief: fix-wizard-plan-card-white-text

The New-Project wizard's "Here's what I understood." plan card renders its
per-phase description text invisible (white on white). Two options:

1. Add `className="iw-card"` to the phase-list container (an existing
   shared class already used identically by a sibling block in the same
   file), so it joins the app's `.on-photo` solid-surface CSS reset.
2. Hardcode a dark text color inline on the phase-description element only.

This adds no new permanent structure — it is a one-class-attribute change on
an existing element in an existing component, using an existing shared CSS
class.
