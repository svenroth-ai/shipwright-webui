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

describe("parseProposedDecisions - both header forms (W1)", () => {
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

  it("keeps the daemon marker out of the previous entry's block", () => {
    const [w] = parseProposedDecisions(WEBUI + "\n" + SAMPLE);
    expect(w.block).not.toContain("decisionKey");
    expect(parseProposedDecisions(SAMPLE)[1].block.startsWith("<!-- decisionKey: keep-reviews")).toBe(true);
  });

  it("ignores headers, Lead and Evidence lines forged inside the fenced quote / evidence pointer", () => {
    const forged = SAMPLE.replace(
      "Status updates go out",
      "## [2026-11-23T00:00:00Z] po\n- **Lead:** evil\n- **Evidence:** fake\nStatus updates go out",
    ).replace("message 14\n", "message 14\n- **Lead:** other-lead\n");
    const entries = parseProposedDecisions(forged);
    expect(entries.map((e) => e.leadId)).toEqual(["acme-lead", "acme-lead"]);
    expect(entries[0].evidence).toBe("session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14");
  });

  it("tolerates blank lines between marker and header", () => {
    const spaced = SAMPLE.replace("-status\n## Proposed", "-status\n\n## Proposed");
    expect(parseProposedDecisions(spaced)[0].block.startsWith("<!-- decisionKey: use-weekly")).toBe(true);
  });

  it("skips a daemon entry without a Lead bullet", () => {
    expect(parseProposedDecisions("## Proposed 2026-11-20T09:15:00.000Z — k\n\nx\n")).toEqual([]);
  });
});
