import { describe, it, expect } from "vitest";

import { validateCommitBody, type CommitRequestBody } from "./commit-validate.js";

const VALID_LEAD = {
  name: "New Lead",
  domain: "billing",
  reports_to: null,
  manages: [],
  charter_path: "new-lead/charter.md",
  learnings_path: "new-lead/learnings.md",
  triggers: { cron: "0 * * * *", on: [] },
  max_concurrent_tasks: 1,
  budget: { window: "rolling-7d", usd: null, pause_at: 0.85, hard_stop_at: 0.95 },
  projects: ["p1"],
  allowed_skills: ["/x"],
  allowed_tools: [],
  escalation_target: "po",
  model: "balanced",
  paused: false,
};

const ADDITIONS = { path: "/abs/p1", actionId: "/x", pluginDirs: ["/abs/plugins"] };

function validBody(overrides: Partial<CommitRequestBody> = {}): CommitRequestBody {
  return {
    leadId: "new-lead",
    lead: VALID_LEAD,
    daemonConfigAdditions: ADDITIONS,
    charterContent: "# New Lead",
    expectedProposalDigest: "digest-1",
    ...overrides,
  };
}

describe("validateCommitBody", () => {
  it("accepts a well-formed body", () => {
    expect(validateCommitBody(validBody())).toEqual({ ok: true, value: validBody() });
  });

  it("rejects a non-object body", () => {
    expect(validateCommitBody(null)).toEqual({ ok: false, reason: "invalid_request_body" });
    expect(validateCommitBody("nope")).toEqual({ ok: false, reason: "invalid_request_body" });
  });

  it("rejects a leadId that isn't kebab-case", () => {
    expect(validateCommitBody(validBody({ leadId: "Not_Kebab" }))).toEqual({ ok: false, reason: "invalid_lead_id" });
  });

  it("rejects a missing/non-object lead", () => {
    expect(validateCommitBody({ ...validBody(), lead: null })).toEqual({ ok: false, reason: "invalid_lead" });
  });

  // External-review fix (both legs, high): commitCore always writes to
  // <leadsRoot>/<leadId>/charter.md regardless of charter_path — a caller
  // submitting anything else (absolute, or relative-but-mismatched) must be
  // rejected, not silently accepted with a mismatched org-chart entry.
  it("rejects a non-relative charter_path", () => {
    const result = validateCommitBody(validBody({ lead: { ...VALID_LEAD, charter_path: "/abs/charter.md" } }));
    expect(result).toEqual({ ok: false, reason: "charter_path_must_match_lead_id_convention" });
  });

  it("rejects a relative charter_path that doesn't match the <leadId>/charter.md convention", () => {
    const result = validateCommitBody(validBody({ lead: { ...VALID_LEAD, charter_path: "other-dir/charter.md" } }));
    expect(result).toEqual({ ok: false, reason: "charter_path_must_match_lead_id_convention" });
  });

  it("rejects a learnings_path that doesn't match the <leadId>/learnings.md convention", () => {
    const result = validateCommitBody(validBody({ lead: { ...VALID_LEAD, learnings_path: "new-lead/notes.md" } }));
    expect(result).toEqual({ ok: false, reason: "learnings_path_must_match_lead_id_convention" });
  });

  it("rejects an allowed_skills entry that doesn't match the slash-command pattern", () => {
    const result = validateCommitBody(validBody({ lead: { ...VALID_LEAD, allowed_skills: ["not-a-slash-command"] } }));
    expect(result).toEqual({ ok: false, reason: "invalid_allowed_skills" });
  });

  it("rejects a missing/non-object daemonConfigAdditions", () => {
    const result = validateCommitBody({ ...validBody(), daemonConfigAdditions: null });
    expect(result).toEqual({ ok: false, reason: "invalid_daemon_config_additions" });
  });

  it("rejects a non-absolute daemonConfigAdditions.path", () => {
    const result = validateCommitBody(validBody({ daemonConfigAdditions: { ...ADDITIONS, path: "relative/p1" } }));
    expect(result).toEqual({ ok: false, reason: "daemon_config_additions_must_be_absolute" });
  });

  it("rejects a non-absolute daemonConfigAdditions.pluginDirs entry", () => {
    const result = validateCommitBody(validBody({ daemonConfigAdditions: { ...ADDITIONS, pluginDirs: ["relative/plugin"] } }));
    expect(result).toEqual({ ok: false, reason: "daemon_config_additions_must_be_absolute" });
  });

  it("rejects a non-string charterContent", () => {
    const result = validateCommitBody({ ...validBody(), charterContent: 42 });
    expect(result).toEqual({ ok: false, reason: "charter_content_required" });
  });

  it("rejects an empty expectedProposalDigest", () => {
    expect(validateCommitBody(validBody({ expectedProposalDigest: "" }))).toEqual({
      ok: false,
      reason: "expected_proposal_digest_required",
    });
  });
});
