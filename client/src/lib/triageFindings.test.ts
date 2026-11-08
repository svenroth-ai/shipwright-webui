// @covers FR-01.30
import { describe, expect, it } from "vitest";
import { parseFindings } from "./triageFindings";

const COMPLIANCE = `5 open compliance finding(s): A/A5.0, B/B7, D/D3

- A/A5.0: A5 setup — PyYAML unavailable (ModuleNotFoundError: No module named 'yaml') | hint: /shipwright-iterate --type change "reconcile A5.0"
- B/B7: Every commit since release tag has a matching event — 8 commit(s) since v0.17.0 have no matching event: 2a0b142b | hint: /shipwright-iterate --type change "reconcile B7"
- D/D3: Promised FRs delivered — FRs introduced via new_frs but never reaffirmed — FR-01.33`;

describe("parseFindings", () => {
  it("reads code, title, detail and hint from a real compliance bundle", () => {
    const f = parseFindings(COMPLIANCE);
    expect(f.map((x) => x.code)).toEqual(["A/A5.0", "B/B7", "D/D3"]);
    expect(f[0].title).toBe("A5 setup");
    expect(f[0].detail).toContain("PyYAML unavailable");
    expect(f[1].hint).toContain("reconcile B7");
    expect(f[2].hint).toBeNull();
    expect(f[2].title).toBe("Promised FRs delivered");
  });

  it("reads phase-quality lines with or without a colon", () => {
    const f = parseFindings("2 open phase-quality Tier-1 FAIL(s): iterate.\n\n- C1 record_event phase_completed[iterate]\n- C5: CHANGELOG [Unreleased] has Added entry");
    expect(f.map((x) => x.code)).toEqual(["C1", "C5"]);
    expect(f[1].title).toBe("CHANGELOG [Unreleased] has Added entry");
  });

  it("accepts unknown-shape codes such as E/E? and CRLF line endings", () => {
    const f = parseFindings("- E/E?: something odd\r\n- E/E1: report stale");
    expect(f.map((x) => x.code)).toEqual(["E/E?", "E/E1"]);
  });

  it("returns [] when no line looks like a check, so the caller shows the raw text", () => {
    expect(parseFindings("Appended AFTER page render to verify the 30s poll.")).toEqual([]);
    expect(parseFindings("")).toEqual([]);
    expect(parseFindings("- just a bullet without a code")).toEqual([]);
  });
});
