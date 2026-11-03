Goal: A file path that spans two or more terminal rows is one clickable link that opens the full path
Reason: Claude's TUI hard-wraps long paths with a real newline (no isWrapped), so the link provider produced two broken partial links
Reference: Sven bug report 2026-11-03 (screenshot img-1793694044974)
