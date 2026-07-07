/*
 * terminal-osc52 — relay Claude's OSC 52 clipboard writes to the OS clipboard.
 * iterate-2026-07-07-terminal-osc52-clipboard.
 *
 * Claude Code copies a mouse selection via OSC 52 (`ESC ] 52 ; c ; <base64>`);
 * xterm.js drops OSC 52 by default (security), so the copy never reached the
 * clipboard ("copied N chars" showed in Claude but paste returned the OLD
 * entry). These tests pin the pure parse/decode + the dependency-injected
 * handler: WRITE relays via `copy`; a READ request (`?`) is DENIED (never leak
 * the OS clipboard back to a program).
 */
import { describe, it, expect, vi } from "vitest";
import {
  decodeOsc52Base64,
  parseOsc52,
  createOsc52ClipboardHandler,
  OSC52_MAX_BYTES,
} from "./terminal-osc52";

/** UTF-8-safe base64 encode (mirror of the decoder), for building payloads. */
const enc = (s: string): string => btoa(unescape(encodeURIComponent(s)));
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("decodeOsc52Base64", () => {
  it("decodes ASCII", () => {
    expect(decodeOsc52Base64(enc("hello world"))).toBe("hello world");
  });
  it("decodes UTF-8 (accents + emoji)", () => {
    expect(decodeOsc52Base64(enc("café — 🚀"))).toBe("café — 🚀");
  });
  it("tolerates surrounding whitespace", () => {
    expect(decodeOsc52Base64("  " + enc("trim") + "\n")).toBe("trim");
  });
  it("returns null on malformed base64", () => {
    expect(decodeOsc52Base64("!!!not base64!!!")).toBeNull();
  });
});

describe("parseOsc52", () => {
  it("classifies a write (selector c)", () => {
    expect(parseOsc52("c;" + enc("copied text"))).toEqual({
      kind: "write",
      text: "copied text",
    });
  });
  it("classifies the primary selector (p) as a write too", () => {
    expect(parseOsc52("p;" + enc("prim"))).toEqual({
      kind: "write",
      text: "prim",
    });
  });
  it("classifies a read request (?) — never a write", () => {
    expect(parseOsc52("c;?")).toEqual({ kind: "read" });
  });
  it("treats an empty payload as an empty write (handler no-ops it)", () => {
    expect(parseOsc52("c;")).toEqual({ kind: "write", text: "" });
  });
  it("classifies malformed base64 as invalid", () => {
    expect(parseOsc52("c;@@@@").kind).toBe("invalid");
  });
  it("rejects an oversized payload as invalid (DoS guard)", () => {
    const huge = enc("x".repeat(OSC52_MAX_BYTES + 10));
    expect(parseOsc52("c;" + huge).kind).toBe("invalid");
  });
});

describe("createOsc52ClipboardHandler", () => {
  it("relays a WRITE to copy() and consumes the sequence (returns true)", () => {
    const copy = vi.fn(async () => {});
    const handler = createOsc52ClipboardHandler({ copy });
    expect(handler("c;" + enc("clip me"))).toBe(true);
    expect(copy).toHaveBeenCalledWith("clip me");
  });

  it("DENIES a READ request — no copy, still consumes (no clipboard leak)", () => {
    const copy = vi.fn(async () => {});
    const handler = createOsc52ClipboardHandler({ copy });
    expect(handler("c;?")).toBe(true);
    expect(copy).not.toHaveBeenCalled();
  });

  it("does NOT clear the clipboard on an empty write", () => {
    const copy = vi.fn(async () => {});
    const handler = createOsc52ClipboardHandler({ copy });
    expect(handler("c;")).toBe(true);
    expect(copy).not.toHaveBeenCalled();
  });

  it("consumes a malformed payload without copying", () => {
    const copy = vi.fn(async () => {});
    const handler = createOsc52ClipboardHandler({ copy });
    expect(handler("c;@@@")).toBe(true);
    expect(copy).not.toHaveBeenCalled();
  });

  it("surfaces onError when the copy write fails", async () => {
    const copy = vi.fn(async () => {
      throw new Error("execCommand returned false");
    });
    const onError = vi.fn();
    const handler = createOsc52ClipboardHandler({ copy, onError });
    handler("c;" + enc("x"));
    await flush();
    expect(onError).toHaveBeenCalled();
  });

  it("does not fire onError once disposed", async () => {
    const copy = vi.fn(async () => {
      throw new Error("fail");
    });
    const onError = vi.fn();
    const handler = createOsc52ClipboardHandler({
      copy,
      onError,
      isDisposed: () => true,
    });
    handler("c;" + enc("x"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
  });
});
