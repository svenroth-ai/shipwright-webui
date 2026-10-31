/*
 * decideSessionFileAccess + readRegularFileCapped against the REAL filesystem:
 * symlink escape (shared realPathGuard), TOCTOU (single open + handle checks),
 * evidence-by-realpath, credential denial, Windows drive / UNC input.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { decideSessionFileAccess, type AccessDecision } from "./access.js";
import { evidenceKey } from "./evidence.js";
import { readRegularFileCapped } from "./safe-read.js";

let root = "";
let out = "";
const BS = String.fromCharCode(92);
const mk = (prefix: string) => realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
const evidence = (...named: string[]) => async (c: string[]) => ({
  found: new Set(c.map(evidenceKey).filter((k) => named.map(evidenceKey).includes(k))),
  incomplete: false,
});
const noEvidence = evidence();
const decide = (requested: string, findEvidence = noEvidence): Promise<AccessDecision> =>
  decideSessionFileAccess({ roots: [root], requested, findEvidence });
/** Symlink / junction creation can lack privilege on a Windows host: skip then, like the route tests do. */
function link(target: string, at: string, kind: "dir" | "file"): boolean {
  try {
    symlinkSync(target, at, kind === "dir" ? "junction" : "file");
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = mk("sf-acc-root-");
  out = mk("sf-acc-out-");
  writeFileSync(path.join(root, "in.md"), "inside");
  writeFileSync(path.join(out, "secret.txt"), "outside");
});
afterEach(() => {
  for (const d of [root, out]) rmSync(d, { recursive: true, force: true });
});

