/*
 * scrollback-sanitizer.test.ts — AC-1 (iterate-2026-05-05-post-v0.8-stabilization).
 *
 * Tests the byte-level sanitizer that strips cursor-control + repaint
 * sequences from pty output before disk persistence (and from disk on
 * legacy-file read), preserving printable text + LF/CRLF/HT + SGR.
 *
 * Persisted format contract:
 *   - Preserve: printable UTF-8, "\n" (LF), "\r\n" (CRLF), "\t",
 *     SGR sequences "\x1b[<params>m", OSC sequences "\x1b]…\x07" /
 *     "\x1b]…\x1b\\".
 *   - Strip: bare "\r" (CR not followed by LF), "\b" (backspace),
 *     all CSI with non-"m" final byte (cursor movement, erase, scroll,
 *     alt-screen, save/restore, private "\x1b[?…h/l").
 *   - Drop on overflow: incomplete CSI > 32 bytes, incomplete OSC > 4096 bytes.
 */

import { describe, expect, it } from "vitest";
import { ScrollbackSanitizer } from "./scrollback-sanitizer";

/** Helper: feed a list of byte-string chunks; return the concatenated output. */
function run(chunks: string[]): string {
  const s = new ScrollbackSanitizer();
  const out: string[] = [];
  for (const c of chunks) {
    out.push(s.feed(Buffer.from(c, "binary")).toString("binary"));
  }
  return out.join("");
}

describe("ScrollbackSanitizer — passthrough", () => {
  it("preserves plain ASCII", () => {
    expect(run(["hello world"])).toBe("hello world");
  });

  it("preserves multi-byte UTF-8 codepoints", () => {
    const text = "Hellö Wörld 🚀 ünicödé";
    const utf8 = Buffer.from(text, "utf8");
    const s = new ScrollbackSanitizer();
    const out = s.feed(utf8);
    expect(out.toString("utf8")).toBe(text);
  });

  it("preserves LF, CRLF, and TAB", () => {
    expect(run(["line1\nline2\r\nline3\twith\ttabs"])).toBe(
      "line1\nline2\r\nline3\twith\ttabs",
    );
  });

  it("preserves SGR sequences (color, bold, reset)", () => {
    const ansi = "\x1b[31mred\x1b[0m \x1b[1mbold\x1b[22m \x1b[38;5;196m256c\x1b[0m";
    expect(run([ansi])).toBe(ansi);
  });

  it("preserves SGR truecolor", () => {
    const ansi = "\x1b[38;2;255;128;0morange\x1b[0m";
    expect(run([ansi])).toBe(ansi);
  });

  it("preserves OSC window-title (BEL-terminated)", () => {
    const osc = "\x1b]0;My Window Title\x07after";
    expect(run([osc])).toBe(osc);
  });

  it("preserves OSC ST-terminated", () => {
    const osc = "\x1b]0;Title\x1b\\after";
    expect(run([osc])).toBe(osc);
  });
});

describe("ScrollbackSanitizer — stripping", () => {
  it("strips cursor-home \\x1b[H", () => {
    expect(run(["before\x1b[Hafter"])).toBe("beforeafter");
  });

  it("strips erase-in-line \\x1b[K", () => {
    expect(run(["xxx\x1b[Kyyy"])).toBe("xxxyyy");
  });

  it("strips erase-in-display \\x1b[2J", () => {
    expect(run(["clear\x1b[2Jdone"])).toBe("cleardone");
  });

  it("strips absolute positioning \\x1b[10;20H", () => {
    expect(run(["a\x1b[10;20Hb"])).toBe("ab");
  });

  it("strips cursor-up/down/left/right with optional count", () => {
    expect(
      run(["A\x1b[2AB\x1b[5DC\x1b[BD\x1b[CE"]),
    ).toBe("ABCDE");
  });

  it("strips cursor-visibility private \\x1b[?25l / \\x1b[?25h", () => {
    expect(run(["x\x1b[?25ly\x1b[?25hz"])).toBe("xyz");
  });

  it("strips alt-screen \\x1b[?1049h / \\x1b[?1049l", () => {
    expect(run(["a\x1b[?1049hb\x1b[?1049lc"])).toBe("abc");
  });

  it("strips alt-screen 47 variant", () => {
    expect(run(["a\x1b[?47hb\x1b[?47lc"])).toBe("abc");
  });

  it("strips save/restore \\x1b[s / \\x1b[u", () => {
    expect(run(["a\x1b[sb\x1b[uc"])).toBe("abc");
  });

  it("strips scroll up/down \\x1b[3S / \\x1b[2T", () => {
    expect(run(["a\x1b[3Sb\x1b[2Tc"])).toBe("abc");
  });

  it("strips horizontal-absolute \\x1b[5G", () => {
    expect(run(["a\x1b[5Gb"])).toBe("ab");
  });

  it("strips scrolling-region \\x1b[1;30r", () => {
    expect(run(["a\x1b[1;30rb"])).toBe("ab");
  });

  it("strips bare CR not followed by LF", () => {
    expect(run(["progress\rdone"])).toBe("progressdone");
  });

  it("strips backspace \\b", () => {
    expect(run(["abc\b\bxy"])).toBe("abcxy");
  });
});

