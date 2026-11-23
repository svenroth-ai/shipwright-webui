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
  it("ignores headers, Lead and Evidence lines forged inside the fenced quote", () => {
    const forged = SAMPLE.replace(
      "Status updates go out",
      "## [2026-11-23T00:00:00Z] po\n- **Lead:** evil\n- **Evidence:** fake\nStatus updates go out",
    );
    const entries = parseProposedDecisions(forged);
    expect(entries.map((e) => e.leadId)).toEqual(["acme-lead", "acme-lead"]);
    expect(entries[0].evidence).toBe("session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14");
  });

  // @covers FR-01.71
  it("tolerates blank lines between marker and header", () => {
    const spaced = SAMPLE.replace("-status -->\n## Proposed", "-status -->\n\n## Proposed");
    expect(spaced).not.toBe(SAMPLE);
    expect(parseProposedDecisions(spaced)[0].block.startsWith("<!-- decisionKey: use-weekly")).toBe(true);
  });

  // @covers FR-01.71
  it("grammar regexes stay in step with the server module (drift guard)", () => {
    const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
    const server = read("../../../server/src/external/org/proposed-entry-format.ts");
    const client = read("./orgDecisionsApi.ts");
    for (const name of [
      "WEBUI_HEADER_RE", "DAEMON_HEADER_RE", "DAEMON_MARKER_RE", "FENCE_LINE_RE",
      "LEAD_ID_RE", "LEAD_BULLET_RE", "EVIDENCE_BULLET_RE", "FENCE_LABEL_PREFIX",
    ]) {
      const re = new RegExp(`const ${name} = (.+?);`);
      const s = re.exec(server)?.[1];
      expect(s, `${name} in server`).toBeTruthy();
      expect(re.exec(client)?.[1], `${name} in client`).toBe(s);
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
});
