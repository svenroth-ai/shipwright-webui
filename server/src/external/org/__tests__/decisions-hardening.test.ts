/*
 * Hardening of the proposal decisions (iterate org-proposals-hardening): the cross-site guard, an unusable
 * audit file (409 audit_unwritable), a line the lead wrote itself, the stale-entry fingerprint, and the
 * write-path text rules. Code points are built with fromCodePoint so no invisible character sits in this file.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir, userInfo } from "node:os";

import { createOrgApiRouter } from "../../../routes/org.js";
import { parseProposedEntries } from "../decisions-lock.js";
import { blockDigest } from "../proposed-line.js";
import { normalizeLine, foldForCompare } from "../proposed-grammar.js";

const TS = "2026-11-20T09:15:00.000Z";
const LEAD = "acme-lead";
const KEY = "use-weekly-digest";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const cp = (...n: number[]) => String.fromCodePoint(...n);

function entry(text: string, pointer = "session 7c1e at 2026-11-19T16:02:11Z, message 14", key = KEY): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${TS} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${text}\n` +
    `⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** ${pointer}\n`
  );
}

describe("decision hardening", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-harden-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const router = () => createOrgApiRouter({ leadsRoot: root, honoHost: "127.0.0.1" });
  const post = (route: string, body: Record<string, unknown>, headers: Record<string, string> = { "content-type": "application/json" }, raw?: string) =>
    router().request(`/api/org/decisions/${route}`, { method: "POST", headers, body: raw ?? JSON.stringify({ timestamp: TS, leadId: LEAD, ...body }) });
  const auditLines = () => (existsSync(audit) ? readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const digestOf = (raw: string) => blockDigest(parseProposedEntries(raw)[0].block);
  const me = () => userInfo().username || "operator";

  describe("A. cross-site guard on the org writes", () => {
    // @covers FR-01.71
    it("refuses a text/plain simple POST (415) and changes nothing", async () => {
      writeFileSync(proposed, entry("Line one."));
      const body = JSON.stringify({ timestamp: TS, leadId: LEAD });
      for (const route of ["countersign", "reject"]) {
        const res = await post(route, {}, { "content-type": "text/plain" }, body);
        expect(res.status).toBe(415);
        expect((await res.json()).error).toBe("unsupported_media_type");
      }
      const noType = await post("reject", {}, {}, body);
      expect(noType.status).toBe(415);
      expect(readFileSync(proposed, "utf8")).toContain(KEY);
      expect(existsSync(logged)).toBe(false);
      expect(auditLines()).toHaveLength(0);
    });

    // @covers FR-01.71
    it("refuses Sec-Fetch-Site: cross-site on every org write, JSON or not; same-origin and absent pass", async () => {
      writeFileSync(proposed, entry("Line one."));
      for (const route of ["countersign", "reject"]) {
        const res = await post(route, {}, { "content-type": "application/json", "sec-fetch-site": "cross-site" });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("cross_site_refused");
      }
      const release = await router().request(`/api/org/leads/${LEAD}/beat-register/release`, {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        body: "{}",
      });
      expect(release.status).toBe(403);
      const put = await router().request(`/api/org/leads/${LEAD}/charter`, {
        method: "PUT",
        headers: { "content-type": "text/markdown", "sec-fetch-site": "cross-site" },
        body: "# x",
      });
      expect(put.status).toBe(403);
      expect(readFileSync(proposed, "utf8")).toContain(KEY);
      expect(auditLines()).toHaveLength(0);
      const same = await post("reject", {}, { "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" });
      expect(same.status).toBe(200);
    });

    // @covers FR-01.71
    it("a cross-site GET read is untouched by the write guard", async () => {
      const res = await router().request("/api/org/org-chart", { headers: { "sec-fetch-site": "cross-site" } });
      expect(res.status).not.toBe(403);
    });
  });

  describe("B. an unusable lead audit.jsonl is 409 audit_unwritable", () => {
    // @covers FR-01.71
    it("reject and countersign refuse before changing anything", async () => {
      writeFileSync(proposed, entry("Line one."));
      mkdirSync(audit); // audit.jsonl is a directory: neither readable nor writable as a log
      for (const route of ["reject", "countersign"]) {
        const res = await post(route, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe("audit_unwritable");
        expect(body.leadId).toBe(LEAD);
        expect(body.message).toContain("audit.jsonl");
      }
      expect(readFileSync(proposed, "utf8")).toContain(KEY);
      expect(existsSync(logged)).toBe(false);
    });
  });

  describe("C. a line the lead wrote itself is not the operator's record", () => {
    const forged = (action: "rejected" | "countersigned") =>
      JSON.stringify({ ts: "2026-11-20T09:20:00.000Z", kind: `decision_${action}`, lead_id: LEAD, data: { action, entryTimestamp: TS, decisionKey: KEY, author: "the-lead" } }) + "\n";

    // @covers FR-01.71
    it("reject writes its own record next to a matching forged line, once, and says so truthfully", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, forged("rejected"));
      const first = await post("reject", { reason: "no" });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ rejected: true, alreadyRejected: false, recorded: true });
      const lines = auditLines();
      expect(lines).toHaveLength(2);
      expect(lines[1].data.author).toBe(me());
      expect(readFileSync(proposed, "utf8")).not.toContain(KEY);
      const again = await post("reject", { reason: "no" });
      expect(await again.json()).toEqual({ rejected: true, alreadyRejected: true, recorded: false });
      expect(auditLines()).toHaveLength(2);
    });

    // @covers FR-01.71
    it("crash residue (our own identical record, entry still listed) is finished without a second record and recorded:false", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, JSON.stringify({ kind: "decision_rejected", lead_id: LEAD, data: { action: "rejected", author: me(), entryTimestamp: TS, decisionKey: KEY, reason: "no" } }) + "\n");
      const res = await post("reject", { reason: "no" });
      expect(await res.json()).toEqual({ rejected: true, alreadyRejected: false, recorded: false });
      expect(auditLines()).toHaveLength(1);
      expect(readFileSync(proposed, "utf8")).not.toContain(KEY);
    });

    // @covers FR-01.71
    it("a forged line never blocks the operator: countersign says reject_pending, Reject finishes it", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, forged("rejected"));
      expect((await post("countersign", {})).status).toBe(409);
      expect((await post("reject", {})).status).toBe(200);
      expect(readFileSync(proposed, "utf8")).not.toContain(KEY);
    });

    // @covers FR-01.71
    it("countersign appends its own record even when the lead pre-planted a countersigned line", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, forged("countersigned"));
      expect((await post("countersign", {})).status).toBe(200);
      const lines = auditLines();
      expect(lines).toHaveLength(2);
      expect(lines[1].data.author).toBe(me());
      expect(lines[1].data.adr).toBe("ADR-0001");
    });
  });

  describe("F. stale-entry fingerprint", () => {
    // @covers FR-01.71
    it("countersign and reject: the shown digest matches, nothing was rewritten", async () => {
      const raw = entry("Line one.");
      writeFileSync(proposed, raw);
      const res = await post("countersign", { fingerprint: digestOf(raw) });
      expect(res.status).toBe(200);
    });

    // @covers FR-01.71
    it("a rewrite of key and evidence between view and click is 409 entry_changed and writes nothing", async () => {
      const seen = entry("Line one.");
      const shown = digestOf(seen);
      writeFileSync(proposed, entry("Line one.", "session 9z9z at 2026-11-19T16:02:11Z, message 99", "another-key"));
      for (const route of ["countersign", "reject"]) {
        const res = await post(route, { fingerprint: shown });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe("entry_changed");
      }
      expect(readFileSync(proposed, "utf8")).toContain("another-key");
      expect(existsSync(logged)).toBe(false);
      expect(auditLines()).toHaveLength(0);
    });

    // @covers FR-01.71
    it("pins the digest of the shared daemon sample (the client mirror pins the same two values)", () => {
      const raw = readFileSync(path.join(__dirname, "fixtures", "decisions-proposed-daemon-sample.md"), "utf8").split(String.fromCharCode(13)).join("");
      expect(parseProposedEntries(raw).map((e) => blockDigest(e.block))).toEqual(["0ed68ceb67d8b4c0c7f34a1ba18b9928", "d2c3b4dbd2b5e6ec1d68ca497e8fa34f"]);
    });

    // @covers FR-01.71
    it("a CRLF checkout and trailing blank lines do not change the digest", () => {
      const lf = entry("Line one.");
      expect(blockDigest(lf.replace(/\n/g, "\r\n") + "\r\n\r\n")).toBe(blockDigest(lf));
    });

    // @covers FR-01.71
    it("crash-retry still heals: residue is judged by the logged fingerprint, not by the shown digest", async () => {
      const raw = entry("Line one.");
      writeFileSync(proposed, raw);
      expect((await post("countersign", { fingerprint: digestOf(raw) })).status).toBe(200);
      writeFileSync(proposed, raw); // the removal never happened (crash): the same entry is back
      const retry = await post("countersign", { fingerprint: "0".repeat(32) }); // a digest of some older view
      expect(retry.status).toBe(200);
      expect((await retry.json()).alreadyCountersigned).toBe(true);
      expect(readFileSync(proposed, "utf8")).not.toContain(KEY);
    });

    // @covers FR-01.71
    it("a malformed fingerprint is a 400, an absent one is not checked", async () => {
      writeFileSync(proposed, entry("Line one."));
      const bad = await post("countersign", { fingerprint: "xyz" });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe("fingerprint_invalid");
      expect((await post("countersign", {})).status).toBe(200);
    });
  });

  describe("E. text rules of the write path", () => {
    // @covers FR-01.71
    it("strips braille blank, private use and lone surrogates; maps Unicode spaces to a plain space", () => {
      expect(normalizeLine(`a${cp(0x2800)}b${cp(0xe000)}c${cp(0xd800)}d${cp(0xdc00)}e`)).toBe("abcde");
      expect(normalizeLine(`a${cp(0xa0)}b${cp(0x3000)}c${cp(0x2003)}d${cp(0x202f)}e`)).toBe("a b c d e");
    });

    // @covers FR-01.71
    it("keeps emoji presentation (VS16 after an emoji base and in a keycap) but strips every other selector", () => {
      const heart = `${cp(0x2764)}${cp(0xfe0f)}`;
      expect(normalizeLine(`Love ${heart}`)).toBe(`Love ${heart}`);
      expect(normalizeLine(`1${cp(0xfe0f, 0x20e3)}`)).toBe(`1${cp(0xfe0f, 0x20e3)}`);
      expect(normalizeLine(`a${cp(0xfe0f)}b${cp(0xfe0e)}c${cp(0xe0100)}`)).toBe("abc");
      expect(normalizeLine(`${heart}${cp(0xfe0f)}`)).toBe(heart); // a second selector is not an emoji base
    });

    // @covers FR-01.71
    it("ZWJ stays stripped (decided); umlauts, CJK and plain emoji survive", () => {
      expect(normalizeLine(`${cp(0x1f468)}${cp(0x200d)}${cp(0x1f469)}`)).toBe(`${cp(0x1f468)}${cp(0x1f469)}`);
      expect(normalizeLine("Prüfung 日本語 🚀 ÄÖÜ ß")).toBe("Prüfung 日本語 🚀 ÄÖÜ ß");
    });

    // @covers FR-01.71
    it("the quote-guard fold agrees with the write path: a line hiding a quote behind these characters is caught", async () => {
      const quote = "The customer said the invoice is wrong and nothing was sent";
      expect(foldForCompare(`${cp(0x2800)}${quote.replace(" ", cp(0xa0))}${cp(0xe000)}${cp(0xfe0f)}`)).toBe(foldForCompare(quote));
      const sneaky = quote.split("").join(cp(0x2800));
      writeFileSync(proposed, entry(`Plain line.\n> ${quote}`));
      const res = await post("countersign", { line: sneaky });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("line_contains_quote");
    });

    // @covers FR-01.71
    it("an UNEDITED approval of an everyday line logs the exact line, edited:false", async () => {
      const line = "Ship 🚀 Prüfung 日本";
      writeFileSync(proposed, entry(line));
      const res = await post("countersign", {});
      expect(res.status).toBe(200);
      expect((await res.json()).edited).toBe(false);
      expect(readFileSync(logged, "utf8")).toContain(`\n- ${line}\n`);
      expect(auditLines()[0].data.edit).toBe("approved_as_proposed");
    });
  });
});
