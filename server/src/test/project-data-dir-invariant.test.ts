// @covers FR-01.03
/**
 * iterate-2026-10-30-central-data-default — `core/project-data-dir.ts` is the ONLY
 * place that may name the in-repo `.shipwright-webui` directory when joining a
 * path. A direct join elsewhere would bypass the standalone redirect and write
 * into a repo the user registered as off-limits.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
// file -> why it may keep the literal (legacy default / hint, never a central-mode write target)
const ALLOWED = new Map<string, string>([
  ["core/project-data-dir.ts", "the resolver itself"],
  ["core/project-actions-loader.ts", "legacy default when no dataDir is injected"],
  ["config.ts", "the GLOBAL ~/.shipwright-webui registry dir, not a repo path"],
  ["core/gitignore-cache.ts", "platform ignore defaults"],
  ["terminal/image-paste.ts", "regular-project pastes dir + gitignore hint"],
  ["routes/projects.ts", "regular-project .code-workspace bootstrap (only for `shared` projects)"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "vendor") continue;
      walk(abs, out);
    } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !/__tests__/.test(abs)) {
      out.push(abs);
    }
  }
  return out;
}

describe("project-data-dir invariant", () => {
  // @covers FR-01.03
  it("no route joins the in-repo .shipwright-webui dir outside the allow-list", () => {
    const offenders: string[] = [];
    for (const abs of walk(SRC)) {
      const rel = path.relative(SRC, abs).split(path.sep).join("/");
      if (ALLOWED.has(rel)) continue;
      // Whole-file scan with comments stripped, so a prettier-wrapped
      // a prettier-wrapped multi-line join(project.path, ".shipwright-webui")
      // cannot evade it.
      const code = fs
        .readFileSync(abs, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const lit = /["'`]\.shipwright-webui["'`/]/g;
      let hit = false;
      for (let m = lit.exec(code); m && !hit; m = lit.exec(code)) {
        hit = /join\(|resolve\(|\$\{/.test(code.slice(Math.max(0, m.index - 160), m.index));
      }
      if (hit) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  // @covers FR-01.03
  it("every allow-list entry still exists (rot guard)", () => {
    for (const rel of ALLOWED.keys()) expect(fs.existsSync(path.join(SRC, rel))).toBe(true);
  });
});
