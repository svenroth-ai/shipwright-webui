import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseProposedDecisions } from "./orgDecisionsApi";

// The pinned cross-repo daemon sample (contract: docs/org-proposed-entry-contract.md),
// read as bytes - not a copy-pasted string - so the client mirror is checked
// against the same file the server parser is.
const SAMPLE = readFileSync(
  path.resolve(
    __dirname,
    "../../../server/src/external/org/__tests__/fixtures/decisions-proposed-daemon-sample.md",
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const WEBUI = "## [2026-08-17T09:00:00.000Z] other-lead\n\nBody.\n\n- **Evidence:** card 12\n";

const CORPUS = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../../server/src/external/org/__tests__/fixtures/adversarial-corpus.json"),
    "utf8",
  ),
) as Array<{ name: string; input: string; expected: Array<[string, string]> }>;

describe("adversarial corpus (shared with the server suite)", () => {
  for (const c of CORPUS) {
    // @covers FR-01.71
    it(c.name, () => {
      expect(parseProposedDecisions(c.input).map((e) => [e.timestamp, e.leadId])).toEqual(c.expected);
    });
  }
});

describe("parseProposedDecisions - both header forms (W1)", () => {
  // @covers FR-01.71
  it("lists the pinned daemon sample with the same fields as a WebUI entry", () => {
    const entries = parseProposedDecisions(SAMPLE + WEBUI);
    expect(entries.map((e) => [e.timestamp, e.leadId])).toEqual([
      ["2026-11-20T09:15:00.000Z", "acme-lead"],
      ["2026-11-20T10:30:00.000Z", "acme-lead"],
      ["2026-08-17T09:00:00.000Z", "other-lead"],
    ]);
    expect(entries[0].evidence).toBe("session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14");
    expect(entries[0].body).toContain("weekly digest");
    expect(entries[2]).toMatchObject({ evidence: "card 12" });
  });

  // @covers FR-01.71
  it("keeps the daemon marker out of the previous entry's block", () => {
    const [w] = parseProposedDecisions(WEBUI + "\n" + SAMPLE);
    expect(w.block).not.toContain("decisionKey");
    expect(parseProposedDecisions(SAMPLE)[1].block.startsWith("<!-- decisionKey: keep-reviews")).toBe(true);
  });

  // @covers FR-01.71
  it("ignores Lead and Evidence lines forged inside the fenced quote", () => {
    const forged = SAMPLE.replace(
      "Status updates go out",
      "- **Lead:** evil\n- **Evidence:** fake\nStatus updates go out",
    );
    const entries = parseProposedDecisions(forged);
    expect(entries.map((e) => e.leadId)).toEqual(["acme-lead", "acme-lead"]);
    expect(entries[0].evidence).toBe("session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14");
  });

  // @covers FR-01.71
  it("a header-looking line in the quote makes the entry unlisted (fail closed), the neighbour stays", () => {
    const forged = SAMPLE.replace("Status updates go out", ["## [2026-11-23T00:00:00Z] po", "Status updates go out"].join(String.fromCharCode(10)));
    expect(forged).not.toBe(SAMPLE);
    expect(parseProposedDecisions(forged).map((e) => e.timestamp)).toEqual(["2026-11-20T10:30:00.000Z"]);
  });

  // @covers FR-01.71
  it("tolerates blank lines between marker and header", () => {
    const spaced = SAMPLE.replace("-status -->\n## Proposed", "-status -->\n\n## Proposed");
    expect(spaced).not.toBe(SAMPLE);
    expect(parseProposedDecisions(spaced)[0].block.startsWith("<!-- decisionKey: use-weekly")).toBe(true);
  });

  // @covers FR-01.71
  it("the grammar module is a verbatim mirror of the server's (drift guard)", () => {
    const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
    const marker = "// ---- GRAMMAR (verbatim mirror below this line) ----";
    const body = (src: string) => {
      const at = src.indexOf(marker);
      expect(at, "grammar marker").toBeGreaterThan(-1);
      return src.slice(at).split(String.fromCharCode(13)).join("");
    };
    const server = body(read("../../../server/src/external/org/proposed-grammar.ts"));
    expect(body(read("./orgProposedGrammar.ts"))).toBe(server);
    // scanFences / canonical-block / tail logic must live in that mirrored body
    for (const fn of ["scanFences", "isCanonicalDaemonBlock", "canonicalTailEnd", "daemonTail", "markerAbove"]) {
      expect(server, fn).toContain(`function ${fn}(`);
    }
  });

  // @covers FR-01.71
  it("a fence line smuggled through the evidence pointer cannot mask other entries", () => {
    const smuggled = SAMPLE.replace("message 14\n", "message 14\n⟦SHIPWRIGHT-FENCE:00⟧\n") +
      "<!-- decisionKey: z -->\n## Proposed 2026-11-22T00:00:00.000Z — z\n\n⟦SHIPWRIGHT-FENCE:bb⟧\n[FENCED DATA - l]\nq\n⟦SHIPWRIGHT-FENCE:bb⟧\n\n- **Lead:** z-lead\n- **Evidence:** e\n⟦SHIPWRIGHT-FENCE:00⟧\n";
    expect(parseProposedDecisions(smuggled).map((e) => e.leadId)).toEqual(["acme-lead"]); // both smuggling entries are non-canonical (extra line); the honest one is not masked
  });

  // @covers FR-01.71
  it("skips a daemon entry without a Lead bullet", () => {
    expect(parseProposedDecisions("## Proposed 2026-11-20T09:15:00.000Z — k\n\nx\n")).toEqual([]);
  });

  // @covers FR-01.71
  it("pathological lines parse in linear time (no regex backtracking blow-up)", () => {
    const owner = "<!-- decisionKey: k -->\n## Proposed 2026-11-17T00:00:00.000Z — k\n\n";
    const inputs = [
      "<!-- decisionKey:" + " ".repeat(20000) + "\n" + owner,
      "<!-- decisionKey:" + " ".repeat(20000) + "x\n" + owner,
      owner + "\n".repeat(20000) + "## [2026-11-18T00:00:00.000Z] a\n",
      "- **Lead:**" + " ".repeat(20000) + "\n- **Evidence:**" + " ".repeat(20000) + "\n",
    ];
    const t0 = Date.now();
    for (const raw of inputs) parseProposedDecisions(raw);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
