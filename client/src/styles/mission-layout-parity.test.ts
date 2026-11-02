/**
 * Visual polish fence: the Mission tab and Files & Terminal share ONE column layout
 * (gutter + column widths) and the Info sidebar tabs are the shared .ft-head band.
 * The real-browser proof is e2e/flows/V10-mission-visual-polish.spec.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SPLITTER_GUTTER_PX } from "../components/external/PaneSplitter";
import { DEFAULT_LEFT, DEFAULT_RIGHT } from "../hooks/useThreePaneLayout";
import { SIDEBAR_DEFAULT } from "../hooks/useMissionSidebar";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
const comp = (f: string) => readFileSync(path.join(dir, "..", "components", "external", f), "utf8");

describe("Mission <-> Files & Terminal column parity", () => {
  // @covers FR-01.66
  it("the splitter gutter equals the Mission card gap", () => {
    const gap = /\.on-photo \.mc-body \{ padding: 16px 32px 22px; gap: (\d+)px; \}/.exec(read("mission-record.css"));
    expect(gap, "mission .mc-body rule").not.toBeNull();
    expect(SPLITTER_GUTTER_PX).toBe(Number(gap![1]));
    expect(comp("PaneSplitter.tsx")).toContain(`w-[${SPLITTER_GUTTER_PX}px]`);
  });
  // @covers FR-01.66
  it("the left card width and the right default width match across both tabs", () => {
    const record = /\.record \{ width: (\d+)px;/.exec(read("mission-record.css"));
    expect(DEFAULT_LEFT).toBe(Number(record![1]));
    expect(DEFAULT_RIGHT).toBe(SIDEBAR_DEFAULT);
  });
  // @covers FR-01.66
  it("the Mission Info tabs use the shared 46px head band and the ft-seg tab variant", () => {
    const side = comp("mission/MissionInfoSidebar.tsx");
    expect(side).toContain('className="ft-head mc-side-head"');
    expect(side).toContain('variant="ft-seg"');
    expect(side).not.toContain('variant={embed ? "ft-seg" : "default"}');
  });
  // @covers FR-01.66
  it("the Agents pill lives in the Environment card, not in the chat footer", () => {
    expect(comp("mission/MissionInfoPanel.tsx")).toContain("<AgentsPill");
    expect(comp("mission/MissionBody.tsx")).not.toContain("footer={<AgentsDock");
  });
});
