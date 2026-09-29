/*
 * `dependsOn` per step — display-only edges of the monorepo `depends_on` graph.
 * status.json (the live skeleton) wins over the campaign.md "Depends on"
 * column; a campaign without a graph yields [] for every step.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readCampaigns } from "./campaign-store.js";
import { parseDependsOnCell } from "./campaign-parse.js";

const SLUG = "2026-09-29-dag";
let root: string;
let campaignsDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "store-deps-"));
  campaignsDir = path.join(root, ".shipwright", "planning", "iterate", "campaigns");
  mkdirSync(path.join(campaignsDir, SLUG), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (name: string, body: string) => writeFileSync(path.join(campaignsDir, SLUG, name), body, "utf-8");
const md = (rows: string) => `---
campaign: ${SLUG}
---

## Sub-Iterates

| ID | Slug | Title | Depends on | Status |
|---|---|---|---|---|
${rows}
`;
const stepsOf = () => readCampaigns(campaignsDir, root).find((c) => c.slug === SLUG)!.steps;

describe("campaign steps — dependsOn", () => {
  it("reads the campaign.md 'Depends on' column (comma-separated, emphasis stripped)", () => {
    write("campaign.md", md("| A | a | A | | pending |\n| B | b | B | **A** | pending |\n| C | c | C | A, B | pending |"));
    expect(stepsOf().map((s) => s.dependsOn)).toEqual([[], ["A"], ["A", "B"]]);
  });

  it("status.json's live depends_on wins over the table column", () => {
    write("campaign.md", md("| B | b | B | A | pending |"));
    write("status.json", JSON.stringify({ sub_iterates: [{ id: "B", slug: "b", status: "pending", depends_on: ["X", "Y"] }] }));
    expect(stepsOf()[0].dependsOn).toEqual(["X", "Y"]);
  });

  it("ignores non-string entries in status.json depends_on", () => {
    write("campaign.md", md("| B | b | B | | pending |"));
    write("status.json", JSON.stringify({ sub_iterates: [{ id: "B", status: "pending", depends_on: ["A", 5, null, ""] }] }));
    expect(stepsOf()[0].dependsOn).toEqual(["A"]);
  });

  it("a legacy table without the column yields [] (a campaign with no graph)", () => {
    write("campaign.md", `---\ncampaign: ${SLUG}\n---\n\n## Sub-Iterates\n\n| ID | Slug | Title | Status |\n|---|---|---|---|\n| A | a | A | pending |\n`);
    expect(stepsOf()[0].dependsOn).toEqual([]);
  });

  it("parseDependsOnCell: empty → [], stray commas dropped", () => {
    expect(parseDependsOnCell("")).toEqual([]);
    expect(parseDependsOnCell("A,, B ,")).toEqual(["A", "B"]);
  });
});
