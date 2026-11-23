# Sub-Iterate: W2 — Structured entry view

Complexity: medium

## Scope

Client. Each entry shows the proposed line, lead, beat, evidence pointer and each quote as its own element; malformed pointers show as unknown source. Split the row and modal to stay under 300 lines.

The brief is the real spec: .shipwright/planning/campaigns/2026-11-23-shadow-proposals-webui-BRIEF.md (unit W2; read sections 0, 1, 2 and 6 first).

## Acceptance Criteria

- [ ] Two quotes are shown separately with their pointers.
- [ ] A malformed pointer shows as unknown source.
- [ ] Keyboard and screen-reader checks pass.