describe("decideSessionFileAccess - project scope uses the shared realPathGuard", () => {
  // @covers FR-01.66
  it("serves the realpath of an inside file and a sibling-prefix dir is NOT inside", async () => {
    const d = await decide("in.md");
    expect(d).toEqual({ ok: true, absolute: path.join(root, "in.md"), scope: "project" });
    const sibling = root + "-evil";
    mkdirSync(sibling);
    writeFileSync(path.join(sibling, "x.md"), "x");
    try {
      const r = await decide(path.join(sibling, "x.md"));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403); // outside the root -> needs evidence, never a project read
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  // @covers FR-01.66
  it("a link inside the project pointing outside is a symlink_escape, even when the session names the target", async () => {
    if (!link(out, path.join(root, "esc"), "dir")) return;
    const r = await decide(path.join("esc", "secret.txt"), evidence(path.join(out, "secret.txt")));
    expect(r).toMatchObject({ ok: false, status: 400, error: "path_traversal", detail: "symlink_escape" });
  });

  // @covers FR-01.66
  it("a directory link leaving the project is refused for relative and absolute input alike", async () => {
    if (!link(out, path.join(root, "dl"), "dir")) return;
    for (const req of [path.join("dl", "secret.txt"), path.join(root, "dl", "secret.txt")]) {
      expect(await decide(req)).toMatchObject({ ok: false, status: 400, detail: "symlink_escape" });
    }
  });

  // @covers FR-01.66
  it("a missing project file is 404; a dangling link or one leading out never reveals what exists beyond the project", async () => {
    expect(await decide("nope.md")).toMatchObject({ ok: false, status: 404 });
    // Junction to a directory that is then removed (works without symlink privilege).
    const gone = mk("sf-acc-gone-");
    if (link(gone, path.join(root, "dangling"), "dir")) {
      rmSync(gone, { recursive: true, force: true });
      expect(await decide(path.join("dangling", "x.txt"))).toMatchObject({ ok: false, status: 400, detail: "symlink_escape" });
    }
    // Through a link leaving the project: an existing and a non-existing target answer identically.
    if (link(out, path.join(root, "lk"), "dir")) {
      const a = await decide(path.join("lk", "secret.txt"));
      const b = await decide(path.join("lk", "does-not-exist.txt"));
      expect(a).toMatchObject({ ok: false, status: 400, detail: "symlink_escape" });
      expect(b).toEqual(a);
    }
  });

  // @covers FR-01.66
  it("project .git/config is refused (may carry a token); other .git files stay ordinary", async () => {
    mkdirSync(path.join(root, ".git"));
    writeFileSync(path.join(root, ".git", "config"), "[remote]");
    writeFileSync(path.join(root, ".git", "HEAD.md"), "ref");
    expect(await decide(path.join(".git", "config"))).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
    expect(await decide(path.join(".git", "HEAD.md"))).toMatchObject({ ok: true });
    mkdirSync(path.join(root, ".git", "modules", "sub"), { recursive: true });
    writeFileSync(path.join(root, ".git", "modules", "sub", "config"), "[remote]");
    expect(await decide(path.join(".git", "modules", "sub", "config"))).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
  });

  // @covers FR-01.66
  it.runIf(process.platform === "win32")("Windows: alternate spellings of a credential dir are judged by the canonical name", async () => {
    mkdirSync(path.join(root, ".ssh"));
    writeFileSync(path.join(root, ".ssh", "config.txt"), "h");
    for (const spelling of [".SSH", ".ssh.", ".ssh "]) {
      const r = await decide(path.join(spelling, "config.txt"));
      // Never served: either judged as the credential dir (403) or not resolvable at all (404/400).
      expect(r.ok, spelling).toBe(false);
      if (!r.ok) expect([403, 404, 400], spelling).toContain(r.status);
    }
    expect(await decide(path.join(".SSH", "config.txt"))).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
  });

  // @covers FR-01.66
  it.runIf(process.platform === "win32")("Windows: wrong filename case or lowercase drive resolves to the canonical file", async () => {
    const r = await decide(path.join(root.slice(0, 1).toLowerCase() + root.slice(1), "IN.md"));
    expect(r).toEqual({ ok: true, absolute: path.join(root, "in.md"), scope: "project" });
  });

  // @covers FR-01.66
  it("credential names inside the project are refused (.env, .ssh/...)", async () => {
    writeFileSync(path.join(root, ".env"), "K=V");
    mkdirSync(path.join(root, ".ssh"));
    writeFileSync(path.join(root, ".ssh", "config"), "h");
    expect(await decide(".env")).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
    expect(await decide(path.join(".ssh", "config"))).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
  });
});

describe("decideSessionFileAccess - session scope", () => {
  // @covers FR-01.66
  it("an unevidenced outside path is 403 whether or not it exists (no existence oracle)", async () => {
    const a = await decide(path.join(out, "secret.txt"));
    const b = await decide(path.join(out, "missing.txt"));
    expect(a).toMatchObject({ ok: false, status: 403, error: "path_not_evidenced" });
    expect(b).toEqual(a);
  });

  // @covers FR-01.66
  it("evidence is checked on the REAL path of a link: naming only the link is not enough", async () => {
    const linkParent = mk("sf-acc-lnk-");
    try {
      if (!link(out, path.join(linkParent, "l"), "dir")) return;
      const viaLink = path.join(linkParent, "l", "secret.txt");
      expect(await decide(viaLink, evidence(viaLink))).toMatchObject({ ok: false, status: 403, detail: "symlink_target" });
      const ok = await decide(viaLink, evidence(viaLink, path.join(out, "secret.txt")));
      expect(ok).toEqual({ ok: true, absolute: path.join(out, "secret.txt"), scope: "session" });
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
    }
  });

  // @covers FR-01.66
  it("evidenced credential locations are still refused (.ssh, .env, id_rsa), also via a link target", async () => {
    mkdirSync(path.join(out, ".ssh"));
    for (const f of [path.join(out, ".ssh", "config"), path.join(out, ".env"), path.join(out, "id_rsa")]) {
      writeFileSync(f, "k");
      expect(await decide(f, evidence(f))).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
    }
    const innocuousDir = mk("sf-acc-inn-");
    const innocuous = path.join(innocuousDir, "l", "config");
    try {
      if (!link(path.join(out, ".ssh"), path.join(innocuousDir, "l"), "dir")) return;
      const r = await decide(innocuous, evidence(innocuous, path.join(out, ".ssh", "config")));
      expect(r).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
    } finally {
      rmSync(innocuousDir, { recursive: true, force: true });
    }
  });

  // @covers FR-01.66
  it("cloud credential JSON names are refused when evidenced (service-account, client_secret, token.json)", async () => {
    for (const n of ["service-account-prod.json", "client_secret_123.json", "app-adminsdk-x1.json", "token.json", "ConsoleHost_history.txt"]) {
      const f = path.join(out, n);
      writeFileSync(f, "k");
      expect(await decide(f, evidence(f)), n).toMatchObject({ ok: false, status: 403, error: "sensitive_location" });
    }
  });

  // @covers FR-01.66
  it.runIf(process.platform === "win32")("Windows device names are refused before any filesystem call", async () => {
    for (const n of ["COM1", "con.txt", "NUL", "CONIN$"]) {
      expect(await decide(n), n).toMatchObject({ ok: false, status: 400, error: "invalid_path" });
    }
  });

  // @covers FR-01.66
  it("a home-style ~ path is never expanded", async () => {
    expect(await decide("~/.ssh/id_rsa")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("decideSessionFileAccess - input shapes", () => {
  // @covers FR-01.66
  it.runIf(process.platform === "win32")("Windows: UNC/device 400; other-drive absolute needs evidence; drive-letter case does not bypass the root", async () => {
    expect(await decide(BS + BS + "srv" + BS + "share" + BS + "x.txt")).toMatchObject({ ok: false, status: 400 });
    expect(await decide(BS + BS + "?" + BS + "C:" + BS + "x.txt")).toMatchObject({ ok: false, status: 400 });
    expect(await decide("Z:" + BS + "nowhere" + BS + "x.txt")).toMatchObject({ ok: false, status: 403 });
    const swapped = root.slice(0, 1).toLowerCase() + root.slice(1);
    expect(await decide(path.join(swapped, "in.md"))).toMatchObject({ ok: true, scope: "project" });
  });

  // @covers FR-01.66
  it.runIf(process.platform !== "win32")("POSIX: a drive-letter path is invalid, not a relative name", async () => {
    expect(await decide("C:" + BS + "Users" + BS + "x.txt")).toMatchObject({ ok: false, status: 400, error: "invalid_path" });
  });

  // @covers FR-01.66
  it("traversal, NUL, empty and over-long input are refused before any filesystem access", async () => {
    expect(await decide("../x")).toMatchObject({ ok: false, status: 400 });
    expect(await decide("a\0b")).toMatchObject({ ok: false, status: 400 });
    expect(await decide("")).toMatchObject({ ok: false, status: 400, error: "path_required" });
    expect(await decide("a".repeat(5000))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("readRegularFileCapped - single open, checks on the handle", () => {
  // @covers FR-01.66
  it("reads a regular file; refuses a directory, an oversized file and a missing file", async () => {
    expect(await readRegularFileCapped(path.join(root, "in.md"), 1024)).toMatchObject({ kind: "ok" });
    expect(await readRegularFileCapped(root, 1024)).toMatchObject({ kind: "not_a_file" });
    writeFileSync(path.join(root, "big.txt"), "x".repeat(100));
    expect(await readRegularFileCapped(path.join(root, "big.txt"), 10)).toMatchObject({ kind: "too_large", size: 100 });
    expect(await readRegularFileCapped(path.join(root, "none.txt"), 10)).toMatchObject({ kind: "not_found" });
  });

  // @covers FR-01.66
  it("a symlink planted at the final component after authorisation is not followed", async () => {
    const p = path.join(root, "swap.txt");
    if (!link(path.join(out, "secret.txt"), p, "file")) return;
    expect((await readRegularFileCapped(p, 1024)).kind).toBe("not_a_file");
  });

  // @covers FR-01.66
  it("an ancestor directory swapped for a link after authorisation is refused (path no longer resolves to itself)", async () => {
    mkdirSync(path.join(root, "d"));
    const p = path.join(root, "d", "f.txt");
    writeFileSync(p, "f");
    rmSync(path.join(root, "d"), { recursive: true });
    if (!link(out, path.join(root, "d"), "dir")) return;
    writeFileSync(path.join(out, "f.txt"), "evil");
    expect((await readRegularFileCapped(p, 1024)).kind).toBe("not_a_file");
  });
});
