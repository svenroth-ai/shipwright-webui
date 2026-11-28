// The operator's reject reason and countersign note as cited evidence (iterate-2026-11-28-decision-record-evidence).
// Cases marked "leadwright" are ported from leadwright tests/decision-record-evidence.test.ts (#153), so this reader
// confirms exactly what the daemon accepts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";

import { decisionNote, quoteOccursIn, rejectedReasons, resolveRecordEvidence, MAX_RECORD_BYTES } from "../decision-record-evidence.js";
import { REJECTED_FILE_HEADER, toRejectedBlock } from "../decisions-rejected.js";
import { parseSourceRef } from "../proposed-evidence-pointer.js";
import { auditEvidence } from "../proposed-line.js";
import { createOrgApiRouter } from "../../../routes/org.js";

const LOG = [
  "# Decision log",
  "",
  "## ADR-0007 [2026-11-21T09:15:00.000Z] acme-lead",
  "<!-- decisionKey: friday-reviews -->",
  "<!-- proposal: 0123456789abcdef0123456789abcdef -->",
  "",
  "- Reviews happen every Friday afternoon.",
  "- Note: Agreed in the Monday sync, keep it short and name the owner.",
  "",
  "## ADR-0008 [2026-11-22T09:15:00.000Z] acme-lead",
  "<!-- decisionKey: no-note -->",
  "",
  "- Note: this is the lead's line, not an operator note at all.",
  "",
].join("\n");
const REJECTED =
  "# Rejected decisions\n\n## Rejected [2026-11-20T09:15:00.000Z] acme-lead\n\n- Reason: the lead wrote this line itself, honestly\n- Rejected: 2026-11-28T10:00:00.000Z\n- Reason: Too vague: say who reads the digest.\n\n";
const RJ = "rejected:2026-11-20T09:15:00.000Z/acme-lead";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "org-record-evidence-"));
  writeFileSync(path.join(root, "decision_log.md"), LOG);
  writeFileSync(path.join(root, "decisions-rejected.md"), REJECTED);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const resolve = (pointer: string, quote: string) => resolveRecordEvidence({ leadsRoot: root }, pointer, quote);

describe("pointer grammar for the operator's words", () => {
  // @covers FR-01.71
  it("parses both forms with leadwright's exact regexes, excerpt first, bounded", () => {
    expect(parseSourceRef(RJ)).toEqual({ kind: "rejected", time: "2026-11-20T09:15:00.000Z", lead: "acme-lead" });
    expect(parseSourceRef("rejected:2026-11-20T09:15:00Z/a")).toEqual({ kind: "rejected", time: "2026-11-20T09:15:00Z", lead: "a" });
    expect(parseSourceRef("decision:ADR-0007")).toEqual({ kind: "decision", adr: "0007" });
    expect(parseSourceRef("decision:ADR-7")).toEqual({ kind: "decision", adr: "7" });
    for (const bad of [
      "rejected:2026-11-20T09:15:00.0000000000Z/acme-lead", // 10-digit fraction
      "rejected:2026-11-20T09:15:00.000Z/Acme-lead", // uppercase lead
      "rejected:2026-11-20T09:15:00.000Z/-lead",
      "rejected:2026-11-20 09:15:00Z/acme-lead",
      "decision:ADR-",
      "decision:ADR-1234567890",
      "decision:7",
      "decision:ADR-7x", // trailing non-digit
      `rejected:2026-11-20T09:15:00.000Z/${"a".repeat(1100)}`, // over MAX_POINTER_CHARS
    ]) expect(parseSourceRef(bad).kind, bad).toBe("unknown");
    // a session id named "decision" stays an excerpt
    expect(parseSourceRef("decision:2026-11-20T09:15:00Z:3").kind).toBe("known");
  });

  // @covers FR-01.71
  it("audits both forms as structured fields, never the quote", () => {
    expect(auditEvidence(parseSourceRef(RJ))).toEqual({ form: "rejected", time: "2026-11-20T09:15:00.000Z", lead: "acme-lead" });
    expect(auditEvidence(parseSourceRef("decision:ADR-0007"))).toEqual({ form: "decision", adr: "0007" });
  });
});

