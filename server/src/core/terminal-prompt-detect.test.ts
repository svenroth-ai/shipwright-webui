/*
 * terminal-prompt-detect.test.ts — extractTerminalPrompt unit tests.
 *
 * Covers AC5 (spec iterate-2026-05-18-inbox-terminal-prompts): the
 * detector returns the picker block when the AskUserQuestion footer
 * signature is the bottom-most content, and null otherwise.
 *
 * External-review hardening folded in:
 *   - openai-10 (security): normal shell output + answered/collapsed
 *     pickers must NOT leak into a non-null result.
 *   - gemini-2 (zombie prompt): a footer that is no longer the bottom-most
 *     line (shell prompt printed below it) is stale → null.
 *   - openai-5: tolerant footer matching (separator-agnostic).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

import { extractTerminalPrompt } from "./terminal-prompt-detect.js";
import { MAX_QUESTION_TEXT_LEN } from "./inbox-derive.js";

const here = dirname(fileURLToPath(import.meta.url));
const pickerFixture = readFileSync(
  join(here, "../terminal/fixtures/askuserquestion-picker.txt"),
  "utf8",
);

describe("extractTerminalPrompt", () => {
  it("returns the picker block for a live AskUserQuestion picker", () => {
    const out = extractTerminalPrompt(pickerFixture);
    expect(out).not.toBeNull();
    // The question and the option labels are inside the captured block.
    expect(out).toContain("Von wo aus soll man einen Task");
    expect(out).toContain("Board-Card UND Detail-Header");
    // The footer is included (it identifies the block as a live picker).
    expect(out).toContain("Enter to select");
  });

  it("does NOT capture unrelated content above the picker", () => {
    const out = extractTerminalPrompt(pickerFixture) ?? "";
    // The interview preamble sits above a horizontal rule — it must NOT
    // bleed into the prompt block (openai-10: no scrollback leakage).
    expect(out).not.toContain("Read 1 file, ran 1 shell command");
    expect(out).not.toContain("Interview (medium FEATURE)");
  });

  it("returns null for ordinary shell output (no footer signature)", () => {
    const shell = [
      "PS C:\\01_Development\\shipwright-webui> npm run build",
      "> tsc -p .",
      "Build succeeded.",
      "PS C:\\01_Development\\shipwright-webui>",
    ].join("\n");
    expect(extractTerminalPrompt(shell)).toBeNull();
  });

  it("returns null when the footer is no longer the bottom-most line (stale picker)", () => {
    // gemini-2: Claude exited while the picker was on screen; the shell
    // printed a fresh prompt BELOW the footer. The footer text lingers in
    // the buffer but the picker is dead — must not surface.
    const stale =
      pickerFixture + "\nPS C:\\01_Development\\shipwright-webui>\n";
    expect(extractTerminalPrompt(stale)).toBeNull();
  });

  it("returns null for an empty / whitespace-only viewport", () => {
    expect(extractTerminalPrompt("")).toBeNull();
    expect(extractTerminalPrompt("   \n  \n")).toBeNull();
  });

  it("tolerates a different footer separator (openai-5)", () => {
    const altSep = [
      "Pick one:",
      "  1. Yes",
      "  2. No",
      "Enter to select | Tab/Arrow keys to navigate | Esc to cancel",
    ].join("\n");
    const out = extractTerminalPrompt(altSep);
    expect(out).not.toBeNull();
    expect(out).toContain("Pick one:");
  });

  it("caps the captured block at MAX_QUESTION_TEXT_LEN", () => {
    // Long lines so the 24-line block cap still exceeds 2000 chars.
    const huge =
      Array.from({ length: 400 }, (_, i) => `option line ${i} ${"x".repeat(150)}`).join(
        "\n",
      ) + "\nEnter to select · Esc to cancel";
    const out = extractTerminalPrompt(huge);
    expect(out).not.toBeNull();
    expect((out ?? "").length).toBeLessThanOrEqual(MAX_QUESTION_TEXT_LEN);
  });
});
