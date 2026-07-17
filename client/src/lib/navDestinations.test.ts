/*
 * navDestinations — reads the palette "Open" group from the REAL router
 * (handle.nav), never a hand-typed list (A21, FR-01.65, AC9 provenance).
 */
import { describe, expect, it } from "vitest";
import { getNavDestinations } from "./navDestinations";

describe("getNavDestinations", () => {
  const dests = getNavDestinations();

  // @covers FR-01.65
  it("derives the top-level surfaces from the router handles, in order", () => {
    expect(dests.map((d) => d.label)).toEqual([
      "Task Board",
      "Projects",
      "Inbox",
      "Triage",
      "Settings",
      "Diagnostics",
    ]);
  });

  // @covers FR-01.65
  it("maps the index route to '/' and the rest to '/<path>'", () => {
    const byId = new Map(dests.map((d) => [d.id, d]));
    expect(byId.get("board")?.path).toBe("/");
    expect(byId.get("triage")?.path).toBe("/triage");
  });

  // @covers FR-01.65
  it("excludes dynamic + nested routes (no :param / a/b destinations)", () => {
    for (const d of dests) {
      expect(d.path).not.toContain(":");
      // '/' is allowed as the board; no other multi-segment paths.
      expect(d.path === "/" || d.path.lastIndexOf("/") === 0).toBe(true);
    }
  });
});
