import { describe, it, expect } from "vitest";

import {
  INITIAL_LEAD_SETUP_STATE,
  leadSetupReducer,
  deriveLeadRows,
} from "./leadWizardState";

describe("leadSetupReducer", () => {
  it("starts at step 1 with empty answers", () => {
    expect(INITIAL_LEAD_SETUP_STATE.step).toBe(1);
    expect(INITIAL_LEAD_SETUP_STATE.answers.name).toBeUndefined();
  });

  it("setName / setLeadId / setDomain write independent fields", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "setName", name: "Billing Lead" });
    s = leadSetupReducer(s, { t: "setLeadId", leadId: "billing-lead" });
    s = leadSetupReducer(s, { t: "setDomain", domain: "billing" });
    expect(s.answers.name).toBe("Billing Lead");
    expect(s.answers.leadId).toBe("billing-lead");
    expect(s.answers.domain).toBe("billing");
  });

  it("setProject fills id, name and path together from one selection", () => {
    const s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, {
      t: "setProject",
      projectId: "proj-1",
      projectName: "demo",
      projectPath: "/abs/demo",
    });
    expect(s.answers.projectId).toBe("proj-1");
    expect(s.answers.projectName).toBe("demo");
    expect(s.answers.projectPath).toBe("/abs/demo");
  });

  it("setAction fills actionId and slashCommand together", () => {
    const s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, {
      t: "setAction",
      actionId: "new-task",
      slashCommand: "/shipwright-task",
    });
    expect(s.answers.actionId).toBe("new-task");
    expect(s.answers.slashCommand).toBe("/shipwright-task");
  });

  it("setAuthorityBand updates exactly one fixed heading, others untouched", () => {
    const s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, {
      t: "setAuthorityBand",
      heading: "Decide alone",
      text: "Merge routine fixes.",
    });
    expect(s.answers.authorityBands["Decide alone"]).toBe("Merge routine fixes.");
    expect(s.answers.authorityBands["Never do without the PO"]).toBe("");
  });

  it("setCadence / setWakeOnAnswer write independent fields", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "setCadence", cadenceKey: "hourly" });
    s = leadSetupReducer(s, { t: "setWakeOnAnswer", wakeOnAnswer: true });
    expect(s.answers.cadenceKey).toBe("hourly");
    expect(s.answers.wakeOnAnswer).toBe(true);
  });

  it("setBudgetUsd / setPauseAt / setHardStopAt write independent fields", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "setBudgetUsd", budgetUsd: "50" });
    s = leadSetupReducer(s, { t: "setPauseAt", pauseAt: "0.8" });
    s = leadSetupReducer(s, { t: "setHardStopAt", hardStopAt: "0.9" });
    expect(s.answers.budgetUsd).toBe("50");
    expect(s.answers.pauseAt).toBe("0.8");
    expect(s.answers.hardStopAt).toBe("0.9");
  });

  it("setMaxConcurrentTasks / setModel / setEscalationTarget write independent fields", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "setMaxConcurrentTasks", maxConcurrentTasks: "3" });
    s = leadSetupReducer(s, { t: "setModel", model: "deep" });
    s = leadSetupReducer(s, { t: "setEscalationTarget", escalationTarget: "po-sven" });
    expect(s.answers.maxConcurrentTasks).toBe("3");
    expect(s.answers.model).toBe("deep");
    expect(s.answers.escalationTarget).toBe("po-sven");
  });

  it("next advances step, clamped at 8 (the verdict step)", () => {
    let s = INITIAL_LEAD_SETUP_STATE;
    for (let i = 0; i < 20; i++) s = leadSetupReducer(s, { t: "next" });
    expect(s.step).toBe(8);
  });

  it("back retreats step, clamped at 1", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "next" });
    s = leadSetupReducer(s, { t: "back" });
    s = leadSetupReducer(s, { t: "back" });
    expect(s.step).toBe(1);
  });
});

describe("deriveLeadRows", () => {
  it("shows lead id and domain as two SEPARATE unanswered rows initially", () => {
    const rows = deriveLeadRows(INITIAL_LEAD_SETUP_STATE);
    const leadIdRow = rows.find((r) => r.key === "Lead ID");
    const domainRow = rows.find((r) => r.key === "Domain");
    expect(leadIdRow?.answered).toBe(false);
    expect(domainRow?.answered).toBe(false);
    expect(leadIdRow).not.toBe(domainRow);
  });

  it("lead id and domain answer independently even when equal in value", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "setLeadId", leadId: "billing" });
    const rows1 = deriveLeadRows(s);
    expect(rows1.find((r) => r.key === "Lead ID")?.answered).toBe(true);
    expect(rows1.find((r) => r.key === "Domain")?.answered).toBe(false);

    s = leadSetupReducer(s, { t: "setDomain", domain: "billing" });
    const rows2 = deriveLeadRows(s);
    expect(rows2.find((r) => r.key === "Lead ID")?.value).toBe("billing");
    expect(rows2.find((r) => r.key === "Domain")?.value).toBe("billing");
    expect(rows2.find((r) => r.key === "Domain")?.answered).toBe(true);
  });

  it("project row answers only once both id and path are set", () => {
    const s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, {
      t: "setProject",
      projectId: "proj-1",
      projectName: "demo",
      projectPath: "/abs/demo",
    });
    const row = deriveLeadRows(s).find((r) => r.key === "Project");
    expect(row?.answered).toBe(true);
    expect(row?.value).toContain("demo");
  });

  it("budget row is unanswered until a usd amount is set", () => {
    const rows = deriveLeadRows(INITIAL_LEAD_SETUP_STATE);
    expect(rows.find((r) => r.key === "Budget")?.answered).toBe(false);
  });

  it("cadence row shows the label (plus wake-on-answer suffix) once set", () => {
    let s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, { t: "setCadence", cadenceKey: "hourly" });
    let row = deriveLeadRows(s).find((r) => r.key === "Cadence");
    expect(row?.answered).toBe(true);
    expect(row?.value).toBe("Hourly");

    s = leadSetupReducer(s, { t: "setWakeOnAnswer", wakeOnAnswer: true });
    row = deriveLeadRows(s).find((r) => r.key === "Cadence");
    expect(row?.value).toBe("Hourly + wake on answer");
  });

  it("escalation row answers once a target is set", () => {
    const s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, {
      t: "setEscalationTarget",
      escalationTarget: "po-sven",
    });
    const row = deriveLeadRows(s).find((r) => r.key === "Escalation");
    expect(row?.answered).toBe(true);
    expect(row?.value).toBe("po-sven");
  });

  it("authority row answers once at least one band has text", () => {
    const before = deriveLeadRows(INITIAL_LEAD_SETUP_STATE).find((r) => r.key === "Authority");
    expect(before?.answered).toBe(false);
    const s = leadSetupReducer(INITIAL_LEAD_SETUP_STATE, {
      t: "setAuthorityBand",
      heading: "Decide alone",
      text: "Merge routine fixes.",
    });
    const after = deriveLeadRows(s).find((r) => r.key === "Authority");
    expect(after?.answered).toBe(true);
  });
});
