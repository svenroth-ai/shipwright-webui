---
campaign: 2026-05-25-bloat-cleanup-C-webui
branch_strategy: stacked
created: 2026-05-25T20:23:00.004389+00:00
---

# Campaign: 2026-05-25-bloat-cleanup-C-webui

## Intent

Campaign C — WebUI bloat cleanup (8 sub-iterates). Source plan: ../shipwright/Spec/Launch preparation bloat cleanup.md §6.2/§7.1/§9. Topology (linearized from source-plan C1 → C8 → (C6 ∥ C3 ∥ C4 ∥ C7) → C5 → C2 to serial chain): C1 → C8 → C6 → C3 → C4 → C7 → C5 → C2. Precondition: Campaign A.defense merged at 15dcc67 (PR #62, 2026-05-25). Baseline frozen at 86 grandfathered entries on origin/main. WebUI has NO plugin Stop-gate — only pre-commit hook + CI workflow enforce, so every sub-iterate's pre-merge gate is the bloat-check workflow PR-comment which MUST report ':white_check_mark: no anti-ratchet violation' AND must NOT list any 'New crossings (advisory)' rows. Spec-only authoring forbidden — every iterate runs F0.5 empirically.

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
| C1 | claude-md-verify | CLAUDE.md verification (Phase 0f already handled) | pending |
| C8 | pty-manager-bloat-exception-adr | pty-manager.ts state=exception ADR | pending |
| C6 | task-detail-header-split | TaskDetailHeader.tsx → shell + StateBadge + LaunchCTA + ResumeCTA + TitleEdit | pending |
| C3 | bubble-transcript-split | BubbleTranscript.tsx → shell + TranscriptRow + ToolOutputBlock + MarkdownChunk + AnsiText + useTranscriptScroll | pending |
| C4 | new-issue-modal-split | NewIssueModal.tsx → ModalShell + NewPipelineModal + NewIterateModal + NewTaskModal | pending |
| C7 | inbox-page-split | InboxPage.tsx → page + inbox/{PendingSection,HistorySection,InboxFilters} + useInboxData | pending |
| C5 | embedded-terminal-split | EmbeddedTerminal.tsx → shell + usePasteImage + useTerminalResize + terminal/xtermAddons (HIGH RISK) | pending |
| C2 | external-routes-split | external/routes.ts → sub-routers per concern (HIGH RISK, LAST) | pending |
