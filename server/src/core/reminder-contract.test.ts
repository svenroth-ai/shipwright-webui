import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { GOOD_ANSWER } from "./reminder-fixtures.js";
import { parseDueAnswer, REMINDER_ITEM_FIELDS, REMINDER_LINK_FIELDS } from "./reminder-contract.js";

describe("reminder due contract (pinned, v1)", () => {
  it("pins the 10 item fields and 3 link fields", () => {
    expect([...REMINDER_ITEM_FIELDS]).toEqual(
      ["kind", "id", "title", "due", "why", "decided", "open", "command", "links", "severity"],
    );
    expect([...REMINDER_LINK_FIELDS]).toEqual(["label", "kind", "ref"]);
  });

  // Sibling Shipwright clone: SHIPWRIGHT_MONOREPO_PATH, else the usual dev layout. Absent (CI) = a visible skip;
  // the pinned lists above are then the guard.
  const contractSrc = [process.env.SHIPWRIGHT_MONOREPO_PATH, "C:/01_Development/shipwright"]
    .filter((p): p is string => Boolean(p))
    .map((p) => `${p}/shared/scripts/lib/reminder_due.py`)
    .find((p) => existsSync(p));

  it.skipIf(!contractSrc)("matches the Shipwright contract source when the sibling clone is present", () => {
    const src = readFileSync(contractSrc as string, "utf-8");
    const grab = (name: string): string[] => {
      const m = new RegExp(`${name} = \\(([^)]*)\\)`).exec(src);
      return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    };
    expect(grab("ITEM_FIELDS")).toEqual([...REMINDER_ITEM_FIELDS]);
    expect(grab("LINK_FIELDS")).toEqual([...REMINDER_LINK_FIELDS]);
    expect(/CONTRACT_VERSION = 1\b/.test(src)).toBe(true);
  });

  it("accepts the contract shape and drops the local-path fields", () => {
    const r = parseDueAnswer(JSON.stringify(GOOD_ANSWER));
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.view.items).toHaveLength(2);
    expect(Object.keys(r.view.items[0]).sort()).toEqual([...REMINDER_ITEM_FIELDS].sort());
    expect(r.view).not.toHaveProperty("sourceRoot");
    expect(r.view).not.toHaveProperty("reminderStore");
    expect(JSON.stringify(r.view)).not.toContain("C:/proj");
  });

  it("strips unknown extra item fields (only the 10 contract fields survive)", () => {
    const answer = { ...GOOD_ANSWER, items: [{ ...GOOD_ANSWER.items[0], secretExtra: "x" }] };
    const r = parseDueAnswer(JSON.stringify(answer));
    expect(r.kind === "ok" && r.view.items[0]).not.toHaveProperty("secretExtra");
  });

  it("a url link that is not http(s) loses its address on the read path (label stays)", () => {
    const links = [
      { label: "bad", kind: "url", ref: "javascript:alert(1)" },
      { label: "data", kind: "url", ref: "data:text/html,x" },
      { label: "ok", kind: "url", ref: "https://example.com/a" },
      { label: "Triage x", kind: "triage", ref: "trg-1" },
    ];
    const r = parseDueAnswer(JSON.stringify({ ...GOOD_ANSWER, items: [{ ...GOOD_ANSWER.items[0], links }] }));
    expect(r.kind === "ok" && r.view.items[0].links.map((l) => l.ref)).toEqual([null, null, "https://example.com/a", "trg-1"]);
  });

  it("an unknown contractVersion is its own state, never read as data", () => {
    expect(parseDueAnswer(JSON.stringify({ ...GOOD_ANSWER, contractVersion: 2 }))).toEqual({ kind: "unsupported-version", contractVersion: 2 });
    expect(parseDueAnswer(JSON.stringify({ items: [] }))).toMatchObject({ kind: "unreadable" }); // no version named
  });

  it.each([
    ["not JSON", "oops"],
    ["a JSON array", "[]"],
    ["no items list", JSON.stringify({ ...GOOD_ANSWER, items: undefined })],
    ["a bad day", JSON.stringify({ ...GOOD_ANSWER, on: "22.11.2026" })],
    ["a negative corrupt count", JSON.stringify({ ...GOOD_ANSWER, reminderCorruptLines: -1 })],
    ["a non-integer corrupt count", JSON.stringify({ ...GOOD_ANSWER, reminderCorruptLines: "0" })],
    ["a numeric triageError", JSON.stringify({ ...GOOD_ANSWER, triageError: 3 })],
    ["an item missing a field", JSON.stringify({ ...GOOD_ANSWER, items: [{ ...GOOD_ANSWER.items[0], open: undefined }] })],
    ["an item with an unknown kind", JSON.stringify({ ...GOOD_ANSWER, items: [{ ...GOOD_ANSWER.items[0], kind: "alarm" }] })],
    ["a non-string text field", JSON.stringify({ ...GOOD_ANSWER, items: [{ ...GOOD_ANSWER.items[0], why: 5 }] })],
    ["a malformed link", JSON.stringify({ ...GOOD_ANSWER, items: [{ ...GOOD_ANSWER.items[0], links: [{ label: "x" }] }] })],
  ])("%s is unreadable", (_name, stdout) => {
    expect(parseDueAnswer(stdout).kind).toBe("unreadable");
  });

  it("carries triageError and the damaged-line count through intact", () => {
    const r = parseDueAnswer(JSON.stringify({ ...GOOD_ANSWER, triageError: "the triage log could not be read (OSError)", reminderCorruptLines: 2, items: [] }));
    expect(r).toMatchObject({ kind: "ok", view: { triageError: "the triage log could not be read (OSError)", reminderCorruptLines: 2, items: [] } });
  });
});
