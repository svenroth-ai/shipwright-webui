/*
 * commandRegistry — AC4 (registry ↔ cheat-sheet coherence) + AC9 (Launch from
 * the REAL /actions payload, never hardcoded).
 */
import { describe, expect, it, vi } from "vitest";
import {
  KEYBOARD_SHORTCUTS,
  buildCommands,
  filterCommands,
  type CommandDeps,
} from "./commandRegistry";

function deps(over: Partial<CommandDeps> = {}): CommandDeps {
  return {
    destinations: [
      { id: "board", label: "Task Board", path: "/" },
      { id: "triage", label: "Triage", path: "/triage" },
    ],
    navigate: vi.fn(),
    projects: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ],
    openProject: vi.fn(),
    actions: [
      { id: "new-iterate", label: "New Iterate", description: "Run an iterate" },
      { id: "new-task", label: "New Task" },
    ],
    launchAction: vi.fn(),
    setActiveProject: vi.fn(),
    density: "comfortable",
    toggleDensity: vi.fn(),
    ...over,
  };
}

describe("buildCommands", () => {
  it("builds Open commands from the router-derived destinations", () => {
    const d = deps();
    const cmds = buildCommands(d);
    const open = cmds.filter((c) => c.group === "open");
    expect(open.map((c) => c.label)).toEqual(["Open Task Board", "Open Triage"]);
    open[1].run();
    expect(d.navigate).toHaveBeenCalledWith("/triage");
  });

  it("builds Launch commands ONLY from the real /actions payload (AC9)", () => {
    const d = deps();
    const cmds = buildCommands(d);
    const launch = cmds.filter((c) => c.group === "launch");
    expect(launch.map((c) => c.label)).toEqual(["New Iterate", "New Task"]);
    launch[0].run();
    expect(d.launchAction).toHaveBeenCalledWith("new-iterate");
    // No hardcoded slash-command / phase string leaked into a label.
    for (const c of launch) {
      expect(c.label).not.toMatch(/shipwright-|\/shipwright|phase/i);
    }
  });

  it("yields an empty Launch group when no actions exist (honest empty result)", () => {
    const cmds = buildCommands(deps({ actions: [] }));
    expect(cmds.filter((c) => c.group === "launch")).toHaveLength(0);
  });

  it("jump commands open the project home", () => {
    const d = deps();
    const jump = buildCommands(d).filter((c) => c.group === "jump");
    expect(jump.map((c) => c.label)).toEqual(["Alpha", "Beta"]);
    jump[0].run();
    expect(d.openProject).toHaveBeenCalledWith("p1");
  });

  it("exposes a density toggle whose label reflects the current mode", () => {
    expect(
      buildCommands(deps({ density: "comfortable" })).find(
        (c) => c.id === "filter:density",
      )?.label,
    ).toBe("Switch to compact density");
    expect(
      buildCommands(deps({ density: "compact" })).find(
        (c) => c.id === "filter:density",
      )?.label,
    ).toBe("Switch to comfortable density");
  });
});

describe("filterCommands — fuzzy", () => {
  const cmds = buildCommands(deps());
  it("returns all commands for an empty query", () => {
    expect(filterCommands(cmds, "")).toHaveLength(cmds.length);
  });
  it("matches a contiguous substring", () => {
    const r = filterCommands(cmds, "iterate");
    expect(r[0].label).toBe("New Iterate");
  });
  it("matches a subsequence", () => {
    const r = filterCommands(cmds, "trg");
    expect(r.some((c) => c.label.includes("Triage"))).toBe(true);
  });
  it("returns nothing for a non-match", () => {
    expect(filterCommands(cmds, "zzzq")).toHaveLength(0);
  });
});

describe("KEYBOARD_SHORTCUTS — the bindings registry", () => {
  it("has unique ids and a chord + label for every entry", () => {
    const ids = new Set(KEYBOARD_SHORTCUTS.map((s) => s.id));
    expect(ids.size).toBe(KEYBOARD_SHORTCUTS.length);
    for (const s of KEYBOARD_SHORTCUTS) {
      expect(s.chord.key.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
  it("includes the load-bearing bindings", () => {
    const ids = KEYBOARD_SHORTCUTS.map((s) => s.id);
    for (const id of [
      "palette",
      "shortcuts",
      "list-down",
      "list-up",
      "focus-terminal",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
