import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSessionFileRouter } from "./routes.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { SESSION, assistant, jl, makeLayout, toolUse, ts, type Layout } from "../../core/session-info/test-fixtures.js";

const BS = "\x5c";
let l: Layout;
let proj: string;
let out: string;

beforeEach(() => {
  l = makeLayout();
  proj = realpathSync(mkdtempSync(path.join(tmpdir(), "sf-proj-")));
  out = realpathSync(mkdtempSync(path.join(tmpdir(), "sf-out-")));
  writeFileSync(path.join(proj, "in.md"), "# inside");
  writeFileSync(path.join(out, "a.txt"), "outside a");
  writeFileSync(path.join(out, "a.txt.bak"), "outside bak");
});
afterEach(() => {
  for (const d of [l.projectsDir, proj, out]) rmSync(d, { recursive: true, force: true });
});

const user = (n: number, content: unknown) => ({ type: "user", timestamp: ts(n), message: { role: "user", content } });
const say = (n: number, text: string) => assistant(n, { blocks: [{ type: "text", text }] });
const session = (...recs: unknown[]) => writeFileSync(l.sessionPath, jl(...recs));

function app(withTask = true, task: { projectId: string; cwd: string } = { projectId: "p", cwd: proj }) {
  const store = {
    get: (id: string) => (withTask && id === "t1" ? { taskId: "t1", sessionUuid: SESSION, ...task } : undefined),
  } as never;
  return createSessionFileRouter({
    store,
    watcher: new SessionWatcher({ projectsDir: l.projectsDir }),
    getProjectById: (id) => (id === "p" ? { id: "p", name: "p", path: proj } : undefined),
    infoDeps: { sessionsDir: "Z:" + BS + "none", noMemo: true },
  });
}
const get = (p: string, a = app()) => a.request(`/api/external/tasks/t1/session-file?path=${encodeURIComponent(p)}`);
const j = async (r: Response) => (await r.json()) as { error?: string; detail?: string };

