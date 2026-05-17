/*
 * taskLifecycle.test.ts — iterate-2026-05-17-move-to-backlog.
 */
import { describe, it, expect } from "vitest";
import type { ExternalTaskState } from "./externalApi";
import {
  IN_PROGRESS_STATES,
  isInProgressState,
  hasLaunchedBefore,
} from "./taskLifecycle";

describe("IN_PROGRESS_STATES", () => {
  it("is exactly the five launched-but-not-done states", () => {
    expect([...IN_PROGRESS_STATES].sort()).toEqual(
      ["active", "awaiting_external_start", "idle", "jsonl_missing", "launch_failed"].sort(),
    );
  });

  it("excludes draft and done", () => {
    expect(IN_PROGRESS_STATES).not.toContain("draft");
    expect(IN_PROGRESS_STATES).not.toContain("done");
  });
});

describe("isInProgressState", () => {
  it.each(IN_PROGRESS_STATES)("returns true for %s", (state) => {
    expect(isInProgressState(state)).toBe(true);
  });

  it.each(["draft", "done"] as ExternalTaskState[])(
    "returns false for %s",
    (state) => {
      expect(isInProgressState(state)).toBe(false);
    },
  );
});

describe("hasLaunchedBefore", () => {
  it("is true when firstJsonlObservedAt is a non-empty string", () => {
    expect(hasLaunchedBefore({ firstJsonlObservedAt: "2026-05-17T10:00:00.000Z" })).toBe(true);
  });

  it("is false when firstJsonlObservedAt is undefined", () => {
    expect(hasLaunchedBefore({ firstJsonlObservedAt: undefined })).toBe(false);
  });

  it("is false when firstJsonlObservedAt is an empty string", () => {
    expect(hasLaunchedBefore({ firstJsonlObservedAt: "" })).toBe(false);
  });
});
