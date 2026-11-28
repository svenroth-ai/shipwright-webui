import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { registerOrgWriteActions } from "../../../routes/org-writes.js";
import { parseProposedEntries } from "../decisions-lock.js";
import { parseEvidence, parseSourceRef } from "../proposed-grammar.js";
import { MAX_POINTER_CHARS } from "../proposed-evidence-pointer.js";
import { proposalFacts } from "../proposed-line.js";

// The two evidence pointer forms leadwright #149 added (d5c9ae01): a file line `file:<project>/<path>#L<n>` and a
// journal event `event:<id>`, percent-encoded per component. Fixture: leadwright
// tests/fixtures/decisions-proposed-renderentry-evidence-forms-sample.md (renderEntry output, d5c9ae01).
const FIXTURE = path.join(import.meta.dirname, "fixtures", "decisions-proposed-renderentry-evidence-forms-sample.md");
const FILE_PTR = "file:dinovo%20GmbH/Projekte/Q4%20Plan.md#L3";
const FILE_QUOTE = "answered within two working days";
const EVENT_PTR = "event:evt-2026-11-27-001";
const EVENT_QUOTE = "release branch be merged before the freeze";
const LEAD = "acme-lead";
const TS1 = "2026-11-27T09:15:00.000Z";
const TS2 = "2026-11-27T10:30:00.000Z";

describe("parseSourceRef: file-line and journal-event pointers", () => {
  // @covers FR-01.71
  it("reads the file pointer as project, decoded path segments and line", () => {
    expect(parseSourceRef(FILE_PTR)).toEqual({ kind: "file", project: "dinovo GmbH", path: ["Projekte", "Q4 Plan.md"], line: 3 });
    expect(parseSourceRef("file:p/a/b/c.ts#L123456789")).toEqual({ kind: "file", project: "p", path: ["a", "b", "c.ts"], line: 123456789 });
  });

  // @covers FR-01.71
  it("accepts lowercase hex and needlessly encoded unreserved bytes; decodes UTF-8", () => {
    expect(parseSourceRef("file:dinovo%20GmbH/%c3%84nderungen.md#L1")).toEqual({ kind: "file", project: "dinovo GmbH", path: ["Änderungen.md"], line: 1 });
    expect(parseSourceRef("file:%41cme/x.md#L2")).toMatchObject({ kind: "file", project: "Acme" });
  });

  // @covers FR-01.71
  it("reads the event pointer as its decoded id", () => {
    expect(parseSourceRef(EVENT_PTR)).toEqual({ kind: "event", id: "evt-2026-11-27-001" });
    expect(parseSourceRef("event:release%3Afreeze%20%231")).toEqual({ kind: "event", id: "release:freeze #1" });
  });

  // @covers FR-01.71
  it("tries the session excerpt first: a session id may itself be file or event", () => {
    expect(parseSourceRef("file:2026-11-19T16:02:11Z:3")).toEqual({ kind: "known", session: "file", time: "2026-11-19T16:02:11Z", message: "3" });
    expect(parseSourceRef("event:2026-11-19T16:02:11.5Z:9")).toMatchObject({ kind: "known", session: "event" });
  });

  const refused: Array<[string, string]> = [
    ["no path segment", "file:proj#L3"],
    ["line 0", "file:p/a#L0"],
    ["leading zero", "file:p/a#L01"],
    ["ten-digit line", "file:p/a#L1234567890"],
    ["no line", "file:p/a"],
    ["trailing text", "file:p/a#L3x"],
    ["raw space", "file:p/a b.md#L1"],
    ["raw non-ASCII", "file:p/Änderung.md#L1"],
    ["raw backslash", "file:p/a\\b#L1"],
    ["broken UTF-8", "file:p/%C3%28#L1"],
    ["empty segment", "file:p//a#L1"],
    ["dot segment", "file:p/./a#L1"],
    ["dot-dot segment (encoded)", "file:p/%2e%2e/a#L1"],
    ["encoded slash", "file:p/a%2Fb#L1"],
    ["encoded backslash", "file:p/a%5Cb#L1"],
    ["encoded colon", "file:p/a%3Ab#L1"],
    ["encoded star", "file:p/a%2A#L1"],
    ["trailing dot", "file:p/a.#L1"],
    ["trailing space", "file:p/a%20#L1"],
    ["device name", "file:p/con#L1"],
    ["device name with extension", "file:p/NUL.txt#L1"],
    ["device name lpt", "file:lpt1/a#L1"],
    ["control character", "file:p/a%00b#L1"],
    ["bidi override (stricter than the producer, for display)", "file:p/a%E2%80%AEb#L1"],
    ["upper-case prefix", "FILE:p/a#L1"],
    ["empty event", "event:"],
    ["blank event", "event:%20"],
    ["event with raw space", "event:a b"],
    ["event with broken UTF-8", "event:%C3%28"],
    ["event with zero width", "event:a%E2%80%8Bb"],
    ["event with line separator", "event:a%E2%80%A8b"],
    ["file component made of a Hangul filler (renders as nothing)", "file:p/%E3%85%A4#L1"],
    ["event with a Hangul filler", "event:a%E3%85%A4"],
    ["event with a variation selector", "event:a%EF%B8%8Fb"],
    ["event with a private-use character", "event:a%EE%80%80b"],
    ["file component holding the label separator (could fake a line part)", "file:a%20%C2%B7%20line%209/b.md#L1"],
  ];
  for (const [name, raw] of refused) {
    // @covers FR-01.71
    it(`refuses ${name} as unknown source with the raw text`, () => {
      expect(parseSourceRef(raw)).toEqual({ kind: "unknown", raw });
    });
  }

  // @covers FR-01.71
  it("refuses a pointer longer than 1024 characters; 1024 still reads", () => {
    const at = (n: number) => `file:p/${"a".repeat(n - "file:p/#L1".length)}#L1`;
    expect(at(MAX_POINTER_CHARS).length).toBe(1024);
    expect(parseSourceRef(at(MAX_POINTER_CHARS)).kind).toBe("file");
    expect(parseSourceRef(at(MAX_POINTER_CHARS + 1)).kind).toBe("unknown");
    expect(parseSourceRef(`event:${"e".repeat(1019)}`).kind).toBe("unknown");
  });
});

