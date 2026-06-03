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
  // iterate-2026-06-02-all-projects-create-cascade — project-first create menu
  'CreateControls',
  'ProjectCreateCascade',
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
