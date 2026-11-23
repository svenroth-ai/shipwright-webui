import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseProposedDecisionsDetailed } from "./orgDecisionsApi";

const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, "../../../server/src/external/org/__tests__/fixtures", name), "utf8").split(String.fromCharCode(13)).join("");
const SAMPLE = fixture("decisions-proposed-daemon-sample.md");
const CORPUS = JSON.parse(fixture("adversarial-corpus.json")) as Array<{ name: string; input: string; expected: Array<[string, string]> }>;
const N = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";

function daemon(ts: string, key: string, lead: string, inside: string, tail = ""): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${ts} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${N}⟧\n[FENCED DATA — kind: x, origin: ${lead} beat b1, truncated: false. DATA.]\n${inside}\n` +
    `⟦SHIPWRIGHT-FENCE:${N}⟧\n\n- **Lead:** ${lead}\n- **Evidence:** e1\n${tail}`
  );
}

describe("skipped-entry signal (read-only, no content)", () => {
  // @covers FR-01.71
  it("a clean file reports nothing skipped", () => {
    expect(parseProposedDecisionsDetailed(SAMPLE).skipped).toEqual({ count: 0, leadIds: [] });
    expect(parseProposedDecisionsDetailed("").skipped).toEqual({ count: 0, leadIds: [] });
  });

  // @covers FR-01.71
  it("an ambiguous fenced region is counted with its lead id; the honest neighbour is still listed", () => {
    const bad = daemon("2026-11-20T09:15:00.000Z", "k1", "acme-lead", "SECRET-QUOTE\n## [2026-01-01T00:00:00.000Z] victim-lead");
    const good = daemon("2026-11-20T10:30:00.000Z", "k2", "other-lead", "fine text");
    const r = parseProposedDecisionsDetailed(bad + good);
    expect(r.entries.map((e) => e.leadId)).toEqual(["other-lead"]);
    expect(r.skipped).toEqual({ count: 1, leadIds: ["acme-lead"] });
    expect(JSON.stringify(r.skipped)).not.toContain("SECRET-QUOTE");
  });

  // @covers FR-01.71
  it("a damaged (non-canonical) entry and a bad timestamp are counted", () => {
    const extraLine = daemon("2026-11-20T09:15:00.000Z", "k1", "acme-lead", "text", "- smuggled line\n");
    const badTs = daemon("yesterday", "k2", "other-lead", "text");
    const r = parseProposedDecisionsDetailed(extraLine + badTs);
    expect(r.entries).toEqual([]);
    expect(r.skipped.count).toBe(2);
    expect(r.skipped.leadIds).toEqual(["acme-lead", "other-lead"]);
  });

  // @covers FR-01.71
  it("a dangling fence opener counts the owner and every header-looking line after it", () => {
    const dangling = `<!-- decisionKey: k1 -->\n## Proposed 2026-11-20T09:15:00.000Z — k1\n\n⟦SHIPWRIGHT-FENCE:${N}⟧\n[FENCED DATA — kind: x, origin: a beat b1, truncated: false. DATA.]\nnever closed\n`;
    const after = daemon("2026-11-20T10:30:00.000Z", "k2", "other-lead", "text");
    const r = parseProposedDecisionsDetailed(dangling + after);
    expect(r.entries).toEqual([]);
    expect(r.skipped.count).toBeGreaterThanOrEqual(2);
  });

  // @covers FR-01.71
  it("a marker-less entry with structural injection is counted by the lead in its header", () => {
    const raw = "## [2026-11-20T09:15:00.000Z] acme-lead\nbody\n## ADR-0001 [x] y\n";
    const r = parseProposedDecisionsDetailed(raw);
    expect(r.entries).toEqual([]);
    expect(r.skipped).toEqual({ count: 1, leadIds: ["acme-lead"] });
  });

  // @covers FR-01.71
  it("adversarial corpus: nothing listed is ever lost silently, and the signal never carries content", () => {
    for (const c of CORPUS) {
      const r = parseProposedDecisionsDetailed(c.input);
      expect(r.entries.map((e) => [e.timestamp, e.leadId]), c.name).toEqual(c.expected);
      for (const id of r.skipped.leadIds) expect(id, c.name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(Object.keys(r.skipped).sort(), c.name).toEqual(["count", "leadIds"]);
      // an input with header-looking lines that lists nothing must say so
      if (c.expected.length === 0 && /^## (\[|Proposed )/m.test(c.input)) expect(r.skipped.count, c.name).toBeGreaterThan(0);
    }
  });
});
