import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createSessionFileRouter } from "./routes.js";
import { app, fx, get, installFixtures, say, session, user } from "./session-file.fixture.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { SESSION, jl } from "../../core/session-info/test-fixtures.js";

installFixtures();

describe("GET /api/external/tasks/:id/session-file (scoping)", () => {
  // @covers FR-01.66
  it("evidence is bound to THIS task's session: another transcript naming the path grants nothing", async () => {
    session(say(1, "nothing"));
    const other = path.join(path.dirname(fx.l.sessionPath), "99999999-2222-4333-8444-555555555555.jsonl");
    writeFileSync(other, jl(say(1, path.join(fx.out, "a.txt"))));
    expect((await get(path.join(fx.out, "a.txt"))).status).toBe(403);
  });

  // @covers FR-01.66
  it("the task cwd is not a trusted root when the task has a project", async () => {
    session(say(1, "nothing"));
    const r = await get(path.join(fx.out, "a.txt"), app(true, { projectId: "p", cwd: fx.out }));
    expect(r.status).toBe(403);
  });

  // @covers FR-01.66
  it("an evidenced absolute path is served even when no project root exists any more; relative input is not", async () => {
    session(say(1, path.join(fx.out, "a.txt")));
    const gone = app(true, { projectId: "nope", cwd: path.join(fx.out, "missing-dir") });
    expect((await get(path.join(fx.out, "a.txt"), gone)).status).toBe(200);
    expect((await get("in.md", gone)).status).toBe(400);
  });

  // @covers FR-01.66
  it("boundary probes: non-ASCII file name, CRLF-terminated and BOM-prefixed transcript", async () => {
    const uml = path.join(fx.out, "Bericht-üä.md");
    writeFileSync(uml, "umlaut");
    writeFileSync(fx.l.sessionPath, "﻿" + jl(say(0, "bom line is torn")).replace(/\n/g, "\r\n") + jl(say(1, `fertig: ${uml}`)).replace(/\n/g, "\r\n"));
    const r = await get(uml);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("umlaut");
  });

  // @covers FR-01.66
  it("a client-supplied task cwd is NEVER a root, not even for a task without a project", async () => {
    session(say(1, "nothing"));
    const unassigned = { projectId: "unassigned", cwd: fx.out };
    expect((await get("a.txt", app(true, unassigned))).status).toBe(400);
    expect((await get(path.join(fx.out, "a.txt"), app(true, unassigned))).status).toBe(403);
  });

  // @covers FR-01.66
  it("a broad project root cannot serve credential files as project files", async () => {
    const home = path.join(fx.out, "home");
    mkdirSync(path.join(home, ".aws"), { recursive: true });
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".aws", "config.json"), "{}");
    writeFileSync(path.join(home, ".claude.json"), "{}");
    writeFileSync(path.join(home, "notes.md"), "ok");
    const a = createSessionFileRouter({
      store: { get: () => ({ taskId: "t1", sessionUuid: SESSION, projectId: "p", cwd: home }) } as never,
      watcher: new SessionWatcher({ projectsDir: fx.l.projectsDir }),
      getProjectById: () => ({ id: "p", name: "p", path: home }),
      infoDeps: { noMemo: true },
    });
    expect((await get(".aws/config.json", a)).status).toBe(403);
    expect((await get(".claude.json", a)).status).toBe(403);
    expect((await get("notes.md", a)).status).toBe(200);
  });

  // @covers FR-01.66
  it("command output and injected meta records are not evidence", async () => {
    const t = path.join(fx.out, "a.txt");
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
  it("characters that make the match a suffix of something longer do not evidence it", async () => {
    const t = path.join(fx.out, "a.txt");
    const prefixes = process.platform === "win32" ? ["c+", "c@", "c%", "c#", "c$", "(x)"] : ["/srv/c+", "/srv/c@", "/srv/c%", "/srv/c#", "/srv/c$", "$(pwd)", "host:", "${HOME}"];
    for (const p of prefixes) {
      session(say(1, `${p}${t}`));
      expect((await get(t)).status, p).toBe(403);
    }
  });

  // @covers FR-01.66
  it("ordinary project files named like secrets elsewhere (auth.json, hosts.yml, mcp.json, gh/) are still served", async () => {
    mkdirSync(path.join(fx.proj, "src", "gh"), { recursive: true });
    for (const f of ["auth.json", "hosts.yml", "mcp.json", path.join("src", "gh", "client.ts")]) writeFileSync(path.join(fx.proj, f), "ok");
    for (const f of ["auth.json", "hosts.yml", "mcp.json", "src/gh/client.ts"]) expect((await get(f)).status, f).toBe(200);
    expect((await get(".")).status).not.toBe(200);
  });
});
