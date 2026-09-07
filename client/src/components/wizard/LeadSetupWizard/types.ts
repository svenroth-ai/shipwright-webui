/*
 * LeadSetupWizard shared types (W14, iterate-2026-09-07-leadwright-setup-
 * wizard). Sibling to IntentWizard — same idiom, own reducer, because the
 * domains genuinely differ (a lead-setup proposal vs. a task-launch
 * intent). Reuses `FlightRow` from IntentWizard rather than redeclaring it.
 */
export type { FlightRow } from "../IntentWizard/types";

/** The 4 fixed authority-band headings from the example charter — never
 *  deletable/renamable in the UI (W14's explicit requirement); only the
 *  body text per band is user-editable. */
export const AUTHORITY_BAND_HEADINGS = [
  "Decide alone",
  "Decide, then tell the PO",
  "Ask the PO first",
  "Never do without the PO",
] as const;

export type AuthorityBandHeading = (typeof AUTHORITY_BAND_HEADINGS)[number];

export type AuthorityBands = Record<AuthorityBandHeading, string>;

export const EMPTY_AUTHORITY_BANDS: AuthorityBands = {
  "Decide alone": "",
  "Decide, then tell the PO": "",
  "Ask the PO first": "",
  "Never do without the PO": "",
};

export interface CadenceOption {
  key: string;
  label: string;
  cron: string;
}

/** Named cadence choices → cron strings. `triggers.on` always includes
 *  `chat_session_ended` as the baseline (min-1 contract requirement);
 *  the "wake on answer" toggle additionally adds `answer_received`. */
export const CADENCE_OPTIONS: CadenceOption[] = [
  { key: "15min", label: "Every 15 minutes", cron: "*/15 * * * *" },
  { key: "hourly", label: "Hourly", cron: "0 * * * *" },
  { key: "twice-daily", label: "Twice a day", cron: "0 8,20 * * *" },
  { key: "daily", label: "Once a day", cron: "0 8 * * *" },
];

export type LeadModel = "fast" | "balanced" | "deep";

export interface LeadSetupAnswers {
  name?: string;
  leadId?: string;
  domain?: string;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  actionId?: string;
  slashCommand?: string;
  cadenceKey?: string;
  wakeOnAnswer: boolean;
  budgetUsd?: string;
  pauseAt: string;
  hardStopAt: string;
  authorityBands: AuthorityBands;
  maxConcurrentTasks: string;
  model: LeadModel;
  escalationTarget?: string;
}

export const INITIAL_ANSWERS: LeadSetupAnswers = {
  wakeOnAnswer: false,
  pauseAt: "0.85",
  hardStopAt: "0.95",
  authorityBands: EMPTY_AUTHORITY_BANDS,
  maxConcurrentTasks: "2",
  model: "balanced",
};

/** 1-7 = the seven questions, 8 = the verdict/finish step. */
export interface LeadSetupState {
  step: number;
  answers: LeadSetupAnswers;
}

export const TOTAL_STEPS = 8;
