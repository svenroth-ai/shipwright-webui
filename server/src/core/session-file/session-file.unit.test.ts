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
  it("project scope only refuses unmistakable secret names", () => {
    for (const p of [".ssh/config", ".env", "x/.env.local", "id_rsa", ".npmrc"]) expect(isSensitivePath(p, "project"), p).toBe(true);
    for (const p of ["locales/en/auth.json", "ansible/hosts.yml", ".vscode/mcp.json", "src/gh/client.ts", ".config/app.yml", ".cargo/config.toml"]) {
      expect(isSensitivePath(p, "project"), p).toBe(false);
    }
  });

  // @covers FR-01.66
  it.each(["/h/.pulumi/credentials.json", "/h/.claude/settings.json", "/h/.yarnrc.yml", "/h/.config/app.yml"])("outside scope refuses %s", (p) => {
    expect(isSensitivePath(p)).toBe(true);
  });

  // @covers FR-01.66
  it.each(["/home/u/docs/notes.md", "/tmp/out/a.txt", "C:/proj/readme.md"])("%s is fine", (p) => {
    expect(isSensitivePath(p)).toBe(false);
  });
});

describe("findSessionEvidence queue", () => {
  // @covers FR-01.66
  it("a failing scan does not poison the next one, and parallel calls both resolve", async () => {
    const { findSessionEvidence } = await import("./evidence.js");
    const loc = { path: "Z:/definitely/missing.jsonl", encodedCwd: "x", mtimeMs: 0, sizeBytes: 0 };
    const [a, b] = await Promise.all([
      findSessionEvidence("u", loc, ["/x/a.txt"], { infoDeps: { noMemo: true } }),
      findSessionEvidence("u", loc, ["/x/b.txt"], { infoDeps: { noMemo: true } }),
    ]);
    expect(a.found.size).toBe(0);
    expect(b.found.size).toBe(0);
    expect(a.incomplete && b.incomplete).toBe(true);
    expect((await findSessionEvidence("u", null, ["/x/c"])).found.size).toBe(0);
  });
});
