/*
 * resumeCtaGate.test — iterate-20260515-resume-cta-jsonl-signal.
 *
 * RED tests for the corrected Resume-CTA activity gate. Iterate M
 * (ADR-100) gated on `lastPtyDataAt`, an embedded-pty signal that is
 * `null` whenever Claude runs in the user's own terminal (the Plan-D''
 * default) — so the gate failed open and Resume showed for every active
 * task. The fix gates primarily on `lastJsonlSeenMtimeMs`.
 */
import { describe, it, expect } from "vitest";
import {
  isClaudeRecentlyActive,
  JSONL_RECENT_ACTIVITY_MS,
  PTY_RECENT_ACTIVITY_MS,
} from "./resumeCtaGate";

// Fixed clock so the window maths is deterministic.
const NOW = 1_000_000_000_000;

describe("isClaudeRecentlyActive — primary JSONL signal", () => {
  it("AC-1: true for fresh lastJsonlSeenMtimeMs — the 'Claude in own terminal' shape Iterate M missed (lastPtyDataAt null)", () => {
    expect(
      isClaudeRecentlyActive(
        { lastJsonlSeenMtimeMs: NOW - 5_000, lastPtyDataAt: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("AC-2: false for stale lastJsonlSeenMtimeMs (>60s) with no other signal", () => {
    expect(
      isClaudeRecentlyActive({ lastJsonlSeenMtimeMs: NOW - 120_000 }, NOW),
    ).toBe(false);
  });

  it("JSONL boundary: exactly JSONL_RECENT_ACTIVITY_MS ago → false (strict <)", () => {
    expect(
      isClaudeRecentlyActive(
        { lastJsonlSeenMtimeMs: NOW - JSONL_RECENT_ACTIVITY_MS },
        NOW,
      ),
    ).toBe(false);
  });

  it("JSONL boundary: 1 ms inside the window → true", () => {
    expect(
      isClaudeRecentlyActive(
        { lastJsonlSeenMtimeMs: NOW - (JSONL_RECENT_ACTIVITY_MS - 1) },
        NOW,
      ),
    ).toBe(true);
  });

  it("future lastJsonlSeenMtimeMs (client clock behind server) counts as active", () => {
    expect(
      isClaudeRecentlyActive({ lastJsonlSeenMtimeMs: NOW + 10_000 }, NOW),
    ).toBe(true);
  });

  it("null / undefined lastJsonlSeenMtimeMs does not throw and is not 'active'", () => {
    expect(isClaudeRecentlyActive({ lastJsonlSeenMtimeMs: undefined }, NOW)).toBe(false);
    expect(
      isClaudeRecentlyActive({ lastJsonlSeenMtimeMs: undefined, lastPtyDataAt: null }, NOW),
    ).toBe(false);
  });

  it("defaults `now` to Date.now() when the arg is omitted", () => {
    expect(isClaudeRecentlyActive({ lastJsonlSeenMtimeMs: Date.now() })).toBe(true);
  });
});

describe("isClaudeRecentlyActive — secondary embedded-pty OR-signals", () => {
  it("AC-3: true when altScreenActive even if JSONL is stale", () => {
    expect(
      isClaudeRecentlyActive(
        { lastJsonlSeenMtimeMs: NOW - 120_000, altScreenActive: true },
        NOW,
      ),
    ).toBe(true);
  });

  it("AC-4: true when lastPtyDataAt is fresh even if JSONL is absent", () => {
    expect(isClaudeRecentlyActive({ lastPtyDataAt: NOW - 5_000 }, NOW)).toBe(true);
  });

  it("pty boundary: exactly PTY_RECENT_ACTIVITY_MS ago → false (strict <)", () => {
    expect(
      isClaudeRecentlyActive({ lastPtyDataAt: NOW - PTY_RECENT_ACTIVITY_MS }, NOW),
    ).toBe(false);
  });

  it("altScreenActive false is not itself an activity signal", () => {
    expect(isClaudeRecentlyActive({ altScreenActive: false }, NOW)).toBe(false);
  });
});

describe("isClaudeRecentlyActive — no signal", () => {
  it("AC-5: false when every field is absent", () => {
    expect(isClaudeRecentlyActive({}, NOW)).toBe(false);
  });

  it("false when every signal is present but stale", () => {
    expect(
      isClaudeRecentlyActive(
        {
          lastJsonlSeenMtimeMs: NOW - 120_000,
          lastPtyDataAt: NOW - 60_000,
          altScreenActive: false,
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("thresholds", () => {
  it("JSONL window is generous (60s) for bursty JSONL writes; pty window is tight (15s)", () => {
    expect(JSONL_RECENT_ACTIVITY_MS).toBe(60_000);
    expect(PTY_RECENT_ACTIVITY_MS).toBe(15_000);
  });
});