describe("parseEvidence licenses a quote for all three known forms", () => {
  // @covers FR-01.71
  it("file and event pointers carry their quote; a malformed pointer carries none", () => {
    expect(parseEvidence(`${FILE_PTR} — "${FILE_QUOTE}"`)).toEqual({ source: parseSourceRef(FILE_PTR), quote: FILE_QUOTE });
    expect(parseEvidence(`${EVENT_PTR} — "${EVENT_QUOTE}"`)).toEqual({ source: parseSourceRef(EVENT_PTR), quote: EVENT_QUOTE });
    const bad = `file:p/con#L1 — "${FILE_QUOTE}"`;
    expect(parseEvidence(bad)).toEqual({ source: { kind: "unknown", raw: bad }, quote: null });
    expect(parseEvidence(`${EVENT_PTR} — ""`)).toEqual({ source: parseSourceRef(EVENT_PTR), quote: null });
  });
});

describe("pinned leadwright renderEntry evidence-forms sample", () => {
  const raw = readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n");

  // @covers FR-01.71
  it("hash is named in the contract doc", () => {
    const sha = createHash("sha256").update(raw).digest("hex");
    const doc = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "org-proposed-entry-contract.md"), "utf8");
    expect(doc).toContain(sha);
  });

  // @covers FR-01.71
  it("both entries list; facts carry the structured pointer and the quote as a guard needle", () => {
    const entries = parseProposedEntries(raw);
    expect(entries.map((e) => [e.timestamp, e.leadId])).toEqual([[TS1, LEAD], [TS2, LEAD]]);
    const file = proposalFacts(entries[0].block);
    expect(file?.evidence).toEqual({ form: "file", project: "dinovo GmbH", path: ["Projekte", "Q4 Plan.md"], line: 3 });
    expect(file?.quotes).toContain(FILE_QUOTE);
    const event = proposalFacts(entries[1].block);
    expect(event?.evidence).toEqual({ form: "event", id: "evt-2026-11-27-001" });
    expect(event?.quotes).toContain(EVENT_QUOTE);
  });
});

describe("countersign of the pinned file-line and event entries", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-evforms-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
    writeFileSync(proposed, readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const post = (timestamp: string, body: Record<string, unknown>) => {
    const a = new Hono();
    registerOrgWriteActions(a, { leadsRoot: root });
    return a.request("/api/org/decisions/countersign", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timestamp, leadId: LEAD, ...body }),
    });
  };
  const records = () => (existsSync(audit) ? readFileSync(audit, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  // @covers FR-01.71
  it("an unedited line that repeats the quote is refused with 400 line_contains_quote, for both forms", async () => {
    for (const ts of [TS1, TS2]) {
      const res = await post(ts, {});
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("line_contains_quote");
    }
    expect(existsSync(logged)).toBe(false);
    expect(records()).toEqual([]);
  });

  // @covers FR-01.71
  it("a pointer the daemon accepts but the reader refuses (emoji VS16 in a file name) still guards its quote; audit evidence null", async () => {
    const refused = "file:p/%E2%9D%A4%EF%B8%8F%20notes.md#L1";
    const raw = readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n").replace("file:dinovo%20GmbH/Projekte/Q4%20Plan.md#L3", refused);
    writeFileSync(proposed, raw);
    expect(parseSourceRef(refused).kind).toBe("unknown");
    expect(proposalFacts(parseProposedEntries(raw)[0].block)?.quotes).toContain(FILE_QUOTE);
    const res = await post(TS1, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("line_contains_quote");
    expect((await post(TS1, { line: "Reviews get a reply quickly." })).status).toBe(200);
    expect(records()[0].data.evidence).toBeNull();
  });

  // @covers FR-01.71
  it("an edited line passes; the audit keeps the structured pointer and never the quote", async () => {
    expect((await post(TS1, { line: "Reviews get a reply quickly." })).status).toBe(200);
    expect((await post(TS2, { line: "Merge release work early." })).status).toBe(200);
    const [r1, r2] = records();
    expect(r1.data.evidence).toEqual({ form: "file", project: "dinovo GmbH", path: ["Projekte", "Q4 Plan.md"], line: 3 });
    expect(r2.data.evidence).toEqual({ form: "event", id: "evt-2026-11-27-001" });
    const auditText = readFileSync(audit, "utf8");
    const log = readFileSync(logged, "utf8");
    for (const q of [FILE_QUOTE, EVENT_QUOTE]) {
      expect(auditText).not.toContain(q);
      expect(log).not.toContain(q);
    }
  });
});