describe("GET /api/external/tasks/:id/session-file", () => {
  // @covers FR-01.66
  it("404 for an unknown task", async () => {
    expect((await app(false).request("/api/external/tasks/t1/session-file?path=x")).status).toBe(404);
  });

  // @covers FR-01.66
  it("serves project files by relative and absolute path without any session", async () => {
    for (const p of ["in.md", path.join(proj, "in.md")]) {
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
    const r = await get(path.join(out, "a.txt"));
    expect(r.status).toBe(403);
    expect((await j(r)).error).toBe("path_not_evidenced");
    expect((await get(path.join(out, "nope.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("403 outside the project when the session JSONL does not exist yet", async () => {
    expect((await get(path.join(out, "a.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("serves an outside file the session wrote (Write tool_use)", async () => {
    session(assistant(1, { blocks: [toolUse("Write", { file_path: path.join(out, "a.txt"), content: "x" })] }));
    const r = await get(path.join(out, "a.txt"));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-session-file-scope")).toBe("session");
    expect(await r.text()).toBe("outside a");
  });

  // @covers FR-01.66
  it.each([
    ["assistant chat text", () => say(1, `I saved it to ${path.join(out, "a.txt")}.`)],
    ["user message string", () => user(1, `please open ${path.join(out, "a.txt")}`)],
    ["user text block", () => user(1, [{ type: "text", text: `see "${path.join(out, "a.txt")}"` }])],
    ["Bash tool call", () => assistant(1, { blocks: [toolUse("Bash", { command: `cat ${path.join(out, "a.txt")} | wc` })] })],
  ])("evidence from %s", async (_n, rec) => {
    session(rec());
    expect((await get(path.join(out, "a.txt"))).status).toBe(200);
  });

  // @covers FR-01.66
  it("a path that only appears in a tool_result does not count", async () => {
    session(user(1, [{ type: "tool_result", tool_use_id: "t", content: `file at ${path.join(out, "a.txt")}` }]));
    expect((await get(path.join(out, "a.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("evidence is whole-path: neither a sibling extension nor a parent dir qualifies", async () => {
    session(say(1, `wrote ${path.join(out, "a.txt")} and the folder ${out}`));
    expect((await get(path.join(out, "a.txt"))).status).toBe(200);
    expect((await get(path.join(out, "a.txt.bak"))).status).toBe(403);
    writeFileSync(path.join(out, "x.md"), "m");
    expect((await get(path.join(out, "x.md"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("sentence-final period still evidences; extension continuation does not", async () => {
    session(say(1, `Open ${path.join(out, "a.txt")}. Not ${path.join(out, "a.txt.bak")}x`));
    expect((await get(path.join(out, "a.txt"))).status).toBe(200);
    expect((await get(path.join(out, "a.txt.bak"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("credential locations are refused even when the session names them", async () => {
    const ssh = path.join(out, ".ssh");
    mkdirSync(ssh);
    const targets = [path.join(ssh, "config.txt"), path.join(out, ".env"), path.join(out, "prod.env"), path.join(out, "id_rsa")];
    for (const t of targets) writeFileSync(t, "SECRET");
    session(say(1, targets.join(" ")));
    for (const t of targets) {
      const r = await get(t);
      expect(r.status, t).toBeGreaterThanOrEqual(403);
      expect(await r.text()).not.toContain("SECRET");
    }
  });

  // @covers FR-01.66
  it("home-style paths are refused: unevidenced .ssh is 403, tilde is not expanded", async () => {
    session(say(1, "hello"));
    expect((await get(path.join(out, ".ssh", "id_ed25519"))).status).toBe(403);
    expect((await get("~/.ssh/id_rsa")).status).toBe(404);
  });

  // @covers FR-01.66
  it("symlinked directory leaving the project is rejected (no fallback to session evidence)", async () => {
    try {
      symlinkSync(out, path.join(proj, "link"), "junction");
    } catch {
      return; // no symlink privilege on this host
    }
    session(say(1, path.join(out, "a.txt")));
    const r = await get(path.join("link", "a.txt"));
    expect(r.status).toBe(400);
    expect((await j(r)).error).toBe("path_traversal");
  });

  // @covers FR-01.66
  it("an evidenced link whose real target the session never named is refused", async () => {
    const real = path.join(out, "real");
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
    const d = path.join(out, "docs.md");
    mkdirSync(d);
    session(say(1, d));
    const r = await get(d);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  // @covers FR-01.66
  it("404 when evidenced but gone", async () => {
    const gone = path.join(out, "gone.txt");
    session(say(1, gone));
    expect((await get(gone)).status).toBe(404);
  });

  // @covers FR-01.66
  it("binary and oversized files get the Smart Viewer's 415 / 413", async () => {
    writeFileSync(path.join(proj, "nul.txt"), Buffer.from([65, 0, 66]));
    writeFileSync(path.join(proj, "blob.bin"), "x");
    writeFileSync(path.join(proj, "big.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    expect((await get("nul.txt")).status).toBe(415);
    expect((await get("blob.bin")).status).toBe(415);
    expect((await get("big.txt")).status).toBe(413);
  });

  // @covers FR-01.66
  it("never writes: the session transcript is untouched", async () => {
    session(say(1, path.join(out, "a.txt")));
    const before = readFileSync(l.sessionPath);
    await get(path.join(out, "a.txt"));
    expect(readFileSync(l.sessionPath).equals(before)).toBe(true);
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
  it.runIf(process.platform === "win32")("Windows evidence is case- and slash-insensitive", async () => {
    session(say(1, path.join(out, "a.txt").toUpperCase().replaceAll(BS, "/")));
    expect((await get(path.join(out, "a.txt"))).status).toBe(200);
  });

  // @covers FR-01.66
  it("evidence is bound to THIS task's session: another transcript naming the path grants nothing", async () => {
    session(say(1, "nothing"));
    const other = path.join(path.dirname(l.sessionPath), "99999999-2222-4333-8444-555555555555.jsonl");
    writeFileSync(other, jl(say(1, path.join(out, "a.txt"))));
    expect((await get(path.join(out, "a.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("the task cwd is not a trusted root when the task has a project", async () => {
    session(say(1, "nothing"));
    const r = await get(path.join(out, "a.txt"), app(true, { projectId: "p", cwd: out }));
    expect(r.status).toBe(403);
  });

  // @covers FR-01.66
  it("an evidenced absolute path is served even when no project root exists any more; relative input is not", async () => {
    session(say(1, path.join(out, "a.txt")));
    const gone = app(true, { projectId: "nope", cwd: path.join(out, "missing-dir") });
    expect((await get(path.join(out, "a.txt"), gone)).status).toBe(200);
    expect((await get("in.md", gone)).status).toBe(400);
  });

  // @covers FR-01.66
  it("boundary probes: non-ASCII file name, CRLF-terminated and BOM-prefixed transcript", async () => {
    const uml = path.join(out, "Bericht-üä.md");
    writeFileSync(uml, "umlaut");
    writeFileSync(l.sessionPath, "﻿" + jl(say(0, "bom line is torn")).replace(/\n/g, "\r\n") + jl(say(1, `fertig: ${uml}`)).replace(/\n/g, "\r\n"));
    const r = await get(uml);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("umlaut");
  });

  // @covers FR-01.66
  it("a client-supplied task cwd is NEVER a root, not even for a task without a project", async () => {
    session(say(1, "nothing"));
    const unassigned = { projectId: "unassigned", cwd: out };
    expect((await get("a.txt", app(true, unassigned))).status).toBe(400);
    expect((await get(path.join(out, "a.txt"), app(true, unassigned))).status).toBe(403);
  });

  // @covers FR-01.66
  it("a broad project root cannot serve credential files as project files", async () => {
    const home = path.join(out, "home");
    mkdirSync(path.join(home, ".docker"), { recursive: true });
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".docker", "config.json"), "{}");
    writeFileSync(path.join(home, ".claude", "mcp.json"), "{}");
    writeFileSync(path.join(home, "notes.md"), "ok");
    const a = createSessionFileRouter({
      store: { get: () => ({ taskId: "t1", sessionUuid: SESSION, projectId: "p", cwd: home }) } as never,
      watcher: new SessionWatcher({ projectsDir: l.projectsDir }),
      getProjectById: () => ({ id: "p", name: "p", path: home }),
      infoDeps: { noMemo: true },
    });
    expect((await get(".docker/config.json", a)).status).toBe(403);
    expect((await get(".claude/mcp.json", a)).status).toBe(403);
    expect((await get("notes.md", a)).status).toBe(200);
  });

  // @covers FR-01.66
  it("command output and injected meta records are not evidence", async () => {
    const t = path.join(out, "a.txt");
    session(user(1, `<bash-stdout>${t}</bash-stdout>`));
    expect((await get(t)).status).toBe(403);
    session({ ...user(1, `see ${t}`), isMeta: true });
    expect((await get(t)).status).toBe(403);
    session({ ...user(1, `summary ${t}`), isCompactSummary: true });
    expect((await get(t)).status).toBe(403);
    session(user(1, `<bash-stdout>x</bash-stdout> but I mean ${t}`));
    expect((await get(t)).status).toBe(200);
  });

  // @covers FR-01.66
  it("a '+' or '@' directly before the path does not evidence the shorter suffix path", async () => {
    const t = path.join(out, "a.txt");
    session(say(1, `/srv/c+${t}`));
    expect((await get(t)).status).toBe(403);
  });
});
