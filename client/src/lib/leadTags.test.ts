/*
 * leadTags — the closed three-prefix tag vocabulary (FR-04.10). Every
 * helper must be null/undefined-safe: a legacy or mocked ExternalTask
 * record with no `tags` field must never throw.
 */
import { describe, it, expect } from "vitest";

import {
  LEAD_ORIGIN_TAG_PREFIX,
  LEAD_WAIT_TAG_PREFIX,
  LEAD_DEDUP_TAG_PREFIX,
  LEAD_TAG_PREFIXES,
  isLeadOriginated,
  isWaitingOnPo,
  hasDedupTag,
  hasAnyLeadTag,
  matchesAnyLeadPrefix,
  leadOriginId,
  dedupKey,
} from "./leadTags";

describe("leadTags — closed vocabulary", () => {
  // @covers FR-01.01
  it("names exactly the three prefixes, no fourth", () => {
    expect(LEAD_ORIGIN_TAG_PREFIX).toBe("lead:");
    expect(LEAD_WAIT_TAG_PREFIX).toBe("lead-wait:");
    expect(LEAD_DEDUP_TAG_PREFIX).toBe("lead-dedup:");
    expect(LEAD_TAG_PREFIXES).toEqual(["lead:", "lead-wait:", "lead-dedup:"]);
  });
});

describe("isLeadOriginated", () => {
  it("true for a lead: tag", () => {
    expect(isLeadOriginated(["lead:helper-01"])).toBe(true);
  });
  it("false for a lead-wait: or lead-dedup: only tag (distinct from hasAnyLeadTag)", () => {
    expect(isLeadOriginated(["lead-wait:po"])).toBe(false);
    expect(isLeadOriginated(["lead-dedup:abc"])).toBe(false);
  });
  it("false for undefined/null/empty tags", () => {
    expect(isLeadOriginated(undefined)).toBe(false);
    expect(isLeadOriginated(null)).toBe(false);
    expect(isLeadOriginated([])).toBe(false);
  });
  it("is case-sensitive, matching the server's ?tag= convention (routes.lead-fields-tag-filter-list.test.ts)", () => {
    expect(isLeadOriginated(["LEAD:helper-01"])).toBe(false);
  });
});

describe("isWaitingOnPo / hasDedupTag", () => {
  it("match their own prefix only", () => {
    expect(isWaitingOnPo(["lead-wait:po"])).toBe(true);
    expect(isWaitingOnPo(["lead:x"])).toBe(false);
    expect(hasDedupTag(["lead-dedup:abc123"])).toBe(true);
    expect(hasDedupTag(["lead:x"])).toBe(false);
  });
  it("are null-safe", () => {
    expect(isWaitingOnPo(undefined)).toBe(false);
    expect(hasDedupTag(null)).toBe(false);
  });
});

describe("hasAnyLeadTag", () => {
  it("true when any of the three prefixes is present", () => {
    expect(hasAnyLeadTag(["lead:x"])).toBe(true);
    expect(hasAnyLeadTag(["lead-wait:po"])).toBe(true);
    expect(hasAnyLeadTag(["lead-dedup:x"])).toBe(true);
  });
  it("false for ordinary, non-lead tags", () => {
    expect(hasAnyLeadTag(["urgent", "backend"])).toBe(false);
  });
  it("false for undefined/null/empty tags", () => {
    expect(hasAnyLeadTag(undefined)).toBe(false);
    expect(hasAnyLeadTag(null)).toBe(false);
    expect(hasAnyLeadTag([])).toBe(false);
  });
});

describe("matchesAnyLeadPrefix", () => {
  it("OR-within-group: matches if any selected prefix matches any tag", () => {
    expect(matchesAnyLeadPrefix(["lead-wait:po"], [LEAD_ORIGIN_TAG_PREFIX, LEAD_WAIT_TAG_PREFIX])).toBe(true);
  });
  it("false when no selected prefix matches", () => {
    expect(matchesAnyLeadPrefix(["urgent"], LEAD_TAG_PREFIXES)).toBe(false);
  });
  it("false for an empty prefix selection or empty/absent tags", () => {
    expect(matchesAnyLeadPrefix(["lead:x"], [])).toBe(false);
    expect(matchesAnyLeadPrefix(undefined, LEAD_TAG_PREFIXES)).toBe(false);
    expect(matchesAnyLeadPrefix(null, LEAD_TAG_PREFIXES)).toBe(false);
  });
});

describe("leadOriginId / dedupKey", () => {
  it("extract the suffix after the prefix", () => {
    expect(leadOriginId(["lead:helper-07"])).toBe("helper-07");
    expect(dedupKey(["lead-dedup:card-9f3"])).toBe("card-9f3");
  });
  it("null when the tag is absent", () => {
    expect(leadOriginId(["urgent"])).toBeNull();
    expect(dedupKey(undefined)).toBeNull();
  });
});
