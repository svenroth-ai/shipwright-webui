/*
 * buildLeadProposal — turns the 7 answers into the exact `PreflightLead` +
 * `DaemonConfigAdditions` shape the verdict/commit routes expect. This is
 * where the "fields not covered by a question" defaults live (iterate spec
 * table): reports_to/manages/paused fixed, charter/learnings paths a fixed
 * convention off the lead id, allowed_tools empty (leadwright default).
 */
import { CADENCE_OPTIONS } from "./types";
import type { LeadSetupAnswers } from "./types";
import type {
  DaemonConfigAdditions,
  PreflightLead,
  PreflightTriggerEventType,
} from "../../../lib/leadSetupWizardApi";

export interface LeadProposal {
  leadId: string;
  lead: PreflightLead;
  daemonConfigAdditions: DaemonConfigAdditions;
}

/** True once every field `buildLeadProposal` reads is present. Steps enforce
 *  this per-screen already; this is the final cross-check before a verdict
 *  or commit call is made. */
export function answersComplete(a: LeadSetupAnswers): boolean {
  return !!(
    a.name &&
    a.leadId &&
    a.domain &&
    a.projectId &&
    a.projectPath &&
    a.actionId &&
    a.slashCommand &&
    a.cadenceKey &&
    a.budgetUsd &&
    a.escalationTarget
  );
}

export function buildLeadProposal(a: LeadSetupAnswers): LeadProposal | null {
  if (!answersComplete(a)) return null;
  const cadence = CADENCE_OPTIONS.find((c) => c.key === a.cadenceKey);
  if (!cadence) return null;

  const on: PreflightTriggerEventType[] = ["chat_session_ended"];
  if (a.wakeOnAnswer) on.push("answer_received");

  const lead: PreflightLead = {
    name: a.name!,
    domain: a.domain!,
    reports_to: null,
    manages: [],
    charter_path: `${a.leadId}/charter.md`,
    learnings_path: `${a.leadId}/learnings.md`,
    triggers: { cron: cadence.cron, on },
    max_concurrent_tasks: Number(a.maxConcurrentTasks),
    budget: {
      window: "rolling-7d",
      usd: Number(a.budgetUsd),
      pause_at: Number(a.pauseAt),
      hard_stop_at: Number(a.hardStopAt),
    },
    projects: [a.projectId!],
    allowed_skills: [a.slashCommand!],
    allowed_tools: [],
    escalation_target: a.escalationTarget!,
    model: a.model,
    paused: false,
  };

  const daemonConfigAdditions: DaemonConfigAdditions = {
    path: a.projectPath!,
    actionId: a.actionId!,
    pluginDirs: [],
  };

  return { leadId: a.leadId!, lead, daemonConfigAdditions };
}
