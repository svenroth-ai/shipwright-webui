/*
 * leadSetupReducer — the ONE state machine for the 7-question lead-setup
 * wizard (W14). Sibling to IntentWizard's `wizardReducer`, not a variant of
 * it — the questions and the derived flight-plan rows differ enough that
 * sharing a reducer would mean branching on a `door`-like discriminator for
 * every case.
 */
import type { FlightRow } from "../IntentWizard/types";
import {
  CADENCE_OPTIONS,
  INITIAL_ANSWERS,
  type AuthorityBandHeading,
  type LeadModel,
  type LeadSetupState,
} from "./types";

export const INITIAL_LEAD_SETUP_STATE: LeadSetupState = {
  step: 1,
  answers: INITIAL_ANSWERS,
};

export type LeadSetupAction =
  | { t: "setName"; name: string }
  | { t: "setLeadId"; leadId: string }
  | { t: "setDomain"; domain: string }
  | { t: "setProject"; projectId: string; projectName: string; projectPath: string }
  | { t: "setAction"; actionId: string; slashCommand: string }
  | { t: "setCadence"; cadenceKey: string }
  | { t: "setWakeOnAnswer"; wakeOnAnswer: boolean }
  | { t: "setBudgetUsd"; budgetUsd: string }
  | { t: "setPauseAt"; pauseAt: string }
  | { t: "setHardStopAt"; hardStopAt: string }
  | { t: "setAuthorityBand"; heading: AuthorityBandHeading; text: string }
  | { t: "setMaxConcurrentTasks"; maxConcurrentTasks: string }
  | { t: "setModel"; model: LeadModel }
  | { t: "setEscalationTarget"; escalationTarget: string }
  | { t: "next" }
  | { t: "back" };

export function leadSetupReducer(s: LeadSetupState, a: LeadSetupAction): LeadSetupState {
  switch (a.t) {
    case "setName":
      return { ...s, answers: { ...s.answers, name: a.name } };
    case "setLeadId":
      return { ...s, answers: { ...s.answers, leadId: a.leadId } };
    case "setDomain":
      return { ...s, answers: { ...s.answers, domain: a.domain } };
    case "setProject":
      return {
        ...s,
        answers: {
          ...s.answers,
          projectId: a.projectId,
          projectName: a.projectName,
          projectPath: a.projectPath,
        },
      };
    case "setAction":
      return {
        ...s,
        answers: { ...s.answers, actionId: a.actionId, slashCommand: a.slashCommand },
      };
    case "setCadence":
      return { ...s, answers: { ...s.answers, cadenceKey: a.cadenceKey } };
    case "setWakeOnAnswer":
      return { ...s, answers: { ...s.answers, wakeOnAnswer: a.wakeOnAnswer } };
    case "setBudgetUsd":
      return { ...s, answers: { ...s.answers, budgetUsd: a.budgetUsd } };
    case "setPauseAt":
      return { ...s, answers: { ...s.answers, pauseAt: a.pauseAt } };
    case "setHardStopAt":
      return { ...s, answers: { ...s.answers, hardStopAt: a.hardStopAt } };
    case "setAuthorityBand":
      return {
        ...s,
        answers: {
          ...s.answers,
          authorityBands: { ...s.answers.authorityBands, [a.heading]: a.text },
        },
      };
    case "setMaxConcurrentTasks":
      return { ...s, answers: { ...s.answers, maxConcurrentTasks: a.maxConcurrentTasks } };
    case "setModel":
      return { ...s, answers: { ...s.answers, model: a.model } };
    case "setEscalationTarget":
      return { ...s, answers: { ...s.answers, escalationTarget: a.escalationTarget } };
    case "next":
      return { ...s, step: Math.min(8, s.step + 1) };
    case "back":
      return { ...s, step: Math.max(1, s.step - 1) };
    default:
      return s;
  }
}

function cadenceLabel(key: string | undefined): string {
  return CADENCE_OPTIONS.find((c) => c.key === key)?.label ?? "";
}

/** Flight-plan rows for the lead-setup wizard. Lead ID and Domain are always
 *  two SEPARATE rows — even when the user has typed the same string into
 *  both — because they answer different questions about the lead and W14
 *  requires the rail to show that difference explicitly. */
export function deriveLeadRows(s: LeadSetupState): FlightRow[] {
  const a = s.answers;
  const projectAnswered = !!a.projectId && !!a.projectPath;
  const actionAnswered = !!a.actionId;
  const budgetAnswered = !!a.budgetUsd;
  const authorityAnswered = Object.values(a.authorityBands).some((v) => v.trim().length > 0);
  return [
    {
      key: "Name",
      answered: !!a.name,
      value: a.name ?? "",
      why: a.name ? "Shown on the org chart and in restart notices." : "",
    },
    {
      key: "Lead ID",
      answered: !!a.leadId,
      value: a.leadId ?? "",
      why: a.leadId ? `Because you said “${a.leadId}” → the folder + charter path.` : "",
    },
    {
      key: "Domain",
      answered: !!a.domain,
      value: a.domain ?? "",
      why: a.domain ? `Because you said “${a.domain}” → routes matching cards to this lead.` : "",
    },
    {
      key: "Project",
      answered: projectAnswered,
      value: projectAnswered ? `${a.projectName} (${a.projectPath})` : "",
      why: projectAnswered
        ? `Because you said “${a.projectName}” → projects + leadProjectRoots filled.`
        : "",
    },
    {
      key: "Action",
      answered: actionAnswered,
      value: actionAnswered ? (a.slashCommand ?? a.actionId ?? "") : "",
      why: actionAnswered ? "Because you said this action → leadActionIds + allowed_skills filled." : "",
    },
    {
      key: "Cadence",
      answered: !!a.cadenceKey,
      value: a.cadenceKey ? cadenceLabel(a.cadenceKey) + (a.wakeOnAnswer ? " + wake on answer" : "") : "",
      why: a.cadenceKey ? `Because you said “${cadenceLabel(a.cadenceKey)}” → the cron trigger.` : "",
    },
    {
      key: "Budget",
      answered: budgetAnswered,
      value: budgetAnswered ? `$${a.budgetUsd}/wk, pause ${a.pauseAt}, stop ${a.hardStopAt}` : "",
      why: budgetAnswered
        ? `Because you said $${a.budgetUsd}/wk → pause + hard-stop thresholds.`
        : "",
    },
    {
      key: "Authority",
      answered: authorityAnswered,
      value: authorityAnswered ? "4 bands set" : "",
      why: authorityAnswered ? "The 4 fixed bands control what this lead may do alone." : "",
    },
    {
      key: "Escalation",
      answered: !!a.escalationTarget,
      value: a.escalationTarget ?? "",
      why: a.escalationTarget
        ? `Because you said “${a.escalationTarget}” → who this lead escalates to.`
        : "",
    },
  ];
}
