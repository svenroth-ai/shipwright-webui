import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { handleRejectRequest } from "../reject-request.js";
import { handleCountersignRequest } from "../countersign-request.js";
import {
  REJECTED_FILE_HEADER, QUOTE_WITHHELD, RejectedFileUnwritableError, toRejectedBlock, parseRejectedBlocks, appendRejectedBlock,
} from "../decisions-rejected.js";

const TS = "2026-11-20T09:15:00.000Z";
const TS2 = "2026-11-20T10:30:00.000Z";
const LEAD = "acme-lead";
const KEY = "use-weekly-digest";
const LINE = "Status updates go out as one weekly digest instead of per-task messages.";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const NOW = "2026-11-28T10:00:00.000Z";
const QUOTE = "> The customer wrote that every single update should arrive in one combined mail — acme:2026-11-19T16:02:11Z:14";
const AUTHOR = "operator-x";

function daemonEntry(ts: string, key: string, line = LINE, quote: string | null = null): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${ts} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${line}\n${quote === null ? "" : `${quote}\n`}` +
    `⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** session 7c1e at 2026-11-19T16:02:11Z, message 14\n`
  );
}
const webuiEntry = (ts: string, body: string) => `## [${ts}] ${LEAD}\n\n${body}\n`;

describe("decisions-rejected.md (iterate-2026-11-28-decision-reject-reason)", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let rejected: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-rejected-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    rejected = path.join(root, "decisions-rejected.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const deps = () => ({ leadsRoot: root, author: () => AUTHOR, now: () => new Date(NOW) });
  const reject = (body: Record<string, unknown>) => handleRejectRequest(deps(), { timestamp: TS, leadId: LEAD, ...body });
  const countersign = (body: Record<string, unknown>) =>
    handleCountersignRequest({ leadsRoot: root, author: AUTHOR, now: () => new Date(NOW) }, { timestamp: TS, leadId: LEAD, ...body });
  const auditLines = () => (existsSync(audit) ? readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  describe("reject appends one block", () => {
    // @covers FR-01.71
    it("creates the file with its header and the exact block; the audit keeps data.reason", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      const res = await reject({ reason: "  too vague,\nsay who reads it " });
      expect(res.status).toBe(200);
      expect(read(rejected)).toBe(
        REJECTED_FILE_HEADER +
          `## Rejected [${TS}] ${LEAD}\n<!-- decisionKey: ${KEY} -->\n\n- ${LINE}\n- Rejected: ${NOW}\n- Reason: too vague, say who reads it\n\n`,
      );
      expect(auditLines()).toHaveLength(1);
      expect(auditLines()[0].data.reason).toBe("too vague, say who reads it");
      expect(read(proposed)).not.toContain(KEY);
    });

    // @covers FR-01.71
    it("without a reason: no Reason item, and data.reason is null; a second reject appends below", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY) + daemonEntry(TS2, "keep-reviews", "Keep reviews weekly."));
      expect((await reject({})).status).toBe(200);
      expect((await handleRejectRequest(deps(), { timestamp: TS2, leadId: LEAD, reason: null })).status).toBe(200);
      const blocks = parseRejectedBlocks(read(rejected)!);
      expect(blocks.map((b) => [b.timestamp, b.decisionKey, b.text, b.reason])).toEqual([
        [TS, KEY, LINE, null],
        [TS2, "keep-reviews", "Keep reviews weekly.", null],
      ]);
      expect(read(rejected)).not.toContain("- Reason:");
      expect(auditLines()[0].data.reason).toBeNull();
    });

    // @covers FR-01.71
    it("an unfenced entry has no marker and its multi-line body is flattened to one line (no forged header)", async () => {
      writeFileSync(proposed, webuiEntry(TS, `Plain learning.\nSecond line ## Rejected [${TS2}] other-lead`));
      expect((await reject({ reason: "no" })).status).toBe(200);
      const text = read(rejected)!;
      expect(text).toContain(`## Rejected [${TS}] ${LEAD}\n\n- Plain learning. Second line ## Rejected [${TS2}] other-lead\n`);
      expect(text).not.toContain("decisionKey");
      expect(parseRejectedBlocks(text)).toHaveLength(1);
    });

    // @covers FR-01.71
    it("an unfenced body leaves its quote lines and Evidence bullet out of the shared file", async () => {
      writeFileSync(proposed, webuiEntry(TS, "Use one digest.\n> secret quote of a customer\n- **Evidence:** session 7c1e at 2026-11-19T16:02:11Z, message 14"));
      expect((await reject({})).status).toBe(200);
      const text = read(rejected)!;
      expect(parseRejectedBlocks(text)[0].text).toBe("Use one digest.");
      expect(text).not.toContain("secret quote");
    });

    // @covers FR-01.71
    it("a proposed line that copies a quote of the lead is withheld, never shared with other leads", async () => {
      const copied = "every single update should arrive in one combined mail";
      writeFileSync(proposed, daemonEntry(TS, KEY, `Rule: ${copied}.`, QUOTE));
      expect((await reject({})).status).toBe(200);
      const text = read(rejected)!;
      expect(text).toContain(`- ${QUOTE_WITHHELD}\n`);
      expect(text).not.toContain(copied);
    });
  });

  describe("quote withholding on a long line", () => {
    // @covers FR-01.71
    it("an over-long line that copies a quote within its first 2000 characters is withheld too", async () => {
      const copied = "every single update should arrive in one combined mail";
      writeFileSync(proposed, daemonEntry(TS, KEY, `Rule: ${copied}. ${"x".repeat(2100)}`, QUOTE));
      expect((await reject({})).status).toBe(200);
      expect(read(rejected)).toContain(`- ${QUOTE_WITHHELD}\n`);
      expect(read(rejected)).not.toContain(copied);
    });

    // @covers FR-01.71
    it("an over-long line without a quote is cut to 2000 characters", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY, "y".repeat(2500)));
      expect((await reject({})).status).toBe(200);
      expect(parseRejectedBlocks(read(rejected)!)[0].text).toBe("y".repeat(2000));
    });
  });

  describe("exactly once under retries", () => {
    // @covers FR-01.71
    it("crash after the block, before the removal: the retry appends nothing and removes the entry", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      await reject({ reason: "too vague" });
      const before = read(rejected);
      writeFileSync(proposed, daemonEntry(TS, KEY)); // the removal "did not happen"
      const res = await reject({ reason: "another reason" });
      expect(res.status).toBe(200);
      expect(read(rejected)).toBe(before);
      expect(read(proposed)).not.toContain(KEY);
      expect(auditLines()).toHaveLength(1);
    });

    // @covers FR-01.71
    it("crash after the audit line, before the block: countersign is refused, the retry writes the block once with its own reason", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      await reject({ reason: "too vague" });
      rmSync(rejected); // the block "was never written"
      writeFileSync(proposed, daemonEntry(TS, KEY));
      const cs = await countersign({});
      expect(cs.status).toBe(409);
      expect(cs.body.error).toBe("reject_pending");
      expect(read(logged) ?? "").toBe("");
      const res = await reject({ reason: "wrong team" });
      expect(res.body).toMatchObject({ rejected: true, recorded: false, reasonKept: true, existingReason: "too vague" });
      const blocks = parseRejectedBlocks(read(rejected)!);
      expect(blocks).toHaveLength(1);
      // the org-wide file carries THIS request's reason; the audit file's read-back reason is lead-writable
      expect(blocks[0].reason).toBe("wrong team");
    });

    // @covers FR-01.71
    it("a different proposal under the same identity, or the same line under a new timestamp, gets its own block", () => {
      const base = { timestamp: TS, leadId: LEAD, decisionKey: KEY, text: LINE, rejectedAt: NOW, reason: null };
      expect(appendRejectedBlock(rejected, base)).toBe(true);
      expect(appendRejectedBlock(rejected, { ...base, rejectedAt: "2026-11-29T00:00:00.000Z", reason: "x" })).toBe(false);
      expect(appendRejectedBlock(rejected, { ...base, text: "A rewritten line." })).toBe(true);
      expect(appendRejectedBlock(rejected, { ...base, timestamp: TS2 })).toBe(true);
      expect(appendRejectedBlock(rejected, { ...base, decisionKey: null })).toBe(true);
      expect(parseRejectedBlocks(read(rejected)!)).toHaveLength(4);
    });
  });

  describe("reason rules (same as an edited line)", () => {
    // @covers FR-01.71
    it("600 characters pass, 601 are refused with nothing changed", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      const tooLong = await reject({ reason: "y".repeat(601) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error).toBe("reason_too_long");
      expect(read(rejected)).toBeNull();
      expect(read(proposed)).toBe(daemonEntry(TS, KEY));
      expect(auditLines()).toHaveLength(0);
      const ok = await reject({ reason: "y".repeat(600) });
      expect(ok.status).toBe(200);
      expect(parseRejectedBlocks(read(rejected)!)[0].reason).toHaveLength(600);
    });

    // @covers FR-01.71
    it("a reason that repeats a quote of the entry is refused; a non-string reason is invalid", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY, LINE, QUOTE));
      const quoted = await reject({ reason: "they said every single update should arrive in one combined mail" });
      expect(quoted.status).toBe(400);
      expect(quoted.body.error).toBe("reason_contains_quote");
      expect((await reject({ reason: 42 })).body.error).toBe("reason_invalid");
      expect(read(rejected)).toBeNull();
      expect(auditLines()).toHaveLength(0);
    });

    // @covers FR-01.71
    it("an unusable rejected file refuses the reject before anything changes", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      mkdirSync(rejected); // a directory where the file belongs
      const res = await reject({ reason: "x" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("rejected_file_unwritable");
      expect(read(proposed)).toBe(daemonEntry(TS, KEY));
      expect(auditLines()).toHaveLength(0);
      // the same failure at the write itself (after the audit record) is reported as half done
      let caught: unknown;
      try {
        appendRejectedBlock(rejected, { timestamp: TS, leadId: LEAD, decisionKey: KEY, text: LINE, rejectedAt: NOW, reason: null });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RejectedFileUnwritableError);
      expect((caught as RejectedFileUnwritableError).auditWritten).toBe(true);
    });
  });

  describe("boundary probes (human-edited file)", () => {
    // @covers FR-01.71
    it("trailing whitespace on a hand-edited heading or marker does not hide the block from the duplicate check", () => {
      const base = { timestamp: TS, leadId: LEAD, decisionKey: KEY, text: LINE, rejectedAt: NOW, reason: null };
      const edited = (REJECTED_FILE_HEADER + toRejectedBlock(base)).replace(/^(## Rejected .*|<!-- decisionKey: .* -->)$/gm, "$1  ");
      expect(parseRejectedBlocks(edited)).toEqual([base]);
    });

    // @covers FR-01.71
    it("a CRLF + BOM file without a trailing newline is read, de-duplicated and appended to", () => {
      const base = { timestamp: TS, leadId: LEAD, decisionKey: KEY, text: LINE, rejectedAt: NOW, reason: "ünïcode — reason" };
      const edited = "\uFEFF" + (REJECTED_FILE_HEADER + toRejectedBlock(base)).replace(/\n/g, "\r\n").trimEnd();
      writeFileSync(rejected, edited);
      expect(parseRejectedBlocks(edited)).toEqual([{ ...base }]);
      expect(appendRejectedBlock(rejected, { ...base, rejectedAt: "2026-11-29T00:00:00.000Z" })).toBe(false);
      expect(read(rejected)).toBe(edited);
      expect(appendRejectedBlock(rejected, { ...base, timestamp: TS2 })).toBe(true);
      const after = read(rejected)!;
      expect(after.startsWith(edited + "\n\n## Rejected")).toBe(true);
      expect(parseRejectedBlocks(after)).toHaveLength(2);
    });

    // @covers FR-01.71
    it("an empty existing file gets the header; a reason that is blank after normalisation is no reason", async () => {
      writeFileSync(rejected, "  \n");
      writeFileSync(proposed, daemonEntry(TS, KEY));
      expect((await reject({ reason: "\u200b \t\n" })).status).toBe(200);
      expect(read(rejected)!.startsWith(REJECTED_FILE_HEADER)).toBe(true);
      expect(read(rejected)).not.toContain("- Reason:");
      expect(auditLines()[0].data.reason).toBeNull();
    });
  });

  describe("pinned sample (cross-repo contract)", () => {
    // @covers FR-01.71
    it("the writer produces exactly the fixture, and the parser reads it back by position", () => {
      const fixture = readFileSync(path.join(__dirname, "fixtures", "decisions-rejected-sample.md"), "utf8");
      const built =
        REJECTED_FILE_HEADER +
        toRejectedBlock({ timestamp: TS, leadId: LEAD, decisionKey: KEY, text: LINE, rejectedAt: NOW, reason: "Too vague: say who reads the digest." }) +
        toRejectedBlock({ timestamp: TS2, leadId: "ops-lead", decisionKey: null, text: "Reason: a proposed line may start like an item.", rejectedAt: "2026-11-28T11:30:00.000Z", reason: null });
      expect(fixture.replace(/\r/g, "")).toBe(built);
      expect(parseRejectedBlocks(fixture)).toEqual([
        { timestamp: TS, leadId: LEAD, decisionKey: KEY, text: LINE, rejectedAt: NOW, reason: "Too vague: say who reads the digest." },
        { timestamp: TS2, leadId: "ops-lead", decisionKey: null, text: "Reason: a proposed line may start like an item.", rejectedAt: "2026-11-28T11:30:00.000Z", reason: null },
      ]);
    });
  });
});
