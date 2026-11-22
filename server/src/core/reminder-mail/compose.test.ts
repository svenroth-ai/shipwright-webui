import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ReminderDueItem } from "../reminder-contract.js";
import { clean, composeItemMail, composeSummaryMail } from "./compose.js";
import { describeSendError } from "./transport.js";

const ADDR = "https://shipwright.mydomain.example";
const item = (over: Partial<ReminderDueItem> = {}): ReminderDueItem => ({
  kind: "reminder", id: "rem-aabbccdd", title: "Renew the certificate", due: "2026-11-22",
  why: "It expires.", decided: null, open: null, command: null, links: [], severity: null, ...over,
});

// @covers FR-01.77
describe("clean", () => {
  it("cuts at 1000 characters with an ellipsis", () => {
    const out = clean("x".repeat(5000));
    expect(out).toBe(`${"x".repeat(1000)}...`);
  });

  it("redacts local paths of every shape but keeps URLs", () => {
    const out = clean("a C:\\Users\\me\\repo\\x.txt b /home/me/proj/y c ~/secret/z d \\\\srv\\share\\f e https://example.com/home/x");
    expect(out).not.toMatch(/Users|\/home\/me|~\/|srv/);
    expect(out).toContain("https://example.com/home/x");
    expect(out.match(/\[path\]/g)).toHaveLength(4);
  });

  it.each([
    ["backtick-quoted", "see `/Users/sven/acme/notes.md` now", "Users/sven"],
    ["colon-prefixed", "store:/home/sven/proj/reminders.jsonl", "home/sven"],
    ["bracketed", "see [~/secret/x] here", "secret"],
    ["angle-bracketed", "see </projects/acme/readme.md> here", "acme"],
    ["comma-prefixed", "a,/var/lib/app/data.db,b", "var/lib"],
    ["parenthesised home", "(~/secret/x)", "secret"],
  ])("redacts a %s path", (_name, input, leak) => {
    const out = clean(input);
    expect(out).toContain("[path]");
    expect(out).not.toContain(leak);
  });

  it("keeps a web address that has a path-looking part, also next to quotes and brackets", () => {
    const out = clean("see https://host.example/home/x/y and `https://host.example/Users/a/b` and [http://h.example:8080/var/lib/z]");
    expect(out).toContain("https://host.example/home/x/y");
    expect(out).toContain("https://host.example/Users/a/b");
    expect(out).toContain("http://h.example:8080/var/lib/z");
    expect(out).not.toContain("[path]");
  });

  it("strips control and bidi characters", () => {
    expect(clean("a\u0000b\u202Ec\u0007d")).toBe("abcd");
  });
});

