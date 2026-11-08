# Architecture Brief: triage-page-redesign

## The problem
The Triage page forgets the operator's filters and sorting on every reload, looks different from the Board, hides
what a bundled compliance card actually contains, and offers no plain-language explanation of source labels or
audit-check codes. Daily use with about five open items is awkward.

## What would newly, permanently exist
Nothing outside the browser UI. This changes machinery that already exists (the Triage page, its filter/sort logic
and its cards), adds one versioned view-preference entry in the browser's local storage, and one static English
help-text file that must be kept in step with the known audit-check codes.

## Options on the table
- **A:** Rebuild the page around one aggregated, groupable list with Board-style header controls, saved view, and
  new cards.
- **B:** Keep the per-project sections and only add persistence plus the missing help texts.
- **C:** Do nothing.
