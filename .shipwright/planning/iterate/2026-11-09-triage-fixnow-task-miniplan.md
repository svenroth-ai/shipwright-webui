# Mini-Plan: triage-fixnow-task

1. Server: `ExternalTask.fixNowForTriageId?` — create accepts + validates `^trg-[0-9a-f]{8}$`, store persists, loader keeps/drops; client type mirror. Tests first.
2. Client data: `useTriageTaskLinks()` → map `projectId:triageId` → task (latest non-done); `NewIssueModal` gets `fixNowForTriageId` prop → create payload; TriagePage passes it from the Fix-now intent (card and modal).
3. UI: card In progress box + Resolve; In progress tile + chip; Dismiss popup (optional reason) reused for Resolve.
4. Help: `req3-campaign` → Campaign help; generator script writes `.shipwright/planning/triage-help-texts.md`; test keeps it in sync.
5. E2E in real browser; spec/ADR/changelog.

**Alternative rejected:** write link into triage.jsonl (cross-package schema, plugin-owned).
