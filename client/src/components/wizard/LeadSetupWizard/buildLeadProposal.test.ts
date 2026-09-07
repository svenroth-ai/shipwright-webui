import { describe, it, expect } from "vitest";

import { answersComplete, buildLeadProposal } from "./buildLeadProposal";
import { INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

const COMPLETE: LeadSetupAnswers = {
  ...INITIAL_ANSWERS,
  name: "Billing Lead",
  leadId: "billing-lead",
  domain: "billing",
  projectId: "proj-1",
  projectName: "demo",
  projectPath: "/abs/demo",
  actionId: "new-task",
  slashCommand: "/shipwright-task",
  cadenceKey: "hourly",
  budgetUsd: "50",
  escalationTarget: "po-sven",
};

describe("answersComplete", () => {
  it("false on the initial empty state", () => {
    expect(answersComplete(INITIAL_ANSWERS)).toBe(false);
  });

  it("true once all 7 questions are answered", () => {
    expect(answersComplete(COMPLETE)).toBe(true);
  });
});

describe("buildLeadProposal", () => {
  it("returns null while incomplete", () => {
    expect(buildLeadProposal(INITIAL_ANSWERS)).toBeNull();
  });

  it("fills fixed defaults for fields not covered by a question", () => {
    const p = buildLeadProposal(COMPLETE)!;
    expect(p.lead.reports_to).toBeNull();
    expect(p.lead.manages).toEqual([]);
    expect(p.lead.allowed_tools).toEqual([]);
    expect(p.lead.paused).toBe(false);
    expect(p.lead.budget.window).toBe("rolling-7d");
  });

  it("charter_path and learnings_path are relative, built from the lead id", () => {
    const p = buildLeadProposal(COMPLETE)!;
    expect(p.lead.charter_path).toBe("billing-lead/charter.md");
    expect(p.lead.learnings_path).toBe("billing-lead/learnings.md");
  });

  it("triggers.on always includes chat_session_ended; wakeOnAnswer adds answer_received", () => {
    const p1 = buildLeadProposal(COMPLETE)!;
    expect(p1.lead.triggers.on).toEqual(["chat_session_ended"]);

    const p2 = buildLeadProposal({ ...COMPLETE, wakeOnAnswer: true })!;
    expect(p2.lead.triggers.on).toEqual(["chat_session_ended", "answer_received"]);
  });

  it("action's slash_command becomes allowed_skills, never derived from the action id", () => {
    const p = buildLeadProposal(COMPLETE)!;
    expect(p.lead.allowed_skills).toEqual(["/shipwright-task"]);
  });

  it("project selection fills projects[] and daemonConfigAdditions.path with the absolute project path", () => {
    const p = buildLeadProposal(COMPLETE)!;
    expect(p.lead.projects).toEqual(["proj-1"]);
    expect(p.daemonConfigAdditions.path).toBe("/abs/demo");
    expect(p.daemonConfigAdditions.actionId).toBe("new-task");
  });

  it("cadence key resolves to the matching cron string", () => {
    const p = buildLeadProposal(COMPLETE)!;
    expect(p.lead.triggers.cron).toBe("0 * * * *");
  });
});
