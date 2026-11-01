# Architecture Brief: one file tree and one Info/Viewer sidebar for both task-detail tabs

## The problem
The task page has two tabs that show the same kind of things in two different ways: Mission has a flat file tree and an Info/Viewer sidebar, while Files & Terminal still has an older boxed file list and a separate "Preview" panel. On a phone the Files & Terminal tab needs a second row of tabs under the first one.

## What already exists here
- The shared flat file tree with the right-click / long-press menu (Mission, Folders segment).
- The Mission info sidebar (Info, Viewer segments) that already opens files in the Smart Viewer.
- A three-pane layout (left / terminal / right) with a phone tab bar Files | Terminal | Viewer.

## What would newly, permanently exist
A way to host the existing sidebar inside the three-pane (a segment list, a page-owned segment, open-file tabs), a four-tab phone bar with the Expand control, and a shared "expand" state used by two buttons. No server change, no new storage.

## Options on the table
- **A:** Reuse the sidebar and tree as they are, add a small hosting mode to the sidebar, keep the terminal pane untouched.
- **B:** Build a separate Files & Terminal right panel that copies the sidebar parts.
- **C:** Do nothing: keep two different tree/viewer UIs and the second tab row on phones.

## Constraints that are not negotiable
The embedded terminal subtree must stay mounted and unchanged (no pty / replay / resize behaviour change); read-only on the user's files and Claude JSONL; no chat surfaces; English UI strings.
