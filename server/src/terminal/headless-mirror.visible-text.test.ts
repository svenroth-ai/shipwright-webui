/*
 * headless-mirror.visible-text.test.ts
 * iterate-2026-05-18-inbox-terminal-prompts
 *
 * Validates HeadlessMirror.getVisibleText() against a REAL @xterm/headless
 * mirror (external review openai-4: don't validate extraction only against
 * captured raw byte streams — exercise the actual mirror API). Also
 * exercises the full chain getVisibleText() → extractTerminalPrompt().
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

import { HeadlessMirror } from "./headless-mirror.js";
import { extractTerminalPrompt } from "../core/terminal-prompt-detect.js";

const here = dirname(fileURLToPath(import.meta.url));
const pickerText = readFileSync(
  join(here, "fixtures/askuserquestion-picker.txt"),
  "utf8",
);

/** xterm needs CRLF to break lines cleanly (bare LF staircases). */
function crlf(s: string): string {
  return s.replace(/\n/g, "\r\n");
}

describe("HeadlessMirror.getVisibleText", () => {
  it("returns decoded viewport text after writing a picker", async () => {
    const mirror = new HeadlessMirror({ taskId: "t1", cols: 120, rows: 30 });
    try {
      await mirror.write(crlf(pickerText));
      const visible = mirror.getVisibleText();
      expect(visible).toContain("Von wo aus soll man einen Task");
      expect(visible).toContain("Enter to select");
      // No ANSI escape bytes survive — translateToString decodes cells.
      expect(visible).not.toMatch(/\[/);
    } finally {
      mirror.dispose();
    }
  });

  it("feeds extractTerminalPrompt end-to-end (real mirror → detector)", async () => {
    const mirror = new HeadlessMirror({ taskId: "t2", cols: 120, rows: 30 });
    try {
      await mirror.write(crlf(pickerText));
      const prompt = extractTerminalPrompt(mirror.getVisibleText());
      expect(prompt).not.toBeNull();
      expect(prompt).toContain("Board-Card UND Detail-Header");
    } finally {
      mirror.dispose();
    }
  });

  it("ordinary shell output yields no picker", async () => {
    const mirror = new HeadlessMirror({ taskId: "t3", cols: 120, rows: 30 });
    try {
      await mirror.write(
        crlf("PS C:\\repo> npm run build\n> tsc -p .\nBuild succeeded.\nPS C:\\repo> "),
      );
      expect(extractTerminalPrompt(mirror.getVisibleText())).toBeNull();
    } finally {
      mirror.dispose();
    }
  });

  it("returns an empty string on a disposed mirror", async () => {
    const mirror = new HeadlessMirror({ taskId: "t4", cols: 80, rows: 24 });
    await mirror.write(crlf("hello\n"));
    mirror.dispose();
    expect(mirror.getVisibleText()).toBe("");
  });
});
