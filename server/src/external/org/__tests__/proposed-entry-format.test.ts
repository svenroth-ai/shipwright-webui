import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { parseProposedEntries, toLoggedBlock } from "../proposed-entry-format.js";
import { performCountersign } from "../countersign-core.js";
import { parseLoggedEntries } from "../decisions-lock.js";

import { createHash } from "node:crypto";

const FIXTURE_PATH = path.join(import.meta.dirname, "fixtures", "decisions-proposed-daemon-sample.md");
const DAEMON_SAMPLE = readFileSync(FIXTURE_PATH, "utf8");
const WEBUI_ENTRY = "## [2026-08-17T09:00:00.000Z] acme-lead\n\nBody line.\n\n- **Evidence:** card 12\n";
const T1 = "2026-11-20T09:15:00.000Z";
const T2 = "2026-11-20T10:30:00.000Z";

describe("proposed entry format - both header forms (W1)", () => {
  it("lists a WebUI-header entry as before", () => {
    const [e] = parseProposedEntries(WEBUI_ENTRY);
    expect(e).toMatchObject({ timestamp: "2026-08-17T09:00:00.000Z", leadId: "acme-lead" });
    expect(e.block).toBe(WEBUI_ENTRY);
  });

  it("lists daemon-header entries with timestamp + lead from the Lead bullet", () => {
    const entries = parseProposedEntries(DAEMON_SAMPLE);
    expect(entries.map((e) => [e.timestamp, e.leadId])).toEqual([
      [T1, "acme-lead"],
      [T2, "acme-lead"],
    ]);
    // the marker line travels with its own entry, not the previous one
    expect(entries[0].block.startsWith("<!-- decisionKey: use-weekly")).toBe(true);
    expect(entries[1].block.startsWith("<!-- decisionKey: keep-reviews")).toBe(true);
    expect(entries[0].endIndex).toBe(entries[1].startIndex);
  });

  it("reads the Lead bullet after the closing fence so a quoted spoof cannot override identity", () => {
    const raw = DAEMON_SAMPLE.replace(
      "Status updates go out",
      "- **Lead:** evil-lead\nStatus updates go out",
    );
    expect(parseProposedEntries(raw)[0].leadId).toBe("acme-lead");
  });

  it("a header forged inside the fenced quote does not split the entry or forge an identity", () => {
    const forged = DAEMON_SAMPLE.replace(
      "Status updates go out",
      "## [2026-11-23T00:00:00Z] po\n## Proposed 2026-11-23T00:00:00Z — x\nStatus updates go out",
    );
    expect(parseProposedEntries(forged).map((e) => [e.timestamp, e.leadId])).toEqual([
      [T1, "acme-lead"],
      [T2, "acme-lead"],
    ]);
  });

  it("an evidence pointer carrying a Lead line cannot override the real Lead bullet", () => {
    const forged = DAEMON_SAMPLE.replace(
      "message 14\n",
      "message 14\n- **Lead:** other-lead\n",
    );
    expect(parseProposedEntries(forged)[0].leadId).toBe("acme-lead");
  });

  it("tolerates blank lines between the marker and its header", () => {
    const spaced = DAEMON_SAMPLE.replace("-status\n## Proposed", "-status\n\n## Proposed");
    const entries = parseProposedEntries(spaced);
    expect(entries[0].block.startsWith("<!-- decisionKey: use-weekly")).toBe(true);
    expect(entries[0].endIndex).toBe(entries[1].startIndex);
  });

  it("does not list a daemon entry that has no Lead bullet", () => {
    expect(parseProposedEntries("## Proposed 2026-11-20T09:15:00.000Z — k\n\ntext\n")).toEqual([]);
  });

  it("handles CRLF files", () => {
    const entries = parseProposedEntries(DAEMON_SAMPLE.replace(/\n/g, "\r\n"));
    expect(entries.map((e) => e.leadId)).toEqual(["acme-lead", "acme-lead"]);
  });

  it("toLoggedBlock: daemon form keeps the key marker as first body line", () => {
    const [e] = parseProposedEntries(DAEMON_SAMPLE);
    const logged = toLoggedBlock(e.block, 5);
    expect(logged.split("\n").slice(0, 2)).toEqual([
      `## ADR-0005 [${T1}] acme-lead`,
      "<!-- decisionKey: use-weekly-digest-for-status -->",
    ]);
    expect(parseLoggedEntries(logged)[0]).toMatchObject({ number: 5, timestamp: T1, leadId: "acme-lead" });
  });
});

