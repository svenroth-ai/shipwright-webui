import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BS, app, fx, get, installFixtures, j, say, session, user } from "./session-file.fixture.js";
import { assistant, toolUse } from "../../core/session-info/test-fixtures.js";

installFixtures();

describe("GET /api/external/tasks/:id/session-file", () => {
  // @covers FR-01.66
  it("404 for an unknown task", async () => {
    expect((await app(false).request("/api/external/tasks/t1/session-file?path=x")).status).toBe(404);
  });

  // @covers FR-01.66
  it("serves project files by relative and absolute path without any session", async () => {
    for (const p of ["in.md", path.join(fx.proj, "in.md")]) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.headers.get("x-session-file-scope")).toBe("project");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await r.text()).toBe("# inside");
    }
  });

  // @covers FR-01.66
  it("rejects traversal, empty and NUL input", async () => {
    session(say(1, "hi"));
    expect((await get("../x.md")).status).toBe(400);
    expect((await get("sub/../../x.md")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect((await get("in.md\0.png")).status).toBe(400);
  });

  // @covers FR-01.66
  it("403 for an existing outside file the session never mentioned (and for a missing one alike)", async () => {
    session(say(1, "nothing relevant"));
    const r = await get(path.join(fx.out, "a.txt"));
    expect(r.status).toBe(403);
    expect((await j(r)).error).toBe("path_not_evidenced");
    expect((await get(path.join(fx.out, "nope.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("403 outside the project when the session JSONL does not exist yet", async () => {
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("serves an outside file the session wrote (Write tool_use)", async () => {
    session(assistant(1, { blocks: [toolUse("Write", { file_path: path.join(fx.out, "a.txt"), content: "x" })] }));
    const r = await get(path.join(fx.out, "a.txt"));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-session-file-scope")).toBe("session");
    expect(await r.text()).toBe("outside a");
  });

  // @covers FR-01.66
  it.each([
    ["assistant chat text", () => say(1, `I saved it to ${path.join(fx.out, "a.txt")}.`)],
    ["user message string", () => user(1, `please open ${path.join(fx.out, "a.txt")}`)],
    ["user text block", () => user(1, [{ type: "text", text: `see "${path.join(fx.out, "a.txt")}"` }])],
    ["Bash tool call", () => assistant(1, { blocks: [toolUse("Bash", { command: `cat ${path.join(fx.out, "a.txt")} | wc` })] })],
  ])("evidence from %s", async (_n, rec) => {
    session(rec());
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(200);
  });

  // @covers FR-01.66
  it("a path that only appears in a tool_result does not count", async () => {
    session(user(1, [{ type: "tool_result", tool_use_id: "t", content: `file at ${path.join(fx.out, "a.txt")}` }]));
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("evidence is whole-path: neither a sibling extension nor a parent dir qualifies", async () => {
    session(say(1, `wrote ${path.join(fx.out, "a.txt")} and the folder ${fx.out}`));
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(200);
    expect((await get(path.join(fx.out, "a.txt.bak"))).status).toBe(403);
    writeFileSync(path.join(fx.out, "x.md"), "m");
    expect((await get(path.join(fx.out, "x.md"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("sentence-final period still evidences; extension continuation does not", async () => {
    session(say(1, `Open ${path.join(fx.out, "a.txt")}. Not ${path.join(fx.out, "a.txt.bak")}x`));
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(200);
    expect((await get(path.join(fx.out, "a.txt.bak"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("credential locations are refused even when the session names them", async () => {
    const ssh = path.join(fx.out, ".ssh");
    mkdirSync(ssh);
    const cfg = path.join(fx.out, ".config", "gh");
    mkdirSync(cfg, { recursive: true });
    const targets = [path.join(ssh, "config.txt"), path.join(fx.out, "prod.env"), path.join(cfg, "hosts.yml"), path.join(fx.out, "mcp.json"), path.join(fx.out, ".claude.json")];
    for (const t of targets) writeFileSync(t, "SECRET");
    session(say(1, targets.join(" ")));
    for (const t of targets) {
      const r = await get(t);
      expect(r.status, t).toBe(403);
      expect((await j(r)).error, t).toBe("sensitive_location");
    }
    // extension-less names never reach the denylist: the MIME allowlist already answers 415
    writeFileSync(path.join(fx.out, "id_rsa"), "SECRET");
    session(say(1, path.join(fx.out, "id_rsa")));
    expect([403, 415]).toContain((await get(path.join(fx.out, "id_rsa"))).status);
  });

  // @covers FR-01.66
  it("home-style paths are refused: unevidenced .ssh is 403, tilde is not expanded", async () => {
    session(say(1, "hello"));
    expect((await get(path.join(fx.out, ".ssh", "id_ed25519.txt"))).status).toBe(403);
    expect((await get("~/.ssh/id_rsa")).status).toBe(404);
  });

  // @covers FR-01.66
  it("symlinked directory leaving the project is rejected (no fallback to session evidence)", async () => {
    try {
      symlinkSync(fx.out, path.join(fx.proj, "link"), "junction");
    } catch {
      return; // no symlink privilege on this host
    }
    session(say(1, path.join(fx.out, "a.txt")));
    const r = await get(path.join("link", "a.txt"));
    expect(r.status).toBe(400);
    expect((await j(r)).error).toBe("path_traversal");
  });

  // @covers FR-01.66
  it("an evidenced link whose real target the session never named is refused", async () => {
    const real = path.join(fx.out, "real");
    mkdirSync(real);
    writeFileSync(path.join(real, "t.txt"), "target");
    const linkParent = realpathSync(mkdtempSync(path.join(tmpdir(), "sf-lnk-")));
    const viaLink = path.join(linkParent, "lnk", "t.txt");
    try {
      symlinkSync(real, path.join(linkParent, "lnk"), "junction");
    } catch {
      rmSync(linkParent, { recursive: true, force: true });
      return; // no symlink privilege on this host
    }
    try {
      session(say(1, viaLink));
      const r = await get(viaLink);
      expect(r.status).toBe(403);
      expect((await j(r)).detail).toBe("symlink_target");
      session(say(1, `${viaLink} ${path.join(real, "t.txt")}`));
      expect((await get(viaLink)).status).toBe(200);
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
    }
  });

  // @covers FR-01.66
  it("an evidenced directory is never listed", async () => {
    const d = path.join(fx.out, "docs.md");
    mkdirSync(d);
    session(say(1, d));
    const r = await get(d);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  // @covers FR-01.66
  it("404 when evidenced but gone", async () => {
    const gone = path.join(fx.out, "gone.txt");
    session(say(1, gone));
    expect((await get(gone)).status).toBe(404);
  });

  // @covers FR-01.66
  it("binary and oversized files get the Smart Viewer's 415 / 413", async () => {
    writeFileSync(path.join(fx.proj, "nulbyte.txt"), Buffer.from([65, 0, 66]));
    writeFileSync(path.join(fx.proj, "blob.bin"), "x");
    writeFileSync(path.join(fx.proj, "big.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    expect((await get("nulbyte.txt")).status).toBe(415);
    expect((await get("blob.bin")).status).toBe(415);
    expect((await get("big.txt")).status).toBe(413);
  });

  // @covers FR-01.66
  it("never writes: the session transcript is untouched", async () => {
    session(say(1, path.join(fx.out, "a.txt")));
    const before = readFileSync(fx.l.sessionPath);
    await get(path.join(fx.out, "a.txt"));
    expect(readFileSync(fx.l.sessionPath).equals(before)).toBe(true);
  });

  // @covers FR-01.66
  it("UNC / device and foreign-platform absolute paths are invalid", async () => {
    session(say(1, "x"));
    const unc = BS + BS + "server" + BS + "share" + BS + "x.txt";
    const drive = "Z:" + BS + "nowhere" + BS + "x.txt";
    if (process.platform === "win32") {
      expect((await get(unc)).status).toBe(400);
      expect((await get(drive)).status).toBe(403);
    } else {
      expect((await get(drive)).status).toBe(400);
    }
  });

  // @covers FR-01.66
  it.runIf(process.platform === "win32")("Windows: a wrongly-cased project file name and a lowercase drive letter are served (200), not 400", async () => {
    expect((await get("IN.md")).status).toBe(200);
    expect((await get(path.join(fx.proj.slice(0, 1).toLowerCase() + fx.proj.slice(1), "in.md"))).status).toBe(200);
  });

  // @covers FR-01.66
  it.runIf(process.platform === "win32")("Windows evidence is case- and slash-insensitive", async () => {
    session(say(1, path.join(fx.out, "a.txt").toUpperCase().replaceAll(BS, "/")));
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(200);
  });

});
