/*
 * AC2 (A14, FR-01.58) — the design-gate surface is a READ-ONLY observer.
 *
 * A test that asserts NO write path exists from the gate surface to
 * `run_loop_state.json`, `shipwright_run_config.json`, or `~/.claude/projects`.
 * The ONLY permitted write anywhere in the design-review server is the transient
 * `.shipwright/designs/design-feedback-round{N}.md` scratch file, produced by
 * `feedback-write.ts` (round derived from disk) — never the loop-state, the
 * run-config, or Claude's JSONL (DO-NOT #12).
 *
 * Source-scan (comments stripped, so prose that NAMES the forbidden files does
 * not false-positive) rather than behavioural: it proves the write path does not
 * EXIST in the CODE, which is stronger than "did not fire on one input".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "..");

/** Any filesystem MUTATION call. */
const WRITE_CALL =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|rmSync|rm|unlinkSync|unlink|createWriteStream|mkdirSync|mkdir|truncateSync|truncate|copyFileSync|copyFile|openSync)\s*\(/;

/** Strip block + line comments so documentation naming the forbidden files is
 *  not mistaken for a write target. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function code(name: string): string {
  return stripComments(readFileSync(path.join(DIR, name), "utf-8"));
}

describe("design-gate surface — read-only observer (AC2)", () => {
  it.each(["gate.ts", "serve.ts", "routes.ts"])(
    "%s performs NO filesystem writes (pure read-only handler)",
    (file) => {
      expect(WRITE_CALL.test(code(file))).toBe(false);
    },
  );

  it("no design-review source writes run_loop_state / run_config / Claude JSONL", () => {
    for (const file of ["gate.ts", "serve.ts", "routes.ts", "feedback-write.ts"]) {
      const src = code(file);
      expect(src).not.toContain("run_loop_state.json");
      expect(src).not.toContain("shipwright_run_config.json");
      expect(src).not.toContain(".claude");
    }
  });

  it("the only writer (feedback-write.ts) targets ONLY the designs round file", () => {
    const src = code("feedback-write.ts");
    // It writes — but into the designs dir, at the round file name, and nowhere
    // else. The round path is `.shipwright/designs/${roundFileName}`.
    expect(WRITE_CALL.test(src)).toBe(true);
    expect(src).toContain("designs");
    expect(src).toContain("roundFileName");
    expect(src).not.toContain("run_loop");
    expect(src).not.toContain("run_config");
  });
});
