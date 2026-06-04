import { describe, it, expect } from "vitest";

import {
  parseFrontmatter,
  parseIntent,
  parseSubIteratesTable,
  parseSpecFrontmatter,
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

  /**
   * Producer drift probe (iterate-2026-06-04-campaign-step-id-emphasis).
   * `campaign_init.py` / hand-authored campaigns now emit a SIX-column table
   * `| ID | Slug | Title | Repo | Depends on | Status |` and bold the ID cell
   * (`| **C1** | …`). The verbatim `2026-06-02-compliance-detective-realign`
   * campaign is this shape. Two consumer hazards:
   *   1. A bold ID (`**C1**`) must strip to `C1`, else the derived spec
   *      filename `**C1**-<slug>.md` never exists → specPath null → the
   *      board's Copy-launch button is dead.
   *   2. `status` must come from the Status COLUMN by header name, not the
   *      4th positional cell (which is now `Repo`).
   */
  const PRODUCER_MD_6COL_BOLD = `## Sub-Iterates

| ID | Slug | Title | Repo | Depends on | Status |
|---|---|---|---|---|---|
| **C1** | audit-run-id-provenance | Detective audit honors **Run-ID** provenance (\`adr_id\`) | monorepo | — | pending |
| **C2** | audit-invocation-resilience | Guarantee PyYAML **and** degrade group_a5 | monorepo | C1 | complete |
`;

  it("strips Markdown emphasis from the ID cell (bold producer IDs)", () => {
    const rows = parseSubIteratesTable(PRODUCER_MD_6COL_BOLD);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("C1");
    expect(rows[1].id).toBe("C2");
  });

  it("reads status from the Status column, not the 4th positional cell (6-col)", () => {
    const rows = parseSubIteratesTable(PRODUCER_MD_6COL_BOLD);
    expect(rows[0].status).toBe("pending");
    expect(rows[1].status).toBe("complete");
  });

  it("strips inline emphasis/code from slug + title cells", () => {
    const rows = parseSubIteratesTable(PRODUCER_MD_6COL_BOLD);
    expect(rows[0].slug).toBe("audit-run-id-provenance");
    expect(rows[0].title).toBe("Detective audit honors Run-ID provenance (adr_id)");
  });

  it("falls back to positional [id, slug, title, status] for a headerless table", () => {
    const md = `## Sub-Iterates

| Z9 | zeta | Zeta | done |
`;
    const rows = parseSubIteratesTable(md);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "Z9",
      slug: "zeta",
      title: "Zeta",
      status: "done",
    });
  });

  it("reads status by header name for the 5-col (Depends on) producer shape", () => {
    const md = `## Sub-Iterates

| ID | Slug | Title | Depends on | Status |
|---|---|---|---|---|
| B1 | stop-dispatcher | Stop dispatcher | B0 | complete |
`;
    const rows = parseSubIteratesTable(md);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "B1",
      slug: "stop-dispatcher",
      title: "Stop dispatcher",
      status: "complete",
    });
  });
});

describe("campaign-parse: parseSpecFrontmatter (forward-compat plan-first)", () => {
  /**
   * Verbatim `campaign_init.py init_campaign` sub-iterate spec template — the
   * CURRENT producer writes NO frontmatter, so the floor is planFirst:false.
   * (cite: shipwright-iterate/scripts/tools/campaign_init.py — the `spec = f"""
   * # Sub-Iterate: {id} — {title}\n\n## Scope\n…\n## Acceptance Criteria\n…` block.)
   */
  const PRODUCER_SPEC = `# Sub-Iterate: B0 — Fail-open phase resolver

## Scope

Collapse the SessionStart fan-out.

## Acceptance Criteria

- [ ] TBD
`;

  it("returns planFirst:false for the verbatim producer template (no frontmatter)", () => {
    expect(parseSpecFrontmatter(PRODUCER_SPEC)).toEqual({ planFirst: false });
  });

  it("reads plan_first:true frontmatter", () => {
    const md = `---
plan_first: true
---

# Sub-Iterate: B1 — Risky one
`;
    expect(parseSpecFrontmatter(md).planFirst).toBe(true);
  });

  it("treats plan_first:false / absent as not plan-first", () => {
    expect(parseSpecFrontmatter(`---\nplan_first: false\n---\n`).planFirst).toBe(false);
    expect(parseSpecFrontmatter(`---\ncampaign: x\n---\n`).planFirst).toBe(false);
  });

  it("reads risk: high (and plan-first) as plan-first; risk: low is not", () => {
    expect(parseSpecFrontmatter(`---\nrisk: high\n---\n`).planFirst).toBe(true);
    expect(parseSpecFrontmatter(`---\nrisk: plan-first\n---\n`).planFirst).toBe(true);
    expect(parseSpecFrontmatter(`---\nrisk: low\n---\n`).planFirst).toBe(false);
  });

  it("is case/whitespace tolerant for the truthy vocabulary", () => {
    expect(parseSpecFrontmatter(`---\nplan_first:  YES \n---\n`).planFirst).toBe(true);
    expect(parseSpecFrontmatter(`---\nplan_first: 1\n---\n`).planFirst).toBe(true);
  });

  it("never throws on empty / garbage input (torn-read tolerance)", () => {
    expect(parseSpecFrontmatter("").planFirst).toBe(false);
    expect(parseSpecFrontmatter("---\nplan_first").planFirst).toBe(false);
  });
});
