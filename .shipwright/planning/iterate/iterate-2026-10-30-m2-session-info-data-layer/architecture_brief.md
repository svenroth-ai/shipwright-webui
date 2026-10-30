# Architecture brief
Need: Mission desktop UI (later units) must show context tokens, output files, Remote Control and subagents for a session.
Options: (A) new server-side read-only reader + one endpoint deriving from Claude's own JSONL/sessions files (chosen); (B) client parses /transcript chunks itself (needs whole history incl. subagent files the transcript route does not expose; 100MB+ files); (C) do nothing / show nothing.
Permanent additions: one endpoint, a core/session-info module (scanner, collector, subagents, remote-control), a size/mtime-keyed memo (function cache, no cursors).
