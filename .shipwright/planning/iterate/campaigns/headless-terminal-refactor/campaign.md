---
campaign: headless-terminal-refactor
branch_strategy: stacked
created: 2026-05-11T20:42:25.681361+00:00
---

# Campaign: headless-terminal-refactor

## Intent

Refactor embedded terminal replay from byte-stream disk-scrollback to server-side @xterm/headless cell-state snapshots. ADR-087 supersedes ADR-069/077/079/086. Plan of record: .shipwright/planning/embedded-terminal-refactor-headless.md

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
| A | headless-mirror-flag | Headless mirror behind feature flag | pending |
| B | replay-snapshot-protocol | Replace replay protocol with snapshot envelope | pending |
| C | retire-compensations | Retire ADR-069/077/079/086 compensations | pending |
