# Architecture Brief: accessibility guards and phone behaviour for the Mission screens

## The problem
The Mission chat, the Agents window and the Files & Terminal screen were restyled over several steps. Nothing checks that the new colours stay readable, that no text drops below 12px, that every touch control is big enough, or that only the "running" dot moves. On a phone the Agents window is a small centred box with the list squeezed above the detail.

## What already exists here
- A contrast test for the older design tokens, and per-area style tests.
- 44px touch rules on most Mission controls, a bottom sheet for the file menu, wrapped lines in the viewer.
- Reduced-motion handling through one global rule plus a few local ones.

## What would newly, permanently exist
Two style test files (contrast, and 12px / motion / focus-ring / 44px rules), one tiny style file for the focus ring on light surfaces, a "list then detail" state in the Agents window, and a phone-only full-screen layout. No server change, no new storage.

## Options on the table
- **A:** Add the guard tests over the existing style files, fix what they find, add the phone sheet as CSS plus one small piece of component state.
- **B:** Do only the guard tests and leave the phone layout as it is.
- **C:** Do nothing: keep checking by eye in screenshots.

## Constraints that are not negotiable
Read-only on the user's files and Claude JSONL; no chat surfaces; the embedded terminal and its replay/redraw behaviour untouched; English UI strings; colours only through tokens; reduced motion shows the complete final state.
