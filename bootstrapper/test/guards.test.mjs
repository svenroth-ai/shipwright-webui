import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");

/** Every .mjs the bootstrapper AUTHORS (lib + bin) — not vendored/staged code. */
function sourceFiles() {
  const files = [];
  for (const dir of ["lib", "bin"]) {
    const abs = path.join(PKG, dir);
    for (const name of readdirSync(abs)) {
      if (name.endsWith(".mjs")) files.push(path.join(abs, name));
    }
  }
  return files;
}

/** Remove block + line comments so the guards scan executable code + strings only. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("AC4 — the bootstrapper's OWN code contains no kill path", () => {
  it("no process-termination primitive in lib/ or bin/", () => {
    const offenders = [];
    for (const f of sourceFiles()) {
      const code = stripComments(readFileSync(f, "utf-8"));
      if (/process\.kill|taskkill|\bSIGKILL\b|\bSIGTERM\b|\.kill\s*\(/.test(code)) {
        offenders.push(path.basename(f));
      }
    }
    // The swap's kill lives ONLY in the detached, vendored deploy-swap.mjs —
    // never in the bootstrapper itself. The incumbent on :3847 may host the
    // very terminal this command runs in (PR #249).
    expect(offenders).toEqual([]);
  });
});

describe("AC3 — the plugin list is DERIVED, never hardcoded", () => {
  it("no source file bakes in shipwright-* plugin names", () => {
    const NAME_RE = /shipwright-(run|project|design|plan|build|test|deploy|changelog|compliance|security|iterate|preview|adopt|grade)\b/g;
    const offenders = [];
    for (const f of sourceFiles()) {
      const code = stripComments(readFileSync(f, "utf-8"));
      const hits = code.match(NAME_RE);
      if (hits && hits.length > 0) offenders.push(`${path.basename(f)}: ${[...new Set(hits)].join(",")}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("version parity — package tracks the repo version", () => {
  it("bootstrapper version === server version", () => {
    const boot = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf-8")).version;
    const server = JSON.parse(readFileSync(path.join(PKG, "..", "server", "package.json"), "utf-8")).version;
    expect(boot).toBe(server);
  });

  it("scoped name is mandatory (bare `shipwright` is a stranger's package on npm)", () => {
    const name = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf-8")).name;
    expect(name).toBe("@svenroth-ai/shipwright");
  });
});
