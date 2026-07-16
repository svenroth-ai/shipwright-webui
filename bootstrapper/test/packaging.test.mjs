import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");

/**
 * AC7 packaging is validated hermetically: we copy the REAL `files` whitelist
 * into a synthetic package tree (scripts stripped so `npm pack` runs no
 * prepack/build), seed both must-include and must-exclude paths, and assert
 * `npm pack --dry-run` honours the whitelist. No real build, no publish.
 */
function stagedTarballFiles() {
  const real = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf-8"));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "sw-pack-"));
  try {
    const w = (rel, body = "x") => {
      const abs = path.join(tmp, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };
    // package.json WITHOUT scripts (no prepack → no build during dry-run).
    writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ ...real, scripts: undefined }, null, 2),
    );
    // Must be INCLUDED (referenced by the whitelist):
    w("bin/shipwright.mjs");
    w("lib/util.mjs");
    w("server/dist/index.js");
    w("server/profiles/supabase.json");
    w("server/package.json", JSON.stringify({ name: "s", version: "0.23.0" }));
    w("client/dist/index.html");
    w("scripts/deploy-swap.mjs");
    w("LICENSE", "MIT");
    w("README.md", "# pkg");
    // Must be EXCLUDED (not in the whitelist):
    w("Spec/design/secret.md");
    w(".shipwright/planning/x.md");
    w("test/server.test.mjs");
    w("src/should-not-ship.ts");
    w("scripts/build-package.mjs"); // build tool, not whitelisted

    // shell:true so Windows resolves npm.cmd via cmd.exe (spawning a .cmd with
    // shell:false is blocked on modern Node — CVE-2024-27980). Args are fixed
    // literals, so shelling out carries no injection surface.
    const r = spawnSync("npm pack --dry-run --json", { cwd: tmp, encoding: "utf-8", shell: true });
    if (r.status !== 0) {
      throw new Error(`npm pack failed (status=${r.status}): ${r.error ?? ""} ${r.stderr ?? ""} ${r.stdout ?? ""}`);
    }
    // npm may prepend non-JSON notices; slice from the first bracket.
    const jsonStart = r.stdout.indexOf("[");
    const parsed = JSON.parse(jsonStart >= 0 ? r.stdout.slice(jsonStart) : r.stdout);
    return (parsed[0]?.files ?? []).map((f) => f.path.replace(/\\/g, "/"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("AC7 — the `files` whitelist ships the build, excludes sources/specs/tests", () => {
  const files = stagedTarballFiles();

  it("includes the built server + built client + profiles + bin + swap script", () => {
    expect(files).toContain("server/dist/index.js");
    expect(files).toContain("client/dist/index.html");
    expect(files).toContain("server/profiles/supabase.json");
    expect(files).toContain("server/package.json"); // runtime app.version source

    expect(files).toContain("bin/shipwright.mjs");
    expect(files).toContain("scripts/deploy-swap.mjs");
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE");
  });

  it("excludes Spec/, .shipwright/, tests, and TypeScript sources", () => {
    expect(files.some((f) => f.startsWith("Spec/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".shipwright/"))).toBe(false);
    expect(files.some((f) => /\.test\.[mc]?[jt]s$/.test(f))).toBe(false);
    expect(files.some((f) => f.startsWith("src/"))).toBe(false);
    expect(files).not.toContain("scripts/build-package.mjs");
  });

  it("references no npm token / publish secret anywhere in package.json", () => {
    const raw = readFileSync(path.join(PKG, "package.json"), "utf-8");
    expect(raw).not.toMatch(/NPM_TOKEN|prepublishOnly|_authToken/);
  });
});
