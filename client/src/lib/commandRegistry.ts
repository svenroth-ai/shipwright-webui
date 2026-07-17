/*
 * commandRegistry — the ONE place a command exists (A21, FR-01.65).
 *
 * The palette, the cheat-sheet and any menu read from here, so a shortcut can
 * never drift from what it does. Two exports:
 *
 *   1. KEYBOARD_SHORTCUTS — the keyboard bindings registry. Every JS key
 *      handler in the app corresponds to an entry here, and the cheat-sheet
 *      (ShortcutsSheet) renders ALL of them (AC4: no orphan handler, no secret
 *      shortcut).
 *   2. buildCommands(deps) — the palette command list, grouped Jump / Open /
 *      Launch / Filter. Launch entries come from the project's REAL /actions
 *      response (AC9 / DO-NOT #11) — never a hardcoded slash-command or phase
 *      string. A surface with no data yields an empty group, never a fabricated
 *      one.
 */

import type { ChordSpec } from "./formatChord";
import type { NavDestination } from "./navDestinations";

/* ── 1. Keyboard bindings registry ─────────────────────────────────────── */

export interface ShortcutDef {
  id: string;
  chord: ChordSpec;
  label: string;
  /** Cheat-sheet section heading. */
  section: string;
}

export const KEYBOARD_SHORTCUTS: ShortcutDef[] = [
  { id: "palette", chord: { mod: true, key: "K" }, label: "Open the command palette", section: "Global" },
  { id: "shortcuts", chord: { key: "?" }, label: "Show this keyboard cheat-sheet", section: "Global" },
  { id: "list-down", chord: { key: "J" }, label: "Move the selection down", section: "Lists" },
  { id: "list-up", chord: { key: "K" }, label: "Move the selection up", section: "Lists" },
  { id: "list-open", chord: { key: "Enter" }, label: "Open the selected item", section: "Lists" },
  { id: "list-tab", chord: { key: "Tab" }, label: "Move between cards (real DOM order)", section: "Lists" },
  { id: "quick-launch", chord: { key: "L" }, label: "Launch the selected task (board list)", section: "Quick actions" },
  { id: "focus-terminal", chord: { key: "T" }, label: "Focus the terminal + enter focus mode", section: "Task detail" },
  { id: "exit-focus", chord: { key: "Esc" }, label: "Exit focus mode / close the palette", section: "Task detail" },
];

/* ── 2. Palette command list ───────────────────────────────────────────── */

export type CommandGroup = "jump" | "open" | "launch" | "filter";

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** Secondary text (project path, action description, …). */
  hint?: string;
  /** Extra text folded into the fuzzy match. */
  keywords?: string;
  run: () => void;
}

/** A project as the palette needs it — id + display name only. */
export interface PaletteProject {
  id: string;
  name: string;
}

/** An action as the palette needs it — from the REAL /actions response. */
export interface PaletteAction {
  id: string;
  label: string;
  description?: string;
}

export interface CommandDeps {
  destinations: NavDestination[];
  navigate: (path: string) => void;
  projects: PaletteProject[];
  /** Jump to a project's home (Ship's Log). */
  openProject: (projectId: string) => void;
  /** The active project's REAL launch actions (from /actions). */
  actions: PaletteAction[];
  launchAction: (actionId: string) => void;
  /** Filter the board to a project (or All when null). */
  setActiveProject: (projectId: string | null) => void;
  /** Density toggle command. */
  density: "comfortable" | "compact";
  toggleDensity: () => void;
}

export const GROUP_LABELS: Record<CommandGroup, string> = {
  jump: "Jump to project",
  open: "Open",
  launch: "Launch",
  filter: "Filter & view",
};

export function buildCommands(deps: CommandDeps): Command[] {
  const cmds: Command[] = [];

  // Open — navigable surfaces (derived from the router).
  for (const d of deps.destinations) {
    cmds.push({
      id: `open:${d.id}`,
      group: "open",
      label: `Open ${d.label}`,
      keywords: d.path,
      run: () => deps.navigate(d.path),
    });
  }

  // Jump to project.
  for (const p of deps.projects) {
    cmds.push({
      id: `jump:${p.id}`,
      group: "jump",
      label: p.name,
      hint: "Open the project's Ship's Log",
      run: () => deps.openProject(p.id),
    });
  }

  // Launch — from the REAL /actions response (AC9 / DO-NOT #11).
  for (const a of deps.actions) {
    cmds.push({
      id: `launch:${a.id}`,
      group: "launch",
      label: a.label,
      hint: a.description,
      keywords: a.id,
      run: () => deps.launchAction(a.id),
    });
  }

  // Filter & view.
  cmds.push({
    id: "filter:all-projects",
    group: "filter",
    label: "Show all projects",
    run: () => deps.setActiveProject(null),
  });
  for (const p of deps.projects) {
    cmds.push({
      id: `filter:${p.id}`,
      group: "filter",
      label: `Filter board to ${p.name}`,
      run: () => deps.setActiveProject(p.id),
    });
  }
  cmds.push({
    id: "filter:density",
    group: "filter",
    label:
      deps.density === "compact"
        ? "Switch to comfortable density"
        : "Switch to compact density",
    keywords: "density compact comfortable spacing",
    run: () => deps.toggleDensity(),
  });

  return cmds;
}

/**
 * A tiny, dependency-free subsequence fuzzy filter. Returns the commands whose
 * label/hint/keywords contain the query characters in order, best matches
 * first (contiguous + earlier matches rank higher). Empty query ⇒ all, in
 * registry order (the caller applies recent-first on top).
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (q === "") return commands;
  const scored: Array<{ cmd: Command; score: number }> = [];
  for (const cmd of commands) {
    const hay = `${cmd.label} ${cmd.hint ?? ""} ${cmd.keywords ?? ""}`.toLowerCase();
    const score = subsequenceScore(hay, q);
    if (score !== null) scored.push({ cmd, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.cmd);
}

/** Lower score = better. `null` = no match. */
function subsequenceScore(haystack: string, needle: string): number | null {
  // Fast path: a contiguous substring is the best match, ranked by position.
  const idx = haystack.indexOf(needle);
  if (idx !== -1) return idx;
  // Subsequence: every needle char appears in order. Penalise the gaps.
  let hi = 0;
  let gaps = 0;
  let last = -1;
  for (let ni = 0; ni < needle.length; ni++) {
    const found = haystack.indexOf(needle[ni], hi);
    if (found === -1) return null;
    if (last !== -1) gaps += found - last - 1;
    last = found;
    hi = found + 1;
  }
  // Offset by 1000 so any contiguous match (score < len) always wins.
  return 1000 + gaps;
}
