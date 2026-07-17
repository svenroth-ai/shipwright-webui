/*
 * THE INBOX FENCE (A19, FR-01.63, AC1) — proven as code, not as a promise.
 *
 * When Claude stops mid-run to ask, the Inbox SHOWS the question and offers a
 * "jump to the terminal" navigation. The operator types the reply THEMSELVES in
 * the task's embedded terminal. The Inbox writes NOTHING into a live session.
 *
 * This guard is the thing that stops a future "helpful" agent from adding a text
 * box / clickable option / send-button that writes bytes into a pty. It is a
 * grep-style source scan over the Inbox component tree (DECIDED BY SVEN,
 * 2026-07-14: ship the safe half, and only the safe half — the write-path is
 * deferred to triage trg-475219a0).
 *
 * It does NOT rest on an architecture-fence argument (TerminalKeyBar.tsx already
 * sends keystrokes into a live Claude TUI over the same writer frame — the real
 * rule-1 fence is about SPAWNING, not keystrokes). It rests on the honest
 * decision that the Inbox — a cross-task list that cannot see the TUI state —
 * must not blind-write into any session. So: no write surface in this tree.
 *
 * Prove it bites: add a `<textarea>` / `<input>` / `contentEditable` to any
 * Inbox card, or import a terminal-write hook, or call `socket.send` — this
 * test goes RED.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const INBOX_DIR = path.dirname(fileURLToPath(import.meta.url));
// INBOX_DIR = client/src/pages/inbox → SRC = client/src
const SRC = path.resolve(INBOX_DIR, "..", "..");
// The Inbox surface is the inbox/ tree PLUS the page shell that hosts it.
const INBOX_PAGE = path.join(SRC, "pages", "InboxPage.tsx");

/** Strip block comments + whole-line `//` so our own prose (which names the
 *  forbidden tokens) never false-matches. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Production Inbox source only — exclude *.test.* + __fixtures__ (those name
 *  the forbidden tokens in assertions on purpose). */
function inboxSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "__fixtures__") continue;
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.test\.(ts|tsx)$/.test(entry)) continue;
      out.push(p);
    }
  };
  walk(path.join(SRC, "pages", "inbox"));
  out.push(INBOX_PAGE);
  return out;
}

const FILES = inboxSourceFiles();

function scan(re: RegExp): string[] {
  const hits: string[] = [];
  for (const f of FILES) {
    const text = strip(readFileSync(f, "utf8"));
    if (re.test(text)) hits.push(path.relative(SRC, f));
  }
  return hits;
}

describe("Inbox fence — no control writes into a pty (AC1)", () => {
  it("has NO text input surface (input / textarea / contentEditable)", () => {
    expect(scan(/<input[\s/>]/i), "Inbox rendered an <input>").toEqual([]);
    expect(scan(/<textarea[\s/>]/i), "Inbox rendered a <textarea>").toEqual([]);
    expect(
      scan(/contenteditable/i),
      "Inbox rendered a contentEditable surface",
    ).toEqual([]);
  });

  it("imports NO terminal-write / pty API", () => {
    expect(
      scan(/useTerminalSocket/),
      "Inbox imported the terminal socket hook",
    ).toEqual([]);
    expect(
      scan(/useAutoLaunch/),
      "Inbox imported the auto-launch (writes to pty) hook",
    ).toEqual([]);
    expect(
      scan(/TerminalKeyBar/),
      "Inbox imported the key-bar (writes keystrokes to pty)",
    ).toEqual([]);
    expect(
      scan(/useLaunchTask/),
      "Inbox still imports useLaunchTask — the clipboard CTA is dead weight, remove it",
    ).toEqual([]);
  });

  it("makes NO WebSocket send / pty.write call", () => {
    expect(scan(/\bsocket\.send\b/), "Inbox called socket.send").toEqual([]);
    expect(scan(/\.write\s*\(/), "Inbox called .write(...)").toEqual([]);
    expect(scan(/new WebSocket\b/), "Inbox opened a WebSocket").toEqual([]);
  });

  it("does NOT copy a command to the clipboard (the CTA navigates, not copies)", () => {
    expect(
      scan(/clipboard\.writeText/),
      "Inbox writes to the clipboard — the CTA must navigate, not copy",
    ).toEqual([]);
    expect(
      scan(/execCommand\(\s*['"]copy/),
      "Inbox uses execCommand('copy') — the CTA must navigate, not copy",
    ).toEqual([]);
  });
});
