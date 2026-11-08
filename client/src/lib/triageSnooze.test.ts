// @covers FR-01.30
import { describe, expect, it } from "vitest";
import { minRevisitDate, snoozePresets } from "./triageSnooze";

/** A Date whose LOCAL calendar day is y-m-d at the given local hour. */
function local(y: number, m: number, d: number, h = 12): Date {
  return new Date(y, m - 1, d, h, 0, 0);
}

describe("snoozePresets", () => {
  it("tomorrow / 1 week / 1 month as calendar dates", () => {
    const p = snoozePresets(local(2026, 11, 8));
    expect(p.tomorrow).toBe("2026-11-09");
    expect(p.week).toBe("2026-11-15");
    expect(p.month).toBe("2026-12-08");
  });

  it("clamps 1 month to the end of a shorter month", () => {
    expect(snoozePresets(local(2027, 1, 31)).month).toBe("2027-02-28");
    expect(snoozePresets(local(2028, 1, 31)).month).toBe("2028-02-29");
    expect(snoozePresets(local(2026, 12, 31)).month).toBe("2027-01-31");
  });

  it("rolls over month and year ends for tomorrow and 1 week", () => {
    expect(snoozePresets(local(2026, 12, 31)).tomorrow).toBe("2027-01-01");
    expect(snoozePresets(local(2026, 2, 25)).week).toBe("2026-03-04");
  });

  it("is stable across a daylight-saving change (calendar arithmetic, not milliseconds)", () => {
    // 2026-03-29 and 2026-10-25 are the European DST changes; whatever the
    // machine's zone, the preset must stay exactly N calendar days away.
    expect(snoozePresets(local(2026, 3, 28)).week).toBe("2026-04-04");
    expect(snoozePresets(local(2026, 10, 24)).week).toBe("2026-10-31");
  });

  it("never offers a date the server would still count as today", () => {
    // Evening in a zone west of UTC: local "tomorrow" can equal the UTC day.
    const now = new Date("2026-11-09T01:00:00Z");
    const floor = minRevisitDate(now);
    const p = snoozePresets(now);
    expect(p.tomorrow >= floor).toBe(true);
    expect(floor >= "2026-11-10").toBe(true);
  });
});