// @covers FR-01.77
describe("composeItemMail", () => {
  it("escapes hostile text in the HTML part and keeps it as plain text in the text part", () => {
    const m = composeItemMail({ item: item({ title: "<script>alert(1)</script>", why: "<img src=x onerror=alert(1)>" }), projectName: "P", projectId: "p1" }, ADDR);
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toMatch(/<img(?![^>]*cid:shipwright-logo)/); // only the inline logo is an image
    expect(m.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(m.text).toContain("<script>alert(1)</script>");
  });

  it("cannot be made to inject headers through the subject", () => {
    const m = composeItemMail({ item: item({ title: "Hi\r\nBcc: evil@example.org" }), projectName: "P", projectId: "p1" }, ADDR);
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("carries only http(s) url links, never a file path or a javascript: address", () => {
    const m = composeItemMail({
      item: item({ links: [
        { label: "Order", kind: "url", ref: "https://example.org/order" },
        { label: "Local", kind: "file", ref: "C:\\Users\\me\\notes.md" },
        { label: "Evil", kind: "url", ref: "javascript:alert(1)" },
      ] }),
      projectName: "P",
    }, ADDR);
    expect(m.text).toContain("https://example.org/order");
    expect(m.text + m.html).not.toMatch(/notes\.md|javascript:|Users/);
  });

  it("shows where an untrusted link label really goes", () => {
    const m = composeItemMail({ item: item({ links: [{ label: "Open in the Command Center", kind: "url", ref: "https://evil.example/x" }] }), projectName: "P", projectId: "p1" }, ADDR);
    expect(m.html).toContain("(evil.example)");
  });

  it("redacts any absolute path with two or more segments but keeps a lone command", () => {
    const out = clean("See /projects/acme/private.txt then run /shipwright-iterate now");
    expect(out).not.toContain("acme");
    expect(out).toContain("/shipwright-iterate");
  });

  it("scrubs even a one- or two-character password literally", () => {
    expect(describeSendError(new Error("535 rejected xy"), { host: "h", port: 1, user: "u", pass: "xy" })).not.toContain("xy");
  });

  it("redacts MSYS paths and file:// addresses too", () => {
    const out = clean("a /c/Users/me/x b file:///C:/work/y c /workspace/z");
    expect(out).not.toMatch(/Users|work|workspace/);
  });

  it("builds both links from the WebUI address", () => {
    const m = composeItemMail({ item: item(), projectName: "P", projectId: "p1" }, ADDR);
    expect(m.text).toContain(`${ADDR}/inbox`);
    expect(m.text).toContain(`${ADDR}/settings`);
    expect(m.html).toContain(`href="${ADDR}/inbox"`);
  });

  it("shows a command as inert text, labelled as not run, and redacts paths in it", () => {
    const m = composeItemMail({ item: item({ command: "cd C:\\work\\repo && do-it" }), projectName: "P", projectId: "p1" }, ADDR);
    expect(m.text).toContain("Next step (text only, not run)");
    expect(m.text).not.toContain("C:\\work");
  });

  it("uses a different subject and once-only note for an expired parked item", () => {
    const m = composeItemMail({ item: item({ kind: "triage", id: "trg-1" }), projectName: "P", projectId: "p1" }, ADDR);
    expect(m.subject).toMatch(/Parked item expired/);
    expect(m.text).toContain("only mail for this parked item");
  });
});

// @covers FR-01.77
describe("composeSummaryMail", () => {
  it("never says nothing is due when part of the check failed", () => {
    const m = composeSummaryMail([], { address: ADDR, day: "2026-11-22", problems: ["P: parked triage items could not be read."] });
    expect(m.text).not.toContain("Nothing is due");
    expect(m.text).toContain("could not read everything");
  });

  it("lists the items and caps a long list", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ item: item({ id: `rem-${i}`, title: `T${i}` }), projectName: "P", projectId: "p1" }));
    const m = composeSummaryMail(entries, { address: ADDR, day: "2026-11-22", problems: [] });
    expect(m.subject).toContain("40 items due");
    expect(m.text).toContain("...and 10 more");
  });
});

// @covers FR-01.77
describe("describeSendError scrubbing", () => {
  const pass = `pw-${randomUUID()}`;
  const cfg = { host: "smtp.example.org", port: 587, user: "me@example.org", pass };
  it.each([
    ["plain", pass],
    ["url-encoded", encodeURIComponent(pass + " &")],
    ["base64", Buffer.from(pass).toString("base64")],
    ["AUTH PLAIN blob", Buffer.from(`\0me@example.org\0${pass}`).toString("base64")],
  ])("removes the password (%s) from the failure text", (_n, form) => {
    const out = describeSendError(new Error(`535 rejected ${form} at smtp://me%40example.org:${pass}@smtp.example.org`), cfg);
    expect(out).not.toContain(pass);
    expect(out).not.toContain(form.replace(/\s|&/g, ""));
    expect(out).not.toMatch(/:\/\/[^*]*:[^@*]*@/);
  });
  it("is one short line and names a refused connection plainly", () => {
    expect(describeSendError(Object.assign(new Error("x\ny"), { code: "ECONNREFUSED" }), cfg)).toBe("connection refused by smtp.example.org:587");
    expect(describeSendError(new Error("a\nb ".repeat(300)), cfg).length).toBeLessThanOrEqual(303);
  });
});
