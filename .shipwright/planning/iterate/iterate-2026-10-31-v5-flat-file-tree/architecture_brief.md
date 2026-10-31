# Architecture brief
Need: a row actions menu (open, copy absolute path, copy relative path) in the shared file tree, flat layout in the Mission sidebar.
Options: (A) do nothing - users cannot copy paths; (B) add @radix-ui/react-context-menu dependency; (C) reuse already-installed Radix DropdownMenu + Dialog with a virtual cursor anchor, no new dependency, no server change.
Chosen scope: C; purely client-side, no new persisted state, no new routes.