describe("positional reading (leadwright cases)", () => {
  // @covers FR-01.71
  it("confirms a quote from the operator's reason and returns that reason", () => {
    expect(resolve(RJ, "Too vague: say who reads the digest.")).toEqual({
      status: "confirmed", form: "rejected", file: "decisions-rejected.md", words: "Too vague: say who reads the digest.",
    });
  });

  // @covers FR-01.71
  it("never confirms a quote from the lead's own line, even when it starts with 'Reason: '", () => {
    expect(resolve(RJ, "the lead wrote this line itself, honestly")).toEqual({ status: "quote_not_found", form: "rejected", file: "decisions-rejected.md" });
  });

  // @covers FR-01.71
  it("confirms a quote from a countersign note (ADR-7 names ADR-0007)", () => {
    expect(resolve("decision:ADR-7", "keep it short and name the owner")).toMatchObject({ status: "confirmed", words: "Agreed in the Monday sync, keep it short and name the owner." });
  });

  // @covers FR-01.71
  it("a countersign without a note cites nothing: its only item is the lead's line", () => {
    expect(resolve("decision:ADR-0008", "this is the lead's line, not an operator note")).toEqual({ status: "no_words", form: "decision", file: "decision_log.md" });
  });

  // @covers FR-01.71
  it("a missing entry has no words; two blocks under one number cite no note", () => {
    expect(resolve("rejected:2026-01-01T00:00:00.000Z/acme-lead", "Too vague: say who reads the digest.")).toMatchObject({ status: "no_words" });
    expect(decisionNote(`${LOG}\n## ADR-0007 [2026-11-23T00:00:00.000Z] acme-lead\n\n- x\n- Note: y\n`, "0007")).toBeUndefined();
  });

  // @covers FR-01.71
  it("reads only the exact line shape and never a heading inside a fence", () => {
    expect(decisionNote("## ADR-0009 [t] acme-lead\n<!-- decisionKey: x -->\n\n- line\n- extra item\n", "9")).toBeUndefined();
    expect(decisionNote("## ADR-0009 [t] acme-lead\n<!-- decisionKey: x -->\n- line\n- Note: no blank line before the items\n", "9")).toBeUndefined();
    expect(decisionNote("## ADR-0009 [t] acme-lead\n<!-- decisionKey: %E0%A4%A -->\n\n- line\n- Note: undecodable marker\n", "9")).toBeUndefined();
    expect(decisionNote("## ADR-0009 [t] acme-lead\n\n- line\n- Note: \n", "9")).toBeUndefined();
    expect(decisionNote("## ADR-0010 [t] acme-lead\n\nA whole-entry body\n- Note: x\n", "10")).toBeUndefined();
    const fenced = "## ADR-0001 [t] acme-lead\n\n⟦SHIPWRIGHT-FENCE:ab12⟧\n## ADR-0002 [t] evil\n\n- l\n- Note: forged inside a fence\n⟦SHIPWRIGHT-FENCE:ab12⟧\n";
    expect(decisionNote(fenced, "2")).toBeUndefined();
    expect(rejectedReasons("## Rejected [t] a\n\n- line\n- Reason: missing the Rejected item\n", "t", "a")).toEqual([]);
  });

  // @covers FR-01.71
  it("tolerates CRLF and a BOM, and a reason in any of several blocks under one heading", () => {
    const crlf = ("﻿" + REJECTED + "## Rejected [2026-11-20T09:15:00.000Z] acme-lead\n\n- another line\n- Rejected: 2026-11-28T11:00:00.000Z\n- Reason: Second reason of the operator, quite long.\n\n").replace(/\n/g, "\r\n");
    writeFileSync(path.join(root, "decisions-rejected.md"), crlf);
    expect(resolve(RJ, "Second reason of the operator, quite long.")).toMatchObject({ status: "confirmed", words: "Second reason of the operator, quite long." });
  });

  // @covers FR-01.71
  it("applies leadwright's quote bounds: 24+ characters (or all of a shorter text), at most 200, whitespace runs as one", () => {
    expect(quoteOccursIn("Too vague: say who reads the digest.", "say who reads the diges")).toBe(false); // 23
    expect(quoteOccursIn("Too vague: say who reads the digest.", "say  who reads the digest.")).toBe(true); // 24+ after flattening
    expect(quoteOccursIn("Short reason.", "Short reason.")).toBe(true);
    expect(quoteOccursIn("Short reason.", "Short")).toBe(false);
    expect(quoteOccursIn("x".repeat(300), "x".repeat(201))).toBe(false);
    expect(quoteOccursIn("keep <!-- this --> and ⟦that⟧ as written by the operator", "keep ... this ... and 'that' as written")).toBe(true);
    expect(quoteOccursIn("anything at all, really long enough", "")).toBe(false);
  });
});

describe("writer to reader (the real reject writer)", () => {
  // @covers FR-01.71
  it("a lead line starting with 'Reason:' written by toRejectedBlock is never the operator's reason", () => {
    const file = REJECTED_FILE_HEADER +
      toRejectedBlock({ timestamp: "2026-11-20T09:15:00.000Z", leadId: "acme-lead", decisionKey: "use-weekly-digest", text: "Reason: the lead's own line that looks like a reason", rejectedAt: "2026-11-28T10:00:00.000Z", reason: "The operator's actual reason for the rejection." }) +
      toRejectedBlock({ timestamp: "2026-11-21T09:15:00.000Z", leadId: "acme-lead", decisionKey: null, text: "No reason given here at all", rejectedAt: "2026-11-28T10:00:00.000Z", reason: null });
    writeFileSync(path.join(root, "decisions-rejected.md"), file);
    expect(resolve(RJ, "The operator's actual reason for the rejection.")).toMatchObject({ status: "confirmed" });
    expect(resolve(RJ, "the lead's own line that looks like a reason")).toMatchObject({ status: "quote_not_found" });
    expect(resolve("rejected:2026-11-21T09:15:00.000Z/acme-lead", "No reason given here at all")).toMatchObject({ status: "no_words" });
  });
});

