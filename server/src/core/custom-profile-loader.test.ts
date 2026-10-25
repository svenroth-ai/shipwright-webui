/**
 * @covers FR-01.75
 * Custom-profile Preview loader: resolver is the authority, the file is
 * untrusted. Real temp dirs; the resolver (`validate`) is injected.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPreviewProfileResolver,
  projectCommandRefusal,
  userCommandRefusal,
  type ResolvedPreviewProfile,
} from "./custom-profile-loader.js";
import type { validateStackProfile } from "./stack-profiles.js";

let root: string;
let project: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cpl-"));
  project = join(root, "proj");
  home = join(root, "home");
  mkdirSync(join(project, ".shipwright", "profiles"), { recursive: true });
  mkdirSync(join(home, ".shipwright", "profiles"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const good = { dev_server: { command: "npm run dev", port: 5190, ready_path: "/", ready_timeout_seconds: 30 }, stack: { frontend: "vite" } };
const bundled: ResolvedPreviewProfile = { dev_server: { command: "npm run dev", port: 5173 }, stack: { frontend: "vite" } };

function projectFile(name: string, body: unknown = good): string {
  const f = join(project, ".shipwright", "profiles", `${name}.json`);
  writeFileSync(f, JSON.stringify(body));
  return f;
}
function userFile(name: string, body: unknown = good): string {
  const f = join(home, ".shipwright", "profiles", `${name}.json`);
  writeFileSync(f, JSON.stringify(body));
  return f;
}
const ok = (source: string, path: string, valid = true) =>
  async () => ({
    status: "ok",
    report: valid
      ? { valid: true, name: "x", source, path, schema_version: 1, shadows: [], warnings: [], searched: [] }
      : { valid: false, name: "x", error: "bad" },
  });
function make(validate: unknown, extra: Partial<Parameters<typeof createPreviewProfileResolver>[0]> = {}) {
  return createPreviewProfileResolver({
    bundled: () => bundled,
    validate: validate as typeof validateStackProfile,
    homeDir: home,
    ...extra,
  });
}

describe("custom profile resolution", () => {
  it("// @covers FR-01.75 loads a valid project profile through the resolver's path", async () => {
    const f = projectFile("mine");
    const r = await make(ok("project", f)).resolve("mine", project);
    expect(r.profile?.dev_server).toEqual({ command: "npm run dev", port: 5190, ready_path: "/", ready_timeout_seconds: 30 });
    expect(r.profile?.stack?.frontend).toBe("vite");
  });

  it("// @covers FR-01.75 copies only allowlisted fields (env / cwd never reach the spawner)", async () => {
    const f = projectFile("mine", { ...good, env: { NODE_OPTIONS: "--require x" }, cwd: "..", dev_server: { ...good.dev_server, env: { A: "1" }, cwd: ".." } });
    const r = await make(ok("project", f)).resolve("mine", project);
    expect(JSON.stringify(r.profile)).not.toMatch(/NODE_OPTIONS|"cwd"|"env"/);
  });

  it("// @covers FR-01.75 a user-source profile may use any bare program", async () => {
    const f = userFile("mine", { ...good, dev_server: { command: "make dev", port: 5191 } });
    expect((await make(ok("user", f)).resolve("mine", project)).profile?.dev_server?.command).toBe("make dev");
  });

  it("// @covers FR-01.75 bundled source uses the bundled loader unchanged", async () => {
    expect((await make(ok("bundled", join(root, "x.json"))).resolve("vite-hono", project)).profile).toBe(bundled);
  });

  it("// @covers FR-01.75 resolver unavailable falls back to the bundled loader", async () => {
    const v = async () => ({ status: "engine-unavailable", reason: "no uv", repairCommand: "x" });
    expect((await make(v).resolve("vite-hono", project)).profile).toBe(bundled);
  });

  it("// @covers FR-01.75 a profile the resolver calls invalid gets NO preview (never the bundled twin)", async () => {
    projectFile("vite-hono");
    const r = await make(ok("project", join(root, "x"), false)).resolve("vite-hono", project);
    expect(r.profile).toBeNull();
  });

  it("// @covers FR-01.75 no custom file of that name means no resolver process at all", async () => {
    const v = vi.fn(ok("project", "x"));
    const r = await make(v).resolve("vite-hono", project);
    expect(v).not.toHaveBeenCalled();
    expect(r.profile).toBe(bundled);
  });

  it("// @covers FR-01.75 an unknown source or a malformed answer yields nothing", async () => {
    expect((await make(ok("explicit", projectFile("a"))).resolve("a", project)).profile).toBeNull();
    const weird = async () => ({ status: "ok", report: { valid: true, name: "a" } });
    expect((await make(weird).resolve("a", project)).profile).toBeNull();
  });

  it("// @covers FR-01.75 a file outside the profiles folder is refused (containment)", async () => {
    const outside = join(root, "elsewhere.json");
    writeFileSync(outside, JSON.stringify(good));
    projectFile("mine");
    expect((await make(ok("project", outside)).resolve("mine", project)).profile).toBeNull();
    // the user root cannot be used to read a project-folder file either
    expect((await make(ok("user", projectFile("p"))).resolve("p", project)).profile).toBeNull();
  });

  it("// @covers FR-01.75 unreadable / non-JSON / unusable dev_server yield nothing", async () => {
    const bad = join(project, ".shipwright", "profiles", "bad.json");
    writeFileSync(bad, "{not json");
    expect((await make(ok("project", bad)).resolve("bad", project)).profile).toBeNull();
    const missing = join(project, ".shipwright", "profiles", "nope.json");
    projectFile("nope");
    rmSync(missing);
    // the file vanished between the fast-path probe and the read
    const gone = async () => {
      rmSync(missing, { force: true });
      return ok("project", missing)();
    };
    projectFile("nope");
    expect((await make(gone).resolve("nope", project)).profile).toBeNull();
    for (const dev_server of [{ command: "npm run dev", port: 80 }, { command: "npm run dev", port: "5190" }, { command: "", port: 5190 }, { port: 5190 }]) {
      const f = projectFile("p2", { stack: { frontend: "v" }, dev_server });
      expect((await make(ok("project", f)).resolve("p2", project)).profile).toBeNull();
    }
  });

  it("// @covers FR-01.75 a project profile may not run a repo program or inline code", async () => {
    for (const command of ["./evil.js", "node -e process.exit(1)", "python -c print(1)", "C:\\tmp\\x.exe", "powershell -enc AAA", "vite && echo hi", "node --eval=1", "node --print=1", "python -cprint(1)", "python -Ic 1", "node --import data:text/javascript,1", "deno eval 1", "deno run https://x.test/a.ts", "uv run python -c 1", "uv run --with x y.py", "python -m http.server", "vite --config /tmp/x.js", "next dev ../x", "vite --config=C:/x.js", "vite https://x.test/a", "npx cowsay", "npx https://x.test/p.tgz", "npm exec -c id", "pnpm dlx evil", "yarn dlx evil", "bun -e 1", "npm run ../x", "node ../../x.js", "node /abs/x.js", "node C:/x.js"]) {
      const f = projectFile("p3", { ...good, dev_server: { command, port: 5190 } });
      expect((await make(ok("project", f)).resolve("p3", project)).profile, command).toBeNull();
    }
  });

  it("// @covers FR-01.75 caches successes and failures, dedupes in-flight, and fresh bypasses", async () => {
    const f = projectFile("mine");
    const v = vi.fn(ok("project", f));
    const r = make(v);
    await Promise.all([r.resolve("mine", project), r.resolve("mine", project)]);
    await r.resolve("mine", project);
    expect(v).toHaveBeenCalledTimes(1);
    await r.resolve("mine", project, { fresh: true });
    expect(v).toHaveBeenCalledTimes(2);

    const inv = vi.fn(ok("project", f, false));
    const r2 = make(inv);
    await r2.resolve("mine", project);
    await r2.resolve("mine", project);
    expect(inv).toHaveBeenCalledTimes(1);
  });

  it("// @covers FR-01.75 an edited file or a TTL expiry re-resolves", async () => {
    const f = projectFile("mine");
    const v = vi.fn(ok("project", f));
    let t = 1_000;
    const r = make(v, { now: () => t });
    await r.resolve("mine", project);
    const future = new Date(Date.now() + 60_000);
    utimesSync(f, future, future);
    await r.resolve("mine", project);
    expect(v).toHaveBeenCalledTimes(2);
    t += 20_000;
    await r.resolve("mine", project);
    expect(v).toHaveBeenCalledTimes(3);
  });

  it("// @covers FR-01.75 never throws and caps concurrent resolver processes", async () => {
    const boom = async () => {
      throw new Error("kaboom");
    };
    projectFile("mine");
    const r = await make(boom).resolve("mine", project);
    expect(r.profile).toBeNull();

    let running = 0;
    let peak = 0;
    const slow = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((res) => setTimeout(res, 15));
      running--;
      return { status: "engine-unavailable", reason: "x", repairCommand: "x" };
    };
    const c = make(slow, { maxConcurrent: 2 });
    for (const n of ["a", "b", "c", "d", "e"]) projectFile(n);
    await Promise.all(["a", "b", "c", "d", "e"].map((n) => c.resolve(n, project)));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("// @covers FR-01.75 a stuck resolver degrades past a short queue instead of queueing without bound", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stuck = async () => {
      await gate;
      return { status: "engine-unavailable", reason: "x", repairCommand: "x" };
    };
    const names = Array.from({ length: 14 }, (_, i) => `n${i}`);
    for (const n of names) projectFile(n);
    const c = make(stuck, { maxConcurrent: 1 });
    const all = Promise.all(names.map((n) => c.resolve(n, project)));
    release();
    const out = await all;
    // 1 running + 8 waiting finish; the rest are refused fast (no Preview), never queued
    expect(out.filter((r) => r.reason === "profile resolver busy").length).toBe(5);
  });

  it("// @covers FR-01.75 an option-looking or malformed name never reaches the resolver", async () => {
    const v = vi.fn(ok("project", "x"));
    const r = await make(v).resolve("--output=/etc/x", project);
    expect(v).not.toHaveBeenCalled();
    expect(r.profile).toBe(bundled);
  });
});

describe("projectCommandRefusal", () => {
  it("// @covers FR-01.75 a user profile may not run a repo-relative program", () => {
    expect(userCommandRefusal("./scripts/dev")).not.toBeNull();
    expect(userCommandRefusal("../other/prog")).not.toBeNull();
    expect(userCommandRefusal("make dev")).toBeNull();
    expect(projectCommandRefusal("next dev -p 5190")).toBeNull();
    expect(userCommandRefusal(".\\dev.exe")).not.toBeNull();
    expect(userCommandRefusal(join(project, "bin", "x"), project)).not.toBeNull();
    expect(userCommandRefusal(process.platform === "win32" ? "C:\\tools\\dev.exe" : "/usr/bin/dev")).toBeNull();
  });

  it("// @covers FR-01.75 allows plain runners, refuses everything else", () => {
    expect(projectCommandRefusal("npm run dev")).toBeNull();
    expect(projectCommandRefusal("pnpm dev --port 5190")).toBeNull();
    expect(projectCommandRefusal("vite")).toBeNull();
    expect(projectCommandRefusal("npm run dev -- --port 5190")).toBeNull();
    expect(projectCommandRefusal("node scripts/dev.js")).toBeNull();
    expect(projectCommandRefusal("make dev")).not.toBeNull();
    expect(projectCommandRefusal("./vite")).not.toBeNull();
    expect(projectCommandRefusal("node server.js")).toBeNull();
    expect(projectCommandRefusal("node --eval 1")).not.toBeNull();
    expect(projectCommandRefusal("")).not.toBeNull();
  });
});
