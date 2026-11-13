/**
 * inboxViewStorage — the Inbox's remembered view (folded groups + project
 * order). Same contract as triageViewStorage: a read never throws, anything
 * unreadable falls back to the defaults, unknown values are dropped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultInboxView,
  INBOX_VIEW_STORAGE_KEY,
  loadInboxView,
  parseInboxView,
  saveInboxView,
  serializeInboxView,
} from "./inboxViewStorage";

// @covers FR-01.30
describe("inboxViewStorage", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips the folded groups and the order, keeping the order", () => {
    const view = { collapsed: ["proj-b"], projectOrder: ["proj-c", "proj-a", "proj-b"] };
    expect(parseInboxView(serializeInboxView(view))).toEqual(view);
  });

  it("falls back to the defaults for null, garbage, a wrong version or a wrong shape", () => {
    expect(parseInboxView(null)).toEqual(defaultInboxView());
    expect(parseInboxView("{not json")).toEqual(defaultInboxView());
    expect(parseInboxView(JSON.stringify({ v: 99, collapsed: ["x"] }))).toEqual(defaultInboxView());
    expect(parseInboxView(JSON.stringify(["x"]))).toEqual(defaultInboxView());
  });

  it("drops non-strings, empty and over-long ids and dedupes", () => {
    const raw = JSON.stringify({
      v: 1,
      collapsed: ["a", "a", 7, "", "x".repeat(200), null],
      projectOrder: "nope",
    });
    expect(parseInboxView(raw)).toEqual({ collapsed: ["a"], projectOrder: [] });
  });

  it("loads what was saved, and a blocked storage never throws", () => {
    saveInboxView({ collapsed: ["p"], projectOrder: ["p"] });
    expect(window.localStorage.getItem(INBOX_VIEW_STORAGE_KEY)).toContain('"collapsed":["p"]');
    expect(loadInboxView()).toEqual({ collapsed: ["p"], projectOrder: ["p"] });

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadInboxView()).toEqual(defaultInboxView());
    expect(() => saveInboxView({ collapsed: [], projectOrder: [] })).not.toThrow();
  });
});
