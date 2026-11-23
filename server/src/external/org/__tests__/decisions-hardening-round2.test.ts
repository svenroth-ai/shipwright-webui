import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { foldForCompare, normalizeLine } from "../proposed-grammar.js";
import { orgWriteGuard } from "../../../routes/org-write-guard.js";

const cp = (...n: number[]) => String.fromCodePoint(...n);

describe("doubt-review follow-ups", () => {
  // @covers FR-01.71
  it("a zero width space between a letter and its combining mark cannot dodge the quote fold", () => {
    const hidden = `u${cp(0x200b, 0x308)}ber`;
    expect(foldForCompare(hidden)).toBe(foldForCompare(`${cp(0xfc)}ber`));
  });

  // @covers FR-01.71
  it("non-characters are stripped on the write path and in the fold", () => {
    const t = `a${cp(0xfdd0)}b${cp(0xfffe)}c${cp(0xffff)}`;
    expect(normalizeLine(t)).toBe("abc");
    expect(foldForCompare(t)).toBe("abc");
  });

  // @covers FR-01.71
  it("the write guard refuses same-site and cross-site, allows same-origin, none and a missing header", async () => {
    const app = new Hono();
    app.use("/api/org/*", orgWriteGuard);
    app.post("/api/org/x", (c) => c.json({ ok: true }));
    const post = (site?: string) =>
      app.request("/api/org/x", { method: "POST", headers: { "content-type": "application/json", ...(site ? { "sec-fetch-site": site } : {}) }, body: "{}" });
    expect((await post("cross-site")).status).toBe(403);
    expect((await post("same-site")).status).toBe(403);
    expect((await post("same-origin")).status).toBe(200);
    expect((await post("none")).status).toBe(200);
    expect((await post()).status).toBe(200);
  });
});
