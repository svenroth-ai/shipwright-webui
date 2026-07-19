/*
 * mission-s3-fixtures.ts — real on-disk sources for the S3 flows
 * (campaign 2026-07-18-mission-artifacts; FR-01.66).
 *
 * Everything here writes the SHAPE the real producers write, because the whole
 * point of the S3 flows is that the resolver reads real files rather than a
 * mock: a run-config with two build phase tasks that differ only by split (so a
 * conflating resolver picks the wrong one), and a campaign directory with a
 * brief, a runbook, per-unit specs and a `status.json`.
 *
 * The ids are HEX on purpose. `run-<8 hex>` / `ptk-<4+ hex>` are enforced by
 * `run-config-reader`, and a non-hex id is silently REJECTED — the phase task
 * vanishes from the config and the card simply never appears, with no error to
 * explain it.
 */

export const RUN_ID = "run-a1b2c3d4";
export const PTK_CORE = "ptk-aaaa";
export const PTK_UI = "ptk-bbbb";
export const CORE_SESSION = "11111111-2222-4333-8444-555555555555";
export const UI_SESSION = "22222222-3333-4444-8555-666666666666";

export const CAMPAIGN_SLUG = "2026-07-18-mission-artifacts";
export const CAMPAIGN_DIR = `.shipwright/planning/iterate/campaigns/${CAMPAIGN_SLUG}`;

/**
 * A run-config with TWO build phase tasks separated only by `splitId`.
 *
 * That is the fixture's job: matching on phase name alone would be ambiguous
 * here, so a regression to phase-matching fails the flow instead of quietly
 * attributing one split's work to the other.
 */
export function runConfig(): string {
  return JSON.stringify(
    {
      schemaVersion: 2,
      contractVersion: 1,
      runId: RUN_ID,
      scope: "full_app",
      autonomy: "guided",
      mode: "single_session",
      deploy_target: "local",
      pipeline: ["build"],
      runConditions: { securityEnabled: false, splitMode: "per_split", aikidoClientIdPresent: false },
      splits_frozen: ["01-core", "02-ui"],
      status: "in_progress",
      completed_phase_task_ids: [PTK_CORE],
      created_at: "2026-07-18T08:00:00.000Z",
      phase_tasks: [
        {
          phaseTaskId: PTK_CORE,
          phase: "build",
          splitId: "01-core",
          sessionUuid: CORE_SESSION,
          version: 1,
          status: "done",
          title: "Run-a1b2 / build / 01-core",
          slashCommand: "/shipwright-build",
          prerequisites: [],
          executionCount: 1,
          createdAt: "2026-07-18T08:00:00.000Z",
          completedAt: "2026-07-18T09:00:00.000Z",
          result: { ok: true, artifacts: ["planning/01-core/plan.md"] },
        },
        {
          phaseTaskId: PTK_UI,
          phase: "build",
          splitId: "02-ui",
          sessionUuid: UI_SESSION,
          version: 1,
          status: "in_progress",
          title: "Run-a1b2 / build / 02-ui",
          slashCommand: "/shipwright-build",
          prerequisites: [PTK_CORE],
          executionCount: 1,
          createdAt: "2026-07-18T09:00:00.000Z",
          startedAt: "2026-07-18T09:05:00.000Z",
        },
      ],
    },
    null,
    2,
  );
}

/** The project's adopted specification — the pipeline's Spec & requirements link. */
export function adoptedSpec(): string {
  return [
    "# Specification — e2e fixture",
    "",
    "## Functional Requirements",
    "",
    "| ID | Area | Name | Priority | Description | Origin |",
    "|----|------|------|----------|-------------|--------|",
    "| FR-01.66 | TSK | Mission view (live session) | Should | The Mission tab. | e2e |",
    "",
  ].join("\n");
}

export function campaignMd(): string {
  return [
    "---",
    "branch_strategy: serial",
    "status: active",
    "---",
    "",
    "# Campaign — mission artifacts",
    "",
    "## Intent",
    "",
    "Make the Mission tab answer what a change actually did.",
    "",
    "## Sub-Iterates",
    "",
    "| ID | Slug | Title | Status |",
    "|----|------|-------|--------|",
    "| S1 | resolver-core | Resolver core | complete |",
    "| S2 | tests-review | Tests and review | in_progress |",
    "| S3 | polish | Pipeline and polish | pending |",
    "",
  ].join("\n");
}

export function runbookMd(): string {
  return "# RUNBOOK\n\nEvery unit runs under these rules.\n";
}

/**
 * `status.json` — authoritative for per-unit status/commit/branch AND the only
 * source of the per-unit test counts. S2 is `in_progress`, so it is the unit the
 * selection rule must pick; S1 carries a commit and real counts that must NOT
 * leak onto it.
 */
export function statusJson(): string {
  return JSON.stringify(
    {
      campaign: CAMPAIGN_SLUG,
      status: "active",
      branch_strategy: "serial",
      sub_iterates: [
        { id: "S1", slug: "resolver-core", status: "complete", commit: "66e275ae", branch: "iterate/campaign-S1", tests_passed: 5107, tests_total: 5108 },
        { id: "S2", slug: "tests-review", status: "in_progress", commit: null, branch: null, tests_passed: null, tests_total: null },
        { id: "S3", slug: "polish", status: "pending", commit: null, branch: null, tests_passed: null, tests_total: null },
      ],
    },
    null,
    2,
  );
}

/** Every file a campaign session needs, keyed project-root-relative. */
export function campaignFiles(): Record<string, string> {
  return {
    [`${CAMPAIGN_DIR}/campaign.md`]: campaignMd(),
    [`${CAMPAIGN_DIR}/RUNBOOK.md`]: runbookMd(),
    [`${CAMPAIGN_DIR}/status.json`]: statusJson(),
    [`${CAMPAIGN_DIR}/sub-iterates/S1-resolver-core.md`]: "# S1\n\nResolver core.\n",
    [`${CAMPAIGN_DIR}/sub-iterates/S2-tests-review.md`]: "# S2\n\nTests and review.\n",
    [`${CAMPAIGN_DIR}/sub-iterates/S3-polish.md`]: "# S3\n\nPipeline and polish.\n",
  };
}

/** A user actions catalog. `shape` decides which ambiguity the file carries. */
export function actionsJson(shape: "valid_custom" | "wrong_shape" | "malformed" | "dual"): string {
  switch (shape) {
    case "valid_custom":
      return JSON.stringify({
        schemaVersion: 1,
        defaults: { autonomy: "guided" },
        phases: [],
        actions: [
          { id: "publish-post", label: "Publish", kind: "external_launch", command_template: "claude" },
        ],
      });
    case "dual":
      return JSON.stringify({
        schemaVersion: 1,
        defaults: { autonomy: "guided" },
        phases: [],
        actions: [
          { id: "publish-post", label: "Publish", kind: "external_launch", command_template: "claude" },
          { id: "new-iterate", label: "Iterate", kind: "external_launch", command_template: "claude" },
        ],
      });
    case "wrong_shape":
      // Valid JSON, parses cleanly, means nothing. The S3 regression case.
      return '{"schemaVersion":1,"actions":[{"foo":"bar"}],"phases":[]}';
    case "malformed":
      return '{"schemaVersion":1,"actions":[';
  }
}
