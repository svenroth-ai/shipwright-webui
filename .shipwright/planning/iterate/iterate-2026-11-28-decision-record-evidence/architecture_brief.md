# Architecture Brief: decision-record evidence and learning labels

## The problem

A lead may now propose a learning and cite the operator's own earlier words: the reason given when rejecting a
proposal, or the note added when countersigning one. The operator's approval window shows such a citation as an
unknown source and hides the quoted words, so the operator cannot see what of theirs the learning rests on. The
learning's reach and importance sit inside the proposed line, easy to miss before approving.

## What already exists here

- The proposals window parses each proposal and shows its evidence pointer and the lead's quote (session excerpt,
  file line, journal event), as plain text, never reading the cited source.
- The app itself writes both cited records: the rejected-decisions list (on reject) and the decisions log (on countersign).
- A browser-facing read-only route family with a host gate; the decisions log is readable as a raw file, the
  rejected-decisions list is not reachable through the generic file route.
- A copy guard that refuses approving a line that repeats a quote.

## What would newly, permanently exist

A read-only server route that, for one pointer and quote, reads the named record file and answers whether the quote
occurs in the operator's reason or note (and with which words). A second copy, in this repo, of the positional
record reader leadwright uses, kept in step by ported test cases. A client-side reading of the learning label. A
committed fixture of a countersigned log block for leadwright to pin.

## Options on the table

- **A:** Server route resolves the pointer against the record and returns the operator's words; the window shows them or a fail-closed notice.
- **B:** Client fetches the raw record files and resolves in the browser (needs the rejected list made readable through the file route).
- **C:** Show the pointer and the lead's quote as text only, as for file and event pointers, without reading the records.
- **D:** Do nothing; the citation stays an unknown source.

## Constraints that are not negotiable

- The lead's own proposed line must never be shown as the operator's words (positional reading of both record formats).
- An unreadable record must not be presented as confirmed operator words.
- No cross-package imports between server and client (mirrors only); no Claude process spawned.
