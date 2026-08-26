/*
 * Shared source-scan helpers for the python-spawn drift guards
 * (no-direct-python-spawn.test.ts + no-indirect-python-spawn.test.ts,
 * iterate-2026-08-26-grade-uv-run). Split out once the guard grew past one
 * check per file — mirrors the walk + comment-strip convention of
 * no-cross-package-imports.test.ts, but factored so the two guard files don't
 * duplicate it between themselves.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// server/src/test/ → server/src
export const SERVER_SRC = resolve(__dirname, "..");

export function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
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

/** `file` relative to server/src, forward-slash normalized — full-path
 *  match, never a bare basename (a bare basename would let a same-named file
 *  dropped anywhere else in the tree inherit an allowance it was never
 *  granted). */
export function relToServerSrc(file: string): string {
  return relative(SERVER_SRC, file).split("\\").join("/");
}

export function readSource(file: string): string {
  return readFileSync(file, "utf-8");
}

/** Strip block/line comments while preserving line breaks and string
 *  contents, so a doc-comment mentioning these patterns never false-positives
 *  while a real `"python3"` spawn literal still matches. */
export function stripCommentsPreserveLines(src: string): string {
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

export function indexToLine(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}
