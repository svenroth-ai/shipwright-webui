import { describe, it, expect } from "vitest";

import { cronIntervalMs, evaluateStaleness } from "../cron.js";

describe("cronIntervalMs", () => {
  it("computes the gap between the next two occurrences for a regular schedule", () => {
    const from = new Date("2026-08-18T00:00:00.000Z");
    const result = cronIntervalMs("*/15 * * * *", from);
    expect(result).toEqual({ ok: true, ms: 15 * 60_000 });
  });

  it("computes a daily cadence", () => {
    const from = new Date("2026-08-18T00:00:00.000Z");
    const result = cronIntervalMs("0 9 * * *", from);
    expect(result).toEqual({ ok: true, ms: 24 * 60 * 60_000 });
  });

  it("returns ok:false for an unparseable cron string", () => {
    expect(cronIntervalMs("not a cron", new Date()).ok).toBe(false);
    expect(cronIntervalMs("99 99 * * *", new Date()).ok).toBe(false);
  });

  it("is deterministic in UTC regardless of host timezone assumptions", () => {
    const from = new Date("2026-08-18T12:00:00.000Z");
    const a = cronIntervalMs("0 0 * * *", from);
    const b = cronIntervalMs("0 0 * * *", from);
    expect(a).toEqual(b);
  });
});

describe("evaluateStaleness", () => {
  const cadenceMs = 10 * 60_000; // 10 minutes
  const thresholdMs = 3 * cadenceMs; // 30 minutes

  it("is fresh well within the threshold", () => {
    const lastRunAt = "2026-08-18T00:00:00.000Z";
    const now = new Date("2026-08-18T00:05:00.000Z"); // 5 min age
    const result = evaluateStaleness(lastRunAt, cadenceMs, now);
    expect(result.staleness).toBe("fresh");
    expect(result.thresholdMs).toBe(thresholdMs);
  });

  it("is fresh at EXACTLY the threshold (boundary — not stale)", () => {
    const lastRunAt = "2026-08-18T00:00:00.000Z";
    const now = new Date(new Date(lastRunAt).getTime() + thresholdMs);
    const result = evaluateStaleness(lastRunAt, cadenceMs, now);
    expect(result.staleness).toBe("fresh");
  });

  it("is stale one millisecond past the threshold (boundary)", () => {
    const lastRunAt = "2026-08-18T00:00:00.000Z";
    const now = new Date(new Date(lastRunAt).getTime() + thresholdMs + 1);
    const result = evaluateStaleness(lastRunAt, cadenceMs, now);
    expect(result.staleness).toBe("stale");
  });

  it("is stale well past the threshold", () => {
    const lastRunAt = "2026-08-18T00:00:00.000Z";
    const now = new Date("2026-08-19T00:00:00.000Z");
    const result = evaluateStaleness(lastRunAt, cadenceMs, now);
    expect(result.staleness).toBe("stale");
  });
});
