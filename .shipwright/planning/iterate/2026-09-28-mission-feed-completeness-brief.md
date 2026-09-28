# Architecture Brief: mission-feed-completeness

Should this change be built at all?

**Context:** The webui "Mission" tab shows a live narration + artifact panel
for a Claude Code session. A user found 6 concrete defects in it while
reviewing one real, finished session: (1) the "session started" divider
reports a misleadingly-late time, (2) a real, finished iterate's whole
artifact panel silently renders empty because the server-side run-id
recovery scan only looks at the transcript's last 1 MiB and this session's
commit footer sat ~2.8 MB earlier in a 4.9 MB file, (3) a transient
harness/tool-classifier hiccup gets permanently rendered as a "command
failed, never resolved" card, (4) some cards render as a bare "1 command"
chip with no text at all, (5) an ordinary closing status message renders
with the dashed/gear "system event" styling reserved for a real context-
compaction marker, (6) two review-subagent cards never leave "Running…"
and can't be clicked, because their completion arrives as a JSONL
`attachment` record the parser doesn't recognize as a task notification.

**Proposed fix shape:** six narrow, independent fixes inside the existing
`missionActivityFeed*`/`session-parser.ts` client modules and two constants
in the server's mission-context resolver (`RECOVERY_TAIL_BYTES`/
`MAX_SCAN_CHARS`, 1 MiB → 8 MiB). No new components, no new data model, no
new artifact-chip kind — all six problems are classification/derivation bugs
in code that already exists and is already exercised by an extensive Vitest
suite for this exact area.

**Question:** should this be built as a single change iterate touching these
existing files, or does any of it actually call for a bigger structural
change (e.g., replacing the fixed-byte-tail recovery scan with a different
identification mechanism entirely, or restructuring the activity-feed
reducer's card-classification model)?
