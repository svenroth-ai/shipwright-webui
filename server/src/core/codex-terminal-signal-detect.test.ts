import { describe, it, expect } from "vitest";
import { extractCodexApprovalPrompt, extractCodexErrorText } from "./codex-terminal-signal-detect.js";

describe("extractCodexApprovalPrompt — Codex Light §5.3", () => {
  it("returns null for empty text", () => {
    expect(extractCodexApprovalPrompt("")).toBeNull();
  });

  it("returns null when no approval heading is present", () => {
    expect(extractCodexApprovalPrompt("some ordinary Codex output\nmore lines\n")).toBeNull();
  });

  it("detects a pending command-exec approval request", () => {
    const text = [
      "Codex is planning the next step...",
      "",
      "Allow Codex to run `rm -rf node_modules`?",
      "1. Yes, and don't ask again for this command in this session",
      "2. No, and tell Codex what to do differently",
    ].join("\n");
    const block = extractCodexApprovalPrompt(text);
    expect(block).not.toBeNull();
    expect(block).toContain("Allow Codex to run `rm -rf node_modules`?");
    expect(block).toContain("No, and tell Codex what to do differently");
  });

  it("detects a pending patch-apply approval request", () => {
    const text = "Allow Codex to apply proposed code changes?\n1. Yes\n2. No";
    const block = extractCodexApprovalPrompt(text);
    expect(block).toContain("Allow Codex to apply proposed code changes?");
  });

  it("only scans the trailing recency window, not stale scrollback above it", () => {
    const stale = "Allow Codex to run `rm -rf /`?\n1. Yes\n2. No\n";
    const filler = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const text = `${stale}\n${filler}`;
    expect(extractCodexApprovalPrompt(text)).toBeNull();
  });

  it("stops the block at a blank-line gap so unrelated trailing output doesn't leak in", () => {
    const text = [
      "Allow Codex to run `echo hi`?",
      "1. Yes",
      "2. No",
      "",
      "",
      "unrelated later output that scrolled in after",
    ].join("\n");
    const block = extractCodexApprovalPrompt(text)!;
    expect(block).not.toContain("unrelated later output");
  });
});

describe("extractCodexErrorText — Codex Light §5.3", () => {
  it("returns null for empty text", () => {
    expect(extractCodexErrorText("")).toBeNull();
  });

  it("returns null when no error footer is present", () => {
    expect(extractCodexErrorText("Codex is working normally\n")).toBeNull();
  });

  it("detects a turn-aborted structured error", () => {
    const text = "turn aborted. Something went wrong? Hit `/feedback` to report the issue.";
    const block = extractCodexErrorText(text);
    expect(block).toContain("Something went wrong");
  });

  it("detects a rate-limit structured error with the same footer", () => {
    const text =
      "Codex is currently experiencing high load. Something went wrong? Hit `/feedback` to report the issue.";
    expect(extractCodexErrorText(text)).toContain("high load");
  });

  it("only scans the trailing recency window, not stale scrollback above it", () => {
    const stale = "turn aborted. Something went wrong? Hit `/feedback` to report the issue.\n";
    const filler = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const text = `${stale}\n${filler}`;
    expect(extractCodexErrorText(text)).toBeNull();
  });
});
