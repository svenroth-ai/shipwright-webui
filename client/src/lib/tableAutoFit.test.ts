import { describe, it, expect } from "vitest";

import { computeAutoFitColumnWidths, MAX_COMFORTABLE_PX, MIN_FLEX_PX } from "./tableAutoFit";

describe("computeAutoFitColumnWidths", () => {
  it("returns null (no intervention) when every column already fits comfortably", () => {
    // Stack table shape: Layer / Technology / Notes, none exceeding the
    // comfortable threshold — table-layout: auto is already doing well here.
    const widths = [80, 140, 300];
    expect(computeAutoFitColumnWidths(widths, 1400)).toBeNull();
  });

  it("returns null for an empty column set", () => {
    expect(computeAutoFitColumnWidths([], 1000)).toBeNull();
  });

  it("keeps short columns at their natural width and gives the one free-text column the remaining space", () => {
    // FR table shape: ID/Area/Name/Priority/Basis/Layers short, Description huge.
    const widths = [64, 83, 97, 77, 5000, 63, 72];
    const result = computeAutoFitColumnWidths(widths, 1160);
    expect(result).not.toBeNull();
    const [id, area, name, priority, description, basis, layers] = result!;
    expect(id).toBe(64);
    expect(area).toBe(83);
    expect(name).toBe(97);
    expect(priority).toBe(77);
    expect(basis).toBe(63);
    expect(layers).toBe(72);
    // Remaining = 1160 - (64+83+97+77+63+72) = 704
    expect(description).toBeCloseTo(704, 5);
  });

  it("floors a free-text column at MIN_FLEX_PX when the pane is too narrow to satisfy it — this is expected to overflow the container and trigger horizontal scroll rather than crush the column further", () => {
    const widths = [63, 83, 91, 77, 5000, 63, 72];
    // sum of fixed columns = 449; container only 520px wide.
    const result = computeAutoFitColumnWidths(widths, 520);
    expect(result).not.toBeNull();
    const description = result![4];
    expect(description).toBe(MIN_FLEX_PX);
    const total = result!.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(520); // intentional overflow, not a bug
  });

  it("splits remaining space evenly across multiple free-text columns", () => {
    const widths = [60, 400, 400];
    const result = computeAutoFitColumnWidths(widths, 1000)!;
    expect(result[0]).toBe(60);
    // remaining = 1000 - 60 = 940, split across 2 flex columns = 470 each
    expect(result[1]).toBeCloseTo(470, 5);
    expect(result[2]).toBeCloseTo(470, 5);
  });

  it("treats a column exactly at the comfortable threshold as short (not flex)", () => {
    const widths = [MAX_COMFORTABLE_PX, MAX_COMFORTABLE_PX + 1];
    const result = computeAutoFitColumnWidths(widths, 1000)!;
    expect(result[0]).toBe(MAX_COMFORTABLE_PX);
    expect(result[1]).toBeGreaterThanOrEqual(MIN_FLEX_PX);
  });
});