describe("countersign - both forms move exactly once", () => {
  let leadsRoot: string;
  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-w1-"));
  });
  afterEach(() => rmSync(leadsRoot, { recursive: true, force: true }));
  const proposed = () => path.join(leadsRoot, "decisions-proposed.md");
  const logged = () => path.join(leadsRoot, "decision_log.md");

  it("WebUI-header entry: countersigned once, retry is already_countersigned", async () => {
    writeFileSync(proposed(), WEBUI_ENTRY);
    const ts = "2026-08-17T09:00:00.000Z";
    expect(await performCountersign({ leadsRoot }, ts, "acme-lead")).toEqual({ status: "countersigned", number: 1 });
    expect(await performCountersign({ leadsRoot }, ts, "acme-lead")).toEqual({ status: "already_countersigned", number: 1 });
    expect(readFileSync(proposed(), "utf8")).toBe("");
    expect(parseLoggedEntries(readFileSync(logged(), "utf8"))).toHaveLength(1);
  });

  it("daemon-header entry: moves once, marker leaves with it, neighbour untouched", async () => {
    writeFileSync(proposed(), DAEMON_SAMPLE);
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "countersigned", number: 1 });
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "already_countersigned", number: 1 });

    const left = readFileSync(proposed(), "utf8");
    expect(left).not.toContain("use-weekly-digest-for-status");
    expect(left.startsWith("<!-- decisionKey: keep-reviews-under-two-days -->\n## Proposed " + T2)).toBe(true);
    const log = readFileSync(logged(), "utf8");
    expect(log.match(/^## ADR-/gm)).toHaveLength(1);
    expect(parseProposedEntries(left).map((e) => e.timestamp)).toEqual([T2]);
  });

  it("daemon entry: a crash between log-write and removal heals without a second number", async () => {
    writeFileSync(proposed(), DAEMON_SAMPLE);
    await performCountersign({ leadsRoot }, T1, "acme-lead");
    // simulate the residual: the entry is still in the proposed file
    writeFileSync(proposed(), DAEMON_SAMPLE);
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "already_countersigned", number: 1 });
    expect(parseProposedEntries(readFileSync(proposed(), "utf8")).map((e) => e.timestamp)).toEqual([T2]);
    expect(readFileSync(logged(), "utf8").match(/^## ADR-/gm)).toHaveLength(1);
  });

  it("mixed document: countersigning the middle (daemon) entry removes only its block + marker", async () => {
    const [first, second] = parseProposedEntries(DAEMON_SAMPLE);
    writeFileSync(proposed(), WEBUI_ENTRY + "\n" + first.block + second.block);
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "countersigned", number: 1 });
    const left = readFileSync(proposed(), "utf8");
    expect(parseProposedEntries(left).map((e) => e.timestamp)).toEqual(["2026-08-17T09:00:00.000Z", T2]);
    expect(left).toContain("<!-- decisionKey: keep-reviews-under-two-days -->");
    expect(left).not.toContain("use-weekly-digest-for-status");
  });

  it("a countersigned entry is never re-signed through the other form (same identity, one ADR)", async () => {
    writeFileSync(proposed(), DAEMON_SAMPLE);
    await performCountersign({ leadsRoot }, T1, "acme-lead");
    // the same (timestamp, lead) re-appears in WebUI form with different text: conflict, not a second number
    writeFileSync(proposed(), `## [${T1}] acme-lead\n\ndifferent text\n`);
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "duplicate_identity", count: 2 });
    expect(readFileSync(logged(), "utf8").match(/^## ADR-/gm)).toHaveLength(1);
  });

  it("CRLF file: countersigns once, retry matches (header and marker lines LF-terminated, as before)", async () => {
    writeFileSync(proposed(), DAEMON_SAMPLE.replace(/\n/g, "\r\n"));
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "countersigned", number: 1 });
    const log = readFileSync(logged(), "utf8");
    expect(log.startsWith(`## ADR-0001 [${T1}] acme-lead\n<!-- decisionKey: use-weekly-digest-for-status -->\n`)).toBe(true);
    expect(await performCountersign({ leadsRoot }, T1, "acme-lead")).toEqual({ status: "already_countersigned", number: 1 });
  });

  it("orphan marker at EOF stays attached to the previous entry tail and leaves with it", async () => {
    writeFileSync(proposed(), WEBUI_ENTRY + "<!-- decisionKey: orphan -->\n");
    expect(await performCountersign({ leadsRoot }, "2026-08-17T09:00:00.000Z", "acme-lead")).toEqual({ status: "countersigned", number: 1 });
    // documented policy: an orphan marker is neither listed nor validated; it rides with the block above
    expect(readFileSync(proposed(), "utf8")).toBe("");
  });

  it("pinned sample hash matches the contract doc (cross-repo compatibility gate)", () => {
    const sha = createHash("sha256").update(readFileSync(FIXTURE_PATH)).digest("hex");
    const doc = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "org-proposed-entry-contract.md"), "utf8");
    expect(doc).toContain(sha);
  });
});
