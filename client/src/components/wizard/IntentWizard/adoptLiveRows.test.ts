/**
 * @covers FR-01.75
 * Row-by-row provenance of the Adopt result: live / reported-empty / not reported / sample,
 * and a banner derived from the rows (never a fixed claim).
 */
import { describe, expect, it } from "vitest";

import { adoptBannerText, buildAdoptRows, NOT_REPORTED, NOTHING_FOUND } from "./adoptLiveRows";
import { ADOPT_SNAPSHOT } from "./stubData";

const sample = ADOPT_SNAPSHOT.found;
const states = (rows: ReturnType<typeof buildAdoptRows>) => Object.fromEntries(rows.map((r) => [r.label, r.state]));

describe("buildAdoptRows", () => {
  it("// @covers FR-01.75 no scan result: everything stays a sample", () => {
    const rows = buildAdoptRows(sample, { profileValue: null, findings: null });
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["sample"]));
    expect(adoptBannerText(rows)).toMatch(/^Sample findings/);
  });

  it("// @covers FR-01.75 profile only (older answer without findings): the rest is 'not reported'", () => {
    const rows = buildAdoptRows(sample, { profileValue: "vite-hono", findings: {} });
    expect(states(rows)).toMatchObject({ Profile: "live", Stack: "unreported", Commands: "unreported", Features: "sample" });
    expect(rows.find((r) => r.label === "Stack")?.value).toBe(NOT_REPORTED);
  });

  it("// @covers FR-01.75 reported-empty differs from absent", () => {
    const rows = buildAdoptRows(sample, { profileValue: null, findings: { tests: null, routes: 0 } });
    expect(rows.find((r) => r.label === "Tests")).toMatchObject({ state: "empty", value: NOTHING_FOUND });
    expect(rows.find((r) => r.label === "Routes")).toMatchObject({ state: "empty" });
    expect(rows.find((r) => r.label === "CI")?.state).toBe("unreported");
    expect(rows.find((r) => r.label === "Profile")?.state).toBe("sample");
  });

  it("// @covers FR-01.75 the banner separates live, unreported and sample rows", () => {
    const rows = buildAdoptRows(sample, { profileValue: "x", findings: { stack: "a" } });
    expect(adoptBannerText(rows)).toBe(
      "Read live from your repo: Stack, Profile. Not reported by this scan version: Routes, Tests, CI, Conventions, Commands. Still samples: Features (the full scan lands later). ",
    );
  });

  it("// @covers FR-01.75 an empty findings block never claims a live read", () => {
    const rows = buildAdoptRows(sample, { profileValue: null, findings: {} });
    const text = adoptBannerText(rows);
    expect(text).not.toContain("Read live");
    expect(text.startsWith("Not reported by this scan version: ")).toBe(true);
  });
});
