import { describe, it, expect } from "vitest";

import {
  parseFrontmatter,
  parseIntent,
  parseSubIteratesTable,
} from "./campaign-parse.js";

/**
 * Verbatim `campaign_init.py init_campaign` output — the producer/consumer
 * boundary probe. If the Python template drifts, these assertions break loudly
 * (cite: shipwright-iterate/scripts/tools/campaign_init.py).
 */
const PRODUCER_MD = `---
campaign: 2026-06-02-hook-consolidation
branch_strategy: stacked
created: 2026-06-02T00:00:00+00:00
---

# Campaign: 2026-06-02-hook-consolidation

## Intent

Collapse hook fan-out into phase-aware dispatchers

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
| B0 | phase-resolver-contract | Fail-open phase resolver | pending |
| B1 | sessionstart-dispatcher | SessionStart dispatcher | complete |
`;

describe("campaign-parse: parseFrontmatter", () => {
  it("parses the producer frontmatter keys", () => {
    const fm = parseFrontmatter(PRODUCER_MD);
    expect(fm.campaign).toBe("2026-06-02-hook-consolidation");
    expect(fm.branch_strategy).toBe("stacked");
    expect(fm.created).toBe("2026-06-02T00:00:00+00:00");
  });

  it("parses an optional hand-authored expandsTriage field", () => {
    const md = `---
campaign: x
expandsTriage: trg-721b1765
---
`;
    expect(parseFrontmatter(md).expandsTriage).toBe("trg-721b1765");
  });

  it("returns {} when there is no frontmatter block", () => {
    expect(parseFrontmatter("# Campaign\n\nno frontmatter\n")).toEqual({});
  });
});

describe("campaign-parse: parseIntent", () => {
  it("extracts the one-line intent", () => {
    expect(parseIntent(PRODUCER_MD)).toBe(
      "Collapse hook fan-out into phase-aware dispatchers",
    );
  });

  it("joins a multi-line intent and stops at the next heading", () => {
    const md = `## Intent

Line one
Line two

## Sub-Iterates
`;
    expect(parseIntent(md)).toBe("Line one Line two");
  });

  it("returns '' when there is no Intent section", () => {
    expect(parseIntent("# Campaign\n\n## Sub-Iterates\n")).toBe("");
  });
});

describe("campaign-parse: parseSubIteratesTable", () => {
  it("parses data rows, skipping the header + separator", () => {
    const rows = parseSubIteratesTable(PRODUCER_MD);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "B0",
      slug: "phase-resolver-contract",
      title: "Fail-open phase resolver",
      status: "pending",
    });
    expect(rows[1].id).toBe("B1");
    expect(rows[1].status).toBe("complete");
  });

  it("tolerates alignment colons in the separator row", () => {
    const md = `## Sub-Iterates

| ID | Slug | Title | Status |
|:---|:---:|---:|---|
| A0 | alpha | Alpha | pending |
`;
    const rows = parseSubIteratesTable(md);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("A0");
  });

  it("returns [] when there is no Sub-Iterates table", () => {
    expect(parseSubIteratesTable("# Campaign\n\n## Intent\n\nhi\n")).toEqual([]);
  });
});
