/*
 * clipboard.test — copyText helper (resume-cta-rework, 2026-05-16).
 *
 * Covers the three paths: modern Clipboard API success, fallback to
 * execCommand when the modern API rejects, and a descriptive rejection
 * when both fail. The rejection path is the load-bearing regression
 * fence — the old code swallowed failures silently.
 *
 * Note: this jsdom build does not define `document.execCommand` at all,
 * so the fallback is exercised by assigning a stub onto `document`
 * directly (a `vi.spyOn` would throw "execCommand does not exist").
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

/** Install a stub `document.execCommand` (jsdom omits it entirely). */
function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => result);
  (document as unknown as { execCommand: () => boolean }).execCommand =
    fn as unknown as () => boolean;
  return fn;
}

describe("copyText", () => {
  it("uses the modern Clipboard API when it succeeds", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const exec = stubExecCommand(true);

    await expect(copyText("hello-uuid")).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalledWith("hello-uuid");
    // The fallback must NOT run when the modern API succeeded.
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the modern API rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    stubClipboard(writeText);
    const exec = stubExecCommand(true);

    await expect(copyText("fallback-text")).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith("copy");
    // The transient textarea must be cleaned up.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("rejects with a descriptive Error when both paths fail", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    stubClipboard(writeText);
    stubExecCommand(false);

    await expect(copyText("doomed")).rejects.toThrow(
      /execCommand\('copy'\) returned false/,
    );
    // Cleanup still runs on the failure path (finally block).
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("uses execCommand directly when no Clipboard API is present", async () => {
    // navigator.clipboard absent — copyText must go straight to the
    // fallback path.
    const exec = stubExecCommand(true);
    await expect(copyText("no-modern-api")).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("preserveFocus restores the previously-focused element (execCommand path)", async () => {
    // The OSC 52 relay path: async copy while the terminal holds focus must
    // not be stolen by the temp-textarea dance.
    stubExecCommand(true); // navigator.clipboard absent → execCommand path
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    await copyText("focus-me", { preserveFocus: true });

    expect(document.activeElement).toBe(input); // focus restored
    input.remove();
  });

  it("without preserveFocus, focus is NOT restored (default menu-caller path)", async () => {
    stubExecCommand(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    await copyText("no-restore");

    expect(document.activeElement).not.toBe(input);
    input.remove();
  });
});
