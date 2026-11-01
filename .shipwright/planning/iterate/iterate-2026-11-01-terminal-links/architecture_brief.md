# Architecture Brief: terminal-links

## The problem
File paths that Claude or build tools print in the embedded terminal (e.g. `src/a.ts:12`, `C:\proj\b.md`) are plain text. To look at one, the operator copies it and hunts for it in the file tree. Web links in the same terminal are already clickable.

## What already exists here
- A web-links addon in the terminal opens http(s) links in a new tab on plain click.
- Mission chat renders file paths as chips that open the Smart Viewer via a shared "file open" context, resolving relative paths against the session cwd and routing outside-project files through a server route that only serves paths the session evidences.
- The Files & Terminal page hosts the same right-hand info sidebar (Info | Viewer) next to the terminal.

## What would newly, permanently exist
Nothing server-side. One small client module that recognises file-path text in the terminal buffer and hands it to the existing open path. It is kept correct by its unit tests.

## Options on the table
- **A:** A second xterm link provider in the client that detects paths in the buffer and calls the existing file-open path.
- **B:** Extend the existing web-links addon regex to also match paths.
- **C:** Detect paths on the server in the pty output stream and send link hints to the client.
- **D:** Do nothing (operator copies paths by hand).

## Constraints that are not negotiable
No change to pty, replay, snapshot, renderer, resize or scrollback behaviour; no change to the server's rule about which outside files may be served.
