/*
 * Drift-guard against cross-package type imports.
 *
 * Walks server/src/**\/*.ts and asserts no file imports from `client/`
 * via any relative-path depth. Catches the failure mode that ADR-080
 * paid down: server tsc pulling client .ts into compilation, breaking
 * `rootDir: ./src`. See ADR-080 + iterate-2026-05-09-tsc-baseline-fix.
 *
 * Companion to action-schema-sync.test.ts (the existing fs-content
 * parity-check between server/src/types/action-schema.ts and
 * client/src/types/action-schema.ts). This test catches the
 * import-direction regression; that test catches type-content drift.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// server/src/test/ → server/src
const SERVER_SRC = resolve(__dirname, "..");

// Match `import x from "../../../client/..."` AND
// `export type X from "../../client/..."` AND any number of `../`
// segments followed by an arbitrary number of intermediate path
// segments and finally a `client/` segment. `[^'"\/]+\/` requires
// at least one non-empty segment, so `from "../../foo/bar/client/x"`
// matches but `from "../../foo-client-lib/x"` does NOT (substring
// `client` inside a segment is excluded by the path-segment
// boundary). Spans the whole input — multi-line `import \n from`
// splits are caught.
const STATIC_IMPORT_RE = /from\s+['"](?:\.\.\/)+(?:[^'"\/]+\/)*client\//;
// Same shape, dynamic-import variant.
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"](?:\.\.\/)+(?:[^'"\/]+\/)*client\//;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip build output and node_modules (defensive — neither should
      // appear under server/src in practice).
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, acc);
    } else if (
      st.isFile() &&
      entry.endsWith(".ts") &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Strip /* block comments *\/ and // line comments while keeping a
 * line-number-preserving output. Block comments are replaced with
 * blanks so subsequent regex passes don't match documentation strings
 * (e.g. JSDoc on a mirrored type file mentioning the regex pattern).
 */
function stripCommentsPreserveLines(src: string): string {
  let out = "";
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let inString: '"' | "'" | "`" | null = null;
  let escape = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inBlock) {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 2;
        inBlock = false;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (inLine) {
      if (ch === "\n") {
        out += "\n";
        inLine = false;
      } else {
        out += " ";
      }
      i++;
      continue;
    }
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      inBlock = true;
      continue;
    }
    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      inLine = true;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch as '"' | "'" | "`";
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Convert a regex match index into a 1-based line number.
 */
function indexToLine(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

/**
 * Find every regex match in `stripped` and return its (line, offending
 * raw-source line content) tuple — line content comes from `raw` so the
 * reporter shows the original code, not the comment-stripped form.
 */
function findAll(
  pattern: RegExp,
  stripped: string,
  raw: string,
): { line: number; content: string }[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  const out: { line: number; content: string }[] = [];
  const rawLines = raw.split(/\r?\n/);
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const line = indexToLine(stripped, m.index);
    out.push({ line, content: (rawLines[line - 1] ?? "").trim() });
    // Guard against infinite loop on zero-length matches.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

describe("drift-guard: no cross-package imports from client/", () => {
  it("no server source imports from any relative path into client/", () => {
    const files = walk(SERVER_SRC);
    const offenders: { file: string; line: number; content: string }[] = [];

    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const stripped = stripCommentsPreserveLines(raw);
      // Scan whole content (not per-line) so multi-line imports
      // (`import { X } \n from "..../client/..."`) are caught.
      for (const hit of findAll(STATIC_IMPORT_RE, stripped, raw)) {
        offenders.push({ file, ...hit });
      }
      for (const hit of findAll(DYNAMIC_IMPORT_RE, stripped, raw)) {
        offenders.push({ file, ...hit });
      }
    }

    expect(
      offenders,
      offenders.length
        ? `Cross-package imports found (must use server/src/types/* mirror instead):\n${offenders
            .map((o) => `  ${o.file}:${o.line}\n    ${o.content}`)
            .join("\n")}`
        : "ok",
    ).toEqual([]);
  });

  it("flags a single-line cross-package import (sanity)", () => {
    const synthetic = [
      `// before`,
      `import type { Foo } from "../../../client/src/types/foo.js";`,
      `// after`,
    ].join("\n");
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(STATIC_IMPORT_RE.test(stripped)).toBe(true);
  });

  it("flags a multi-line cross-package import (newline between `import` and `from`)", () => {
    // Real TypeScript allows splitting a long import onto multiple lines.
    // The drift-guard must catch this — line-by-line scan would miss it.
    const synthetic = [
      `import {`,
      `  Foo,`,
      `  Bar,`,
      `}`,
      `  from "../../../client/src/types/foo.js";`,
    ].join("\n");
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(STATIC_IMPORT_RE.test(stripped)).toBe(true);
  });

  it("flags a deeper-path import where client/ is not immediately after ../", () => {
    // External-review (OpenAI) finding: `(?:\.\.\/)+client\/` was too narrow.
    const synthetic = `import x from "../../../shared/lib/client/foo.js";`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(STATIC_IMPORT_RE.test(stripped)).toBe(true);
  });

  it("does NOT flag a path with `client` as substring (foo-client-lib)", () => {
    // Path-segment boundary in regex — `client` must be its own segment.
    const synthetic = `import x from "../../../node_modules/foo-client-lib/dist/index.js";`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(STATIC_IMPORT_RE.test(stripped)).toBe(false);
  });

  it("flags a dynamic import() variant", () => {
    const synthetic = `const x = await import("../../../client/src/types/foo.js");`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(DYNAMIC_IMPORT_RE.test(stripped)).toBe(true);
  });

  it("skips JSDoc block-comment references to the pattern", () => {
    const synthetic = [
      `/**`,
      ` * Drift-guard prevents \`from "../../../client/..."\` imports.`,
      ` */`,
      `export const x = 1;`,
    ].join("\n");
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(STATIC_IMPORT_RE.test(stripped)).toBe(false);
  });

  it("skips line-comment references to the pattern", () => {
    const synthetic = `// from "../../../client/foo.js" — a doc reference\nexport const x = 1;`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(STATIC_IMPORT_RE.test(stripped)).toBe(false);
  });
});
