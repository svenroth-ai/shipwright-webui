/*
 * leadwright-preflight.ts — hand-typed mirror of leadwright's published
 * setup-preflight transport contract (iterate-2026-09-07-leadwright-setup-
 * wizard, W14). Vendored source: server/src/vendor/leadwright/
 * preflight-{input,result}.schema.json, re-vendored from leadwright main
 * @ df2c5f6 (2026-09-09, iterate-2026-09-09-leadwright-schema-drift).
 * PreflightTriggerEventType stays a closed 2-value union on purpose even
 * though leadwright #79 opened the wire schema's triggers.on to an open
 * lowercase-snake-case pattern — this mirror types only what webui itself
 * ever emits, not the full breadth the wire contract now allows.
 *
 * CLAUDE.md rule 7 (ADR-080): no cross-package import — this is a verbatim
 * mirror kept in fidelity-test sync (leadwright-preflight.test.ts), same
 * posture as core/claim-record-lock.ts's relationship to
 * vendor/leadwright/claim-record-lock-contract.json.
 *
 * "Never compute a verdict here" (the card's own instruction): these types
 * describe the wire shape ONLY. No validation logic beyond the regexes a
 * caller needs to avoid submitting something leadwright will report as a
 * named finding anyway — leadwright's own `--stdin` zod gate remains the
 * sole judge of a proposal's correctness.
 */

export const PREFLIGHT_INPUT_CONTRACT_VERSION = 1;
export const PREFLIGHT_RESULT_CONTRACT_VERSION = 1;

/** Same pattern webui's own `_helpers.ts` LEAD_ID_RE uses — confirmed
 *  identical to leadwright's own lead-id/domain pattern by the fidelity
 *  test. One regex, reused for kebab-case validation everywhere. */
export const LEAD_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** charter_path / learnings_path: relative, no leading '/', no '..'
 *  substring anywhere. These stay RELATIVE (resolved by leadwright against
 *  leadsRoot) — never touched by the absolute-path rule below. */
export const CHARTER_LEARNINGS_PATH_RE = /^(?!\/)(?!.*\.\.).+$/;

/** allowed_skills entries: a leading '/' then kebab-case. */
export const ALLOWED_SKILL_RE = /^\/[a-z0-9][a-z0-9-]*$/;

export const PREFLIGHT_INPUT_REQUIRED_FIELDS = ["orgChart", "charters", "daemonConfig"] as const;

export const LEAD_REQUIRED_FIELDS = [
  "name",
  "domain",
  "reports_to",
  "manages",
  "charter_path",
  "learnings_path",
  "triggers",
  "max_concurrent_tasks",
  "budget",
  "projects",
  "allowed_skills",
  "escalation_target",
  "model",
] as const;

export const PREFLIGHT_RESULT_REQUIRED_FIELDS = ["ok", "findings"] as const;

export const PREFLIGHT_FINDING_REQUIRED_FIELDS = ["key", "layer", "satisfied", "message"] as const;

/** The 5 daemonConfig fields the absolute-path rule (finding
 *  `proposal-paths-absolute`) binds. Deliberately excludes `orgChartPath`
 *  (submitted inline via the top-level `orgChart` field, never read from
 *  `daemonConfig.orgChartPath`) and charter_path/learnings_path (those stay
 *  relative — see CHARTER_LEARNINGS_PATH_RE above). */
export const ABSOLUTE_PATH_BOUND_DAEMON_CONFIG_FIELDS = [
  "leadsRoot",
  "sdkSessionsPath",
  "pluginDirs",
  "leadProjectRoots",
  "leadPluginDirs",
] as const;

export type PreflightTriggerEventType = "answer_received" | "chat_session_ended";
export type PreflightModel = "fast" | "balanced" | "deep";

export interface PreflightLead {
  name: string;
  domain: string;
  reports_to: string | null;
  manages: string[];
  charter_path: string;
  learnings_path: string;
  triggers: { cron: string; on: PreflightTriggerEventType[] };
  max_concurrent_tasks: number;
  budget: { window: "rolling-7d"; usd: number | null; pause_at: number; hard_stop_at: number };
  projects: string[];
  allowed_skills: string[];
  allowed_tools: string[];
  escalation_target: string;
  model: PreflightModel;
  paused: boolean;
}

export interface PreflightOrgChart {
  version: 2;
  po: string;
  leads: Record<string, PreflightLead>;
}

export interface PreflightCharter {
  leadId: string;
  content: string;
}

export interface PreflightDaemonConfig {
  orgChartPath: string;
  leadsRoot?: string;
  sdkSessionsPath?: string;
  webuiBaseUrl: string;
  leadProjectRoots?: Record<string, string>;
  leadActionIds?: Record<string, string>;
  pluginDirs?: string[];
  leadPluginDirs?: Record<string, string[]>;
  pollIntervalMs?: number;
  beatTimeoutMs?: number;
}

/** The full `--stdin` document — what the verdict/commit transport writes
 *  to the child's stdin, JSON-stringified. */
export interface PreflightStdinInput {
  orgChart: PreflightOrgChart;
  charters: PreflightCharter[];
  daemonConfig: PreflightDaemonConfig;
}

export type PreflightFindingLayer = "MUSS" | "KANN" | "advisory";

export interface PreflightFinding {
  key: string;
  layer: PreflightFindingLayer;
  satisfied: boolean;
  unverifiable?: boolean;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  findings: PreflightFinding[];
}
