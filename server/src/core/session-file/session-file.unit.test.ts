import { describe, expect, it } from "vitest";

import { mentionsWholePath } from "./evidence.js";
import { isSensitivePath } from "./sensitive.js";

describe("mentionsWholePath", () => {
  // @covers FR-01.66
  it("matches a complete path and rejects partial ones", () => {
    const p = process.platform === "win32" ? "C:/w/a.txt" : "/w/a.txt";
    expect(mentionsWholePath(`see ${p}, ok`, p)).toBe(true);
    expect(mentionsWholePath(`"${p}"`, p)).toBe(true);
    expect(mentionsWholePath(`${p}.bak`, p)).toBe(false);
    expect(mentionsWholePath(`${p}/inner`, p)).toBe(false);
    expect(mentionsWholePath(`x${p}`, p)).toBe(false);
    expect(mentionsWholePath(`${p}.`, p)).toBe(true);
    for (const sfx of ["~", "+", "@v2", "%20", "#frag", "=1"]) expect(mentionsWholePath(`${p}${sfx}`, p), sfx).toBe(false);
  });
});

describe("isSensitivePath", () => {
  // @covers FR-01.66
  it.each([
    "/home/u/.ssh/config",
    "/home/u/.env",
    "/p/.env.local",
    "/p/prod.env",
    "/h/.aws/credentials",
    "/h/id_rsa",
    "/h/.npmrc",
    "C:/Users/u/.ssh/x.txt",
    "/r/.git/config",
  ])("%s", (p) => {
    expect(isSensitivePath(p)).toBe(true);
  });
  // @covers FR-01.66
  it.each(["/home/u/docs/notes.md", "/tmp/out/a.txt", "C:/proj/readme.md"])("%s is fine", (p) => {
    expect(isSensitivePath(p)).toBe(false);
  });
});
