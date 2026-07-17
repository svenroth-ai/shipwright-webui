import { describe, it, expect } from "vitest";

import { parseCampaignSlug } from "./campaignSlug";

describe("parseCampaignSlug (FR-01.67 AC3)", () => {
  // @covers FR-01.67
  it("parses a `campaign: <slug>` orchestrator title to its slug", () => {
    expect(parseCampaignSlug("campaign: mission-stages-campaign")).toBe(
      "mission-stages-campaign",
    );
  });

  // @covers FR-01.67
  it("tolerates no space after the colon", () => {
    expect(parseCampaignSlug("campaign:iterate-skill-hardening")).toBe(
      "iterate-skill-hardening",
    );
  });

  // @covers FR-01.67
  it("trims surrounding whitespace from the title and the slug", () => {
    expect(parseCampaignSlug("  campaign:   webui-polish  ")).toBe("webui-polish");
  });

  // @covers FR-01.67
  it("a plain (non-campaign) task title → null", () => {
    expect(parseCampaignSlug("Add a login page")).toBeNull();
    expect(parseCampaignSlug("Survey the hull")).toBeNull();
  });

  // @covers FR-01.67
  it("a human title merely CONTAINING the word campaign → null (case-sensitive, prefix-anchored)", () => {
    // Honesty: only the producer's exact lowercase `campaign: ` breadcrumb counts,
    // never a human-typed "Campaign: Q3 planning".
    expect(parseCampaignSlug("Campaign: Q3 planning")).toBeNull();
    expect(parseCampaignSlug("the campaign: kickoff")).toBeNull();
  });

  // @covers FR-01.67
  it("an empty / prefix-only / whitespace slug → null (no fabricated slug)", () => {
    expect(parseCampaignSlug("")).toBeNull();
    expect(parseCampaignSlug("campaign:")).toBeNull();
    expect(parseCampaignSlug("campaign:   ")).toBeNull();
  });

  // @covers FR-01.67
  it("null / undefined input → null", () => {
    expect(parseCampaignSlug(null)).toBeNull();
    expect(parseCampaignSlug(undefined)).toBeNull();
  });
});
