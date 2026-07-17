/**
 * Doc-sync meta-test.
 *
 * Catches drift between newly-shipped production modules and the
 * agent-facing documentation surface.
 *
 * Source-of-truth split (since Phase 0f compliance-hygiene cleanup,
 * commit f4d52fd, 2026-05-22):
 *
 *   - File map (every shipped component / module / config) lives in
 *     `.shipwright/agent_docs/architecture.md` and
 *     `.shipwright/agent_docs/component_inventory.md`. The 112-line
 *     file-tree dump that used to live in `CLAUDE.md` was deleted —
 *     it duplicated `architecture.md` + `component_inventory.md` and
 *     rotted fast.
 *   - Load-bearing DO-NOT regression guards still live in `CLAUDE.md`
 *     (the always-loaded context for every agent run).
 *
 * Each token below MUST appear at least once in the file-map bundle
 * (CLAUDE.md ∪ architecture.md ∪ component_inventory.md). When adding
 * new production components/modules in future iterates, extend the
 * list here as part of the same commit.
 *
 * See:
 *   - agent_docs/decision_log.md — ADR-044 (iterate 3 close-out).
 *   - planning/iterate-3/sections/06-doc-sync-and-iterate-close.md — spec.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Vitest runs this under Node, so `fs` + `path` are available at runtime —
// the client has no `@types/node`, so we minimally type the dynamic imports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;

const REQUIRED_TOKENS = [
  // Iterate 3 client components (section 3.3 + 3.4)
  'FolderTree',
  'SmartViewer',
  'NewIssueModal',
  'PreviewButton',
  'CreateMenuSplitButton',
  'TaskDetailThreePane',
  // Iterate 3 server modules + config
  'default-actions.json',
  'project-actions-loader',
  'actions-substitute',
  'preview-session-manager',
  'path-guard',
  'gitignore-cache',
  // Iterate 4 (ADR-067) — embedded terminal
  'EmbeddedTerminal',
  'useTerminalSocket',
  'pty-manager',
  'image-paste',
  // Iterate 5 (ADR-068-A1) — embedded-terminal auto-launch + disk persistence
  'ScrollbackStore',
  'LaunchCoordinatorContext',
  // iterate-2026-05-30-smartviewer-render-ux — SmartViewer document renderer + pop-out
  'DocumentMarkdown',
  'PreviewPage',
  // iterate-2026-05-31-smartviewer-popout-modal — centered in-app pop-out modal
  'SmartViewerModal',
  // iterate-2026-05-31-reopen-done-task — done → draft re-open
  'TaskCardMenu',
  'taskReopenApi',
  // iterate-2026-05-31-terminal-readonly-keepalive — WS liveness keepalive
  'ws-heartbeat',
  // iterate-2026-06-02-campaigns-board-lane — Campaigns lane (FR-01.31)
  'campaign-paths',
  'campaign-store',
  'campaign-parse',
  'CampaignLaneCard',
  'campaignsApi',
  'useCampaigns',
  // iterate-2026-06-03-campaign-status-filter — producer-owned lifecycle status
  'campaign-status-json',
  // iterate-2026-06-03-smartviewer-video-view — inline <video> + Range /media route
  'VideoRenderer',
  'mediaApi',
  // iterate-2026-06-03-campaign-autonomous-launch — autonomous campaign launch (FR-01.34)
  'CampaignAutonomousLaunchButton',
  'useLaunchCampaign',
  'campaign-branch',
  // iterate-2026-06-02-all-projects-create-cascade — project-first create menu
  'CreateControls',
  'ProjectCreateCascade',
  // iterate-2026-06-03-smartviewer-markdown-editor — in-app markdown editor (FR-01.35)
  'MarkdownEditorModal',
  'MarkdownDiffView',
  'markdownTiptap',
  'markdownFileApi',
  // iterate-2026-06-04-md-editor-toolbar — formatting toolbar for the markdown editor
  'MarkdownEditorToolbar',
  // iterate-2026-06-04-campaign-step-launch — one-click single-sub-iterate launch (FR-01.36)
  'CampaignStepLaunchButton',
  'useLaunchCampaignStep',
  'campaign-step-branch',
  // iterate-2026-06-08-campaign-attached-run-guard — double-launch guard (FR-01.33/34/36)
  'campaign-loop-state',
  // iterate-2026-06-11-campaign-events-projection — project board status from tracked events.jsonl (FR-01.31)
  'campaign-events',
  // iterate-2026-06-12-campaign-dismiss — manual board dismiss/restore (FR-01.33)
  'dismissed-campaigns-store',
  'campaign-route-helpers',
  'CampaignsLane',
  'CampaignDismissButton',
  'useDismissCampaign',
  // iterate-2026-06-14-tablet-responsive-view — tablet (≤1023px) responsive layout (FR-01.38)
  'useIsCompactViewport',
  'PaneTabBar',
  // iterate-2026-06-14-phone-responsive-view — phone (<768px) responsive layout (FR-01.39)
  'useIsPhoneViewport',
  'TerminalKeyBar',
  // iterate-2026-06-15-mobile-tablet-layout-polish — header/list/projects/sidebar polish (FR-01.41)
  'MobileTopBarSlot',
  'BoardStatusFilter',
  // iterate-2026-06-15-phone-header-polish — phone "+ New" flat drill-down (FR-01.41 follow-up)
  'ProjectCreatePhoneMenu',
  // iterate-2026-06-17-board-dnd-status-decouple — board column decoupled from
  // session state + drag-and-drop (boardColumn override, schema v4)
  'TaskBoardColumns',
  'boardColumnApi',
  'board-column',
  // iterate-2026-06-30-compliance-grade-webui — per-project compliance Grade
  // badge + detail modal (FR-01.43), read-only observer of dashboard.md
  'compliance-reader',
  'complianceApi',
  'useProjectCompliance',
  'ComplianceGradeBadge',
  'ComplianceDetailModal',
  // iterate-2026-07-06-terminal-theme-modes — embedded terminal light/dark
  // appearance (FR-01.44), mirror Claude Code + VS Code truecolor parity
  'claude-theme-reader',
  'terminal-appearance',
  'xterm-theme-options',
  'useTerminalAppearance',
  // iterate-2026-07-06-collapse-dialog-more-options — collapsed-by-default
  // gray "More options" wrapper below the create-dialog Description
  'MoreOptionsDisclosure',
  // iterate-2026-07-09-w2-master-launch-handoff — single-session master launch
  // mechanism (campaign webui-pipeline-convergence W2): server launch branch +
  // client hook + API wrapper (no UI yet — consumer lands in W3)
  'master-run-branch',
  'masterRunApi',
  'useLaunchMasterRun',
  // iterate-2026-07-09-w3-single-session-board — the campaign-like single-session
  // pipeline board card (campaign webui-pipeline-convergence W3): a mode-selecting
  // lane host + the card + its one Launch/Resume CTA + the steady-progress helper
  'PipelineLaneCard',
  'SingleSessionRunCard',
  'MasterRunLaunchButton',
  'pipelineProgress',
  // iterate-2026-07-10-design-gate-review-host — single-session design-gate
  // mockup review hosting (FR-01.45): gate observer + viewer host + round
  // feedback write + the client overlay/panel/hook.
  'run-loop-state-reader',
  'design-feedback',
  'design-review',
  'designReviewApi',
  'useDesignGate',
  'DesignGatePanel',
  'MockupReviewOverlay',
  // iterate-2026-07-10-intent-wizard — the guided three-door front entry
  // (New/Adopt/Grade) + the real First-Contact readiness gate (FR-01.51)
  'IntentWizard',
  'useReadiness',
  'readiness-probe',
  'createReadinessRoutes',
  // iterate-2026-07-10-board-campaign-launch (A17, FR-01.61) — the launch
  // state machine: one failure-words map, three surfaces, visible + recoverable.
  'launchFailure',
  'LaunchFailureNotice',
  'CampaignLaunchDialog',
  'CampaignStartButton',
  'LaunchFailureRecovery',
  'taskCardState',
] as const;

let claudeMd = '';
let docsBundle = '';

beforeAll(async () => {
  // Dynamic import keeps the TS type-check free of @types/node.
  // Vitest exposes both ESM and CJS interop at runtime.
  const fs = await import('node:fs' as string);
  const path = await import('node:path' as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = await import('node:url' as string) as any;
  const here = path.dirname(url.fileURLToPath((import.meta as any).url));
  // client/src/test → ../../../ (= repo root)
  const repoRoot = path.resolve(here, '../../../');
  claudeMd = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
  const architectureMd = fs.readFileSync(
    path.join(repoRoot, '.shipwright/agent_docs/architecture.md'),
    'utf8',
  );
  const componentInventoryMd = fs.readFileSync(
    path.join(repoRoot, '.shipwright/agent_docs/component_inventory.md'),
    'utf8',
  );
  // The file-map bundle: each token must appear in at least one of
  // these three docs. CLAUDE.md kept in the bundle so legacy entries
  // (preview-session-manager, path-guard, etc. that are already mentioned
  // in DO-NOT guards) keep counting toward coverage.
  docsBundle = `${claudeMd}\n${architectureMd}\n${componentInventoryMd}`;
});

describe('doc-sync: file-map bundle (CLAUDE.md + architecture.md + component_inventory.md)', () => {
  for (const token of REQUIRED_TOKENS) {
    it(`mentions "${token}" in at least one agent-facing doc`, () => {
      expect(docsBundle).toContain(token);
    });
  }
});

describe('doc-sync: CLAUDE.md guards', () => {
  it('has at least one reference to ADR-044 (iterate 3 close-out)', () => {
    expect(claudeMd).toMatch(/ADR-044/);
  });

  it('has the DO-NOT guard #11 about hardcoded shipwright-run strings', () => {
    expect(claudeMd).toMatch(/shipwright-run/);
    expect(claudeMd).toMatch(/\/api\/external\/projects\/:id\/actions/);
  });
});
