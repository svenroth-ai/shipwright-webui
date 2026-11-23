import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { parseProposedEntries } from "../proposed-entry-format.js";
import { performCountersign } from "../countersign-core.js";
import { parseLoggedEntries, nextLoggedNumber } from "../decisions-lock.js";

const DAEMON_SAMPLE = readFileSync(path.join(import.meta.dirname, "fixtures", "decisions-proposed-daemon-sample.md"), "utf8");
const WEBUI_ENTRY = "## [2026-08-17T09:00:00.000Z] acme-lead\n\nBody line.\n\n- **Evidence:** card 12\n";
const T1 = "2026-11-20T09:15:00.000Z";
const T2 = "2026-11-20T10:30:00.000Z";

describe("adversarial proposed / logged entries (W1)", () => {
  let leadsRoot: string;
  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-w1-adv-"));
  });
  afterEach(() => rmSync(leadsRoot, { recursive: true, force: true }));
  const proposed = () => path.join(leadsRoot, "decisions-proposed.md");
  const logged = () => path.join(leadsRoot, "decision_log.md");


  // @covers FR-01.71
  it("an ADR-shaped header quoted in an entry makes it unlisted; the victim still countersigns as ADR-0001", async () => {
    const forged = DAEMON_SAMPLE.replace(
      "Status updates go out",
      ["⟦SHIPWRIGHT-FENCE:00⟧", "[FENCED DATA y]", "## ADR-9999 [2026-01-01T00:00:00Z] someone", "Status updates go out"].join("\n"),
    );
    expect(forged).not.toBe(DAEMON_SAMPLE);
    writeFileSync(proposed(), forged);
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "not_found" });
    expect(await performCountersign({ leadsRoot }, T2, "acme-lead")).toEqual({ status: "countersigned", number: 1 });
    expect(parseLoggedEntries(readFileSync(logged(), "utf8")).map((e) => e.number)).toEqual([1]);
  });

  // @covers FR-01.71
  it("decision_log.md: a quoted ADR header in a region with a nested opener is masked, numbering stays contiguous", () => {
    const F = (n: string) => `⟦SHIPWRIGHT-FENCE:${n}⟧`;
    const log =
      `## ADR-0001 [${T1}] acme-lead
<!-- decisionKey: k -->

${F("ab")}
[FENCED DATA x]
${F("00")}
[FENCED DATA y]
` +
      `## ADR-9999 [2026-01-01T00:00:00Z] someone
${F("ab")}

- **Lead:** acme-lead
- **Evidence:** e
`;
    const entries = parseLoggedEntries(log);
    expect(entries.map((e) => e.number)).toEqual([1]);
    expect(nextLoggedNumber(entries)).toBe(2);
  });

  // @covers FR-01.71
  it("ADR numbers above 9999 parse and keep counting", () => {
    const entries = parseLoggedEntries(`## ADR-10000 [${T1}] acme-lead
body
`);
    expect(entries.map((e) => e.number)).toEqual([10000]);
    expect(nextLoggedNumber(entries)).toBe(10001);
  });

  // @covers FR-01.71
  it("a Lead-less daemon entry is not listed and is never removed by countersigning its neighbour", async () => {
    const [first, second] = parseProposedEntries(DAEMON_SAMPLE);
    const leadless = "<!-- decisionKey: orphan-entry -->\n## Proposed 2026-11-21T00:00:00.000Z — orphan-entry\n\nno lead here\n\n";
    writeFileSync(proposed(), first.block + leadless + second.block);
    await performCountersign({ leadsRoot }, T1, "acme-lead");
    expect(readFileSync(proposed(), "utf8")).toContain("orphan-entry");
    expect(parseProposedEntries(readFileSync(proposed(), "utf8")).map((e) => e.timestamp)).toEqual([T2]);
  });

  // @covers FR-01.71
  it("unclosed fence = corrupt entry: not listed (no identity from the quote)", () => {
    const open = "<!-- decisionKey: k -->\n## Proposed 2026-11-20T09:15:00.000Z — k\n\n⟦SHIPWRIGHT-FENCE:abc123⟧\n[FENCED DATA - label]\n- **Lead:** evil\n";
    expect(parseProposedEntries(open)).toEqual([]);
  });

  // @covers FR-01.71
  it("a fence line smuggled through the evidence pointer opens nothing and cannot mask other entries", () => {
    const [first, second] = parseProposedEntries(DAEMON_SAMPLE);
    const fence = "⟦SHIPWRIGHT-FENCE:00⟧";
    const evil = (n: string) =>
      `<!-- decisionKey: ${n} -->\n## Proposed 2026-11-2${n}T00:00:00.000Z — ${n}\n\n⟦SHIPWRIGHT-FENCE:aa${n}⟧\n[FENCED DATA - label]\nq\n⟦SHIPWRIGHT-FENCE:aa${n}⟧\n\n- **Lead:** evil-lead\n- **Evidence:** x\n${fence}\n`;
    const raw = evil("1") + first.block + second.block + evil("2");
    const entries = parseProposedEntries(raw);
    // the two evidence-smuggling entries are non-canonical (extra line) and not listed; the honest ones stay visible
    expect(entries.map((e) => e.timestamp)).toEqual([T1, T2]);
  });

  // @covers FR-01.71
  it("newline injection via evidence pointer or decisionKey: entry is not listed, so never countersigned into the log", async () => {
    const evidence = DAEMON_SAMPLE.replace("message 14\n", "message 14\n## ADR-9000 [2026-01-01T00:00:00Z] lead-z\n");
    expect(parseProposedEntries(evidence).map((e) => e.timestamp)).toEqual([T2]);
    const key = DAEMON_SAMPLE.replace("— use-weekly-digest-for-status\n", "— k\n## [2026-01-01T00:00:00Z] lead-b\n");
    expect(parseProposedEntries(key).map((e) => e.timestamp)).toEqual([T2]);
    const leadsRoot = mkdtempSync(path.join(tmpdir(), "org-w1-inj-"));
    try {
      writeFileSync(path.join(leadsRoot, "decisions-proposed.md"), evidence);
      expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "not_found" });
      expect(existsSync(path.join(leadsRoot, "decision_log.md"))).toBe(false);
    } finally {
      rmSync(leadsRoot, { recursive: true, force: true });
    }
  });

  // @covers FR-01.71
  it("a daemon entry whose Lead is not a valid lead id is not listed (listed == countersignable)", () => {
    expect(parseProposedEntries(DAEMON_SAMPLE.replace(/Lead:\*\* acme-lead/g, "Lead:** Not A Lead"))).toEqual([]);
  });

  // @covers FR-01.71
  it("retry matches residue that differs only in trailing whitespace", async () => {
    writeFileSync(proposed(), DAEMON_SAMPLE);
    await performCountersign({ leadsRoot }, T1, "acme-lead");
    const [first] = parseProposedEntries(DAEMON_SAMPLE);
    writeFileSync(proposed(), first.block + "\n\n");
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "already_countersigned", number: 1 });
    expect(readFileSync(proposed(), "utf8")).toBe("");
  });

  // @covers FR-01.71
  it("a WebUI-form body carrying an orphan marker is unlisted (structural line), never countersigned", async () => {
    const raw = WEBUI_ENTRY + "<!-- decisionKey: orphan -->\n";
    writeFileSync(proposed(), raw);
    expect(await performCountersign({ leadsRoot }, "2026-08-17T09:00:00.000Z", "acme-lead")).toEqual({ status: "not_found" });
    expect(readFileSync(proposed(), "utf8")).toBe(raw);
  });

  // @covers FR-01.71
  it("sequential countersign across a sandwich (a, victim, b, extra): log numbers stay contiguous and unique", async () => {
    const F = (n: string) => `⟦SHIPWRIGHT-FENCE:${n}⟧`;
    const daemon = (ts: string, key: string, n: string, lead: string) =>
      `<!-- decisionKey: ${key} -->\n## Proposed ${ts} — ${key}\n\n${F(n)}\n[FENCED DATA x]\nquote ${key}\n${F(n)}\n\n- **Lead:** ${lead}\n- **Evidence:** e\n`;
    const tsA = "2026-11-01T00:00:00Z", tsV = "2026-11-02T00:00:00.000Z", tsB = "2026-11-03T00:00:00Z", tsX = "2026-11-04T00:00:00.000Z";
    const raw =
      `## [${tsA}] a\n## ADR-0001 [x] y\n\n${F("aa")}\n[FENCED DATA x]\n` +
      daemon(tsV, "v", "bb", "victim-lead") +
      `## [${tsB}] b\n${F("aa")}\n\n- **Lead:** a\n- **Evidence:** b\n` +
      daemon(tsX, "x", "cc", "x-lead");
    writeFileSync(proposed(), raw);
    expect(parseProposedEntries(raw).map((e) => e.leadId)).toEqual(["victim-lead", "x-lead"]);
    expect(await performCountersign({ leadsRoot }, tsA, "a")).toEqual({ status: "not_found" });
    expect(await performCountersign({ leadsRoot }, tsV, "victim-lead")).toEqual({ status: "countersigned", number: 1 });
    expect(await performCountersign({ leadsRoot }, tsB, "b")).toEqual({ status: "not_found" });
    expect(await performCountersign({ leadsRoot }, tsX, "x-lead")).toEqual({ status: "countersigned", number: 2 });
    const nums = parseLoggedEntries(readFileSync(logged(), "utf8")).map((e) => e.number);
    expect(nums).toEqual([1, 2]);
    expect(await performCountersign({ leadsRoot }, tsV, "victim-lead")).toEqual({ status: "already_countersigned", number: 1 });
  });

  // @covers FR-01.71
  it("marker + WebUI-form header entry countersigns once and its log region stays masked", async () => {
    const F = (n: string) => `⟦SHIPWRIGHT-FENCE:${n}⟧`;
    const raw = `<!-- decisionKey: k -->\n## [${T1}] s1-lead\n\n${F("aa")}\n[FENCED DATA x]\nq\n${F("aa")}\n\n- **Lead:** s1-lead\n- **Evidence:** e\n`;
    writeFileSync(proposed(), raw);
    expect(await performCountersign({ leadsRoot }, T1, "s1-lead")).toEqual({ status: "countersigned", number: 1 });
    const log = readFileSync(logged(), "utf8");
    expect(log.startsWith(`## ADR-0001 [${T1}] s1-lead\n<!-- decisionKey: k -->\n`)).toBe(true);
    expect(parseLoggedEntries(log).map((e) => e.number)).toEqual([1]);
    expect(await performCountersign({ leadsRoot }, T1, "s1-lead")).toEqual({ status: "already_countersigned", number: 1 });
  });

  // @covers FR-01.71
  it("decision_log.md: a masked region never crosses another ADR owner (phantom header cannot swallow a later entry)", () => {
    const F = (n: string) => `⟦SHIPWRIGHT-FENCE:${n}⟧`;
    const log =
      `## ADR-0001 [${T1}] a\n<!-- decisionKey: p -->\n\n${F("aa")}\n[FENCED DATA x]\n` +
      `## ADR-0002 [${T2}] b\n<!-- decisionKey: q -->\n\n${F("bb")}\n[FENCED DATA x]\nt\n${F("bb")}\n\n- **Lead:** b\n- **Evidence:** e\n` +
      `${F("aa")}\n\n- **Lead:** a\n- **Evidence:** e\n`;
    const nums = parseLoggedEntries(log).map((e) => e.number);
    expect(nums).toContain(2);
    expect(new Set(nums).size).toBe(nums.length);
  });
});