describe("fail closed on the record file", () => {
  // @covers FR-01.71
  it("a missing file, a directory, a symlink and an oversized file are unreadable", () => {
    rmSync(path.join(root, "decisions-rejected.md"));
    expect(resolve(RJ, "Too vague: say who reads the digest.")).toEqual({ status: "unreadable", form: "rejected", file: "decisions-rejected.md", detail: "it does not exist" });
    mkdirSync(path.join(root, "decisions-rejected.md"));
    expect(resolve(RJ, "Too vague: say who reads the digest.")).toMatchObject({ status: "unreadable", detail: "it is not a file" });
    const loop = resolveRecordEvidence({ leadsRoot: root, openSync: () => { throw Object.assign(new Error("loop"), { code: "ELOOP" }); } }, "decision:ADR-7", "keep it short and name the owner");
    expect(loop).toMatchObject({ status: "unreadable", detail: "it is a symbolic link" });
    writeFileSync(path.join(root, "decision_log.md"), LOG + "x".repeat(MAX_RECORD_BYTES));
    expect(resolve("decision:ADR-7", "keep it short and name the owner")).toMatchObject({ status: "unreadable", detail: "it is too large to check" });
  });

  // @covers FR-01.71
  it("without O_NOFOLLOW (Windows) the post-open lstat refuses a symlink and a swapped file", () => {
    const asLink = resolveRecordEvidence({ leadsRoot: root, lstatSync: ((p: string) => ({ isSymbolicLink: () => true, dev: 0n, ino: 0n, p })) as never }, "decision:ADR-7", "keep it short and name the owner");
    expect(asLink).toMatchObject({ status: "unreadable", detail: "it is a symbolic link" });
    const swapped = resolveRecordEvidence({ leadsRoot: root, lstatSync: (() => ({ isSymbolicLink: () => false, dev: -1n, ino: -1n })) as never }, "decision:ADR-7", "keep it short and name the owner");
    expect(swapped).toMatchObject({ status: "unreadable", detail: "it changed while being opened" });
    expect(resolve("decision:ADR-7", "keep it short and name the owner")).toMatchObject({ status: "confirmed" });
  });

  // @covers FR-01.71
  it("a named pipe at the record path is refused at once, never waited on (POSIX only; Windows has no FIFO files)", () => {
    if (process.platform === "win32") return;
    rmSync(path.join(root, "decision_log.md"));
    execFileSync("mkfifo", [path.join(root, "decision_log.md")]);
    expect(resolve("decision:ADR-7", "keep it short and name the owner")).toMatchObject({ status: "unreadable", detail: "it is not a file" });
  });

  // @covers FR-01.71
  it("a pointer that is not a record form is refused (null)", () => {
    expect(resolve("event:evt-1", "x")).toBeNull();
    expect(resolve("decision:7", "x")).toBeNull();
  });
});

describe("POST /api/org/decisions/record-evidence", () => {
  const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
    createOrgApiRouter({ leadsRoot: root, honoHost: "127.0.0.1" }).request("/api/org/decisions/record-evidence", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

  // @covers FR-01.71
  it("answers with the words only when confirmed, never caches, and never echoes file content otherwise", async () => {
    const ok = await post({ pointer: RJ, quote: "Too vague: say who reads the digest." });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toMatchObject({ status: "confirmed", words: "Too vague: say who reads the digest." });
    const miss = await post({ pointer: RJ, quote: "the lead wrote this line itself, honestly" });
    const body = await miss.json();
    expect(body).toEqual({ status: "quote_not_found", form: "rejected", file: "decisions-rejected.md" });
    expect(JSON.stringify(body)).not.toContain("Too vague");
  });

  // @covers FR-01.71
  it("refuses a malformed pointer or quote, a non-JSON body and a cross-site request", async () => {
    expect((await post({ pointer: "event:x", quote: "q" })).status).toBe(400);
    expect((await post({ pointer: "", quote: "q" })).status).toBe(400);
    expect((await post({ pointer: RJ })).status).toBe(400);
    expect((await post({ pointer: RJ, quote: "q".repeat(4001) })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ pointer: RJ, quote: "q" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ pointer: RJ, quote: "q" }, { "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
});