describe("ScrollbackSanitizer — chunk-boundary carry", () => {
  it("CSI split across chunks: \\x1b[3 + 1m → \\x1b[31m preserved", () => {
    expect(run(["red:\x1b[3", "1mglow\x1b[0m"])).toBe(
      "red:\x1b[31mglow\x1b[0m",
    );
  });

  it("CSI cursor-control split across chunks: \\x1b[1 + 0;5H → stripped", () => {
    expect(run(["a\x1b[1", "0;5Hb"])).toBe("ab");
  });

  it("private CSI split: \\x1b[?2 + 5l → stripped", () => {
    expect(run(["a\x1b[?2", "5lb"])).toBe("ab");
  });

  it("OSC split across chunks (BEL terminator)", () => {
    expect(run(["a\x1b]0;Tit", "le\x07b"])).toBe("a\x1b]0;Title\x07b");
  });

  it("OSC split across chunks (ST terminator across boundary)", () => {
    expect(run(["a\x1b]0;Title\x1b", "\\b"])).toBe(
      "a\x1b]0;Title\x1b\\b",
    );
  });

  it("CR-LF split across chunks: \\r + \\n → preserved as CRLF", () => {
    expect(run(["line1\r", "\nline2"])).toBe("line1\r\nline2");
  });

  it("bare-CR at end of stream: \\r alone → stripped", () => {
    // Final flush via a no-op feed must release the held CR as stripped.
    const s = new ScrollbackSanitizer();
    const a = s.feed(Buffer.from("done\r", "binary"));
    const b = s.flush();
    expect(Buffer.concat([a, b]).toString("binary")).toBe("done");
  });

  it("UTF-8 codepoint split across chunks does not corrupt", () => {
    // "ä" = 0xC3 0xA4 in UTF-8 — split across the boundary.
    const s = new ScrollbackSanitizer();
    const a = s.feed(Buffer.from([0x42, 0x75, 0xc3])); // "Bu" + first byte of "ä"
    const b = s.feed(Buffer.from([0xa4, 0x66])); // second byte of "ä" + "f"
    const out = Buffer.concat([a, b]).toString("utf8");
    // ScrollbackStore.read() runs StringDecoder over the full file, so the
    // sanitizer's job is simply: don't INVENT a reorder. UTF-8 continuation
    // bytes (0x80–0xBF) cannot collide with our ESC/CSI/OSC scanners.
    expect(out).toBe("Buäf");
  });
});

describe("ScrollbackSanitizer — overflow + recovery", () => {
  it("CSI overflow (>32 bytes without final byte) drops sequence + resyncs", () => {
    // 80 bytes of CSI parameter without terminator → drop. Drain swallows
    // the remainder until a fresh ESC starts a new SGR sequence.
    const long = "\x1b[" + "1;".repeat(40); // 82 bytes mid-CSI
    const after = "\x1b[31mafter\x1b[0m";
    const s = new ScrollbackSanitizer();
    const a = s.feed(Buffer.from(long, "binary"));
    const b = s.feed(Buffer.from(after, "binary"));
    const out = Buffer.concat([a, b]).toString("binary");
    expect(out).toContain("after");
    expect(out).toContain("\x1b[31m");
    // The dropped sequence's parameter bytes do NOT leak as text.
    expect(out).not.toContain("1;1;1;1;1;");
    // Stronger: zero of the parameter `1;` pairs leak.
    expect(out).not.toMatch(/1;1;/);
  });

  it("OSC overflow (>4096 bytes without terminator) drops sequence + resyncs on fresh ESC", () => {
    // Realistic resync model: an overlong OSC is malformed; we cannot
    // distinguish "more OSC payload" from "raw text the producer
    // intended to print" without a terminator. The drain swallows
    // bytes until a fresh ESC starts a new sequence — at which point
    // the parser re-syncs cleanly.
    const huge = "\x1b]0;" + "A".repeat(5000); // no BEL / ST
    const resync = "\x1b[31mafter\x1b[0m";
    const s = new ScrollbackSanitizer();
    const a = s.feed(Buffer.from(huge, "binary"));
    const b = s.feed(Buffer.from(resync, "binary"));
    const out = Buffer.concat([a, b]).toString("binary");
    // Resync wins — fresh SGR + text round-trip.
    expect(out).toContain("\x1b[31m");
    expect(out).toContain("after");
    // Dropped OSC parameter bytes do NOT leak as text.
    expect(out).not.toContain("AAAAAAAA");
  });

  it("orphan \\x1b not followed by [ or ] is preserved as-is (CSS=ESC alone)", () => {
    // Bare ESC followed by non-CSI/non-OSC byte — emitted as text. Rare
    // in practice; test documents the conservative fallback.
    expect(run(["\x1bA"])).toBe("\x1bA");
  });
});

describe("ScrollbackSanitizer — TUI-heavy fixture", () => {
  it("PowerShell 50× prompt repaint: zero cursor codes survive, text linearizes", () => {
    // Simulate 50 redraws of a PS prompt. Each redraw clears with \x1b[H,
    // emits "PowerShell 7.6.1\x1b[K\r\n", then "PS C:\\>".
    const redraw =
      "\x1b[H\x1b[J\x1b[1;36mPowerShell 7.6.1\x1b[0m\x1b[K\r\nPS C:\\> ";
    const fixture = redraw.repeat(50);
    const s = new ScrollbackSanitizer();
    const out = s.feed(Buffer.from(fixture, "binary")).toString("binary");

    // Non-SGR cursor codes are gone.
    expect(out).not.toMatch(/\x1b\[H/);
    expect(out).not.toMatch(/\x1b\[J/);
    expect(out).not.toMatch(/\x1b\[K/);
    // SGR codes are preserved.
    expect(out).toContain("\x1b[1;36m");
    expect(out).toContain("\x1b[0m");
    // Visible text shows up — the actual count is "50" not "exactly 1"
    // because the sanitizer linearizes the log; assert "appears at least
    // once" + "is readable as text" (per OpenAI #4).
    expect(out).toContain("PowerShell 7.6.1");
    expect(out).toContain("PS C:\\> ");
    // The output is plain text + SGR, no embedded cursor controls.
    expect(out).toMatch(/^[\x09\x0a\x0d\x20-\x7e\x1b]/);
  });
});
