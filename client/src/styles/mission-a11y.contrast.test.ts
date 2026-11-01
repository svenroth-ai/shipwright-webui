/*
 * MISSION CONTRAST LADDER (WCAG 2.2 AA) - campaign mission-desktop-style-v2, V9 (mockup Board 10).
 *
 * Same method as tokens.contrast.test.ts: every token is PARSED from the stylesheet that defines
 * it, so editing a token re-drives the math (prove it bites: set `--muted` in the dark `.mc-op`
 * scope to #6b645d and "dark --muted / card" goes red). Two scopes carry the new Mission look:
 *   - the DARK chat card (`.on-photo .mc-op:not([data-state="designgate"])`, mission-operation.css)
 *   - the LIGHT Agents window + its chat-feed token set (`.ag-window`, `.ag-feed`, mission-agents.css)
 * Text needs 4.5:1; UI boundaries (focus ring, status dot) 3:1 (WCAG 1.4.11 / 2.4.13).
 *
 * @covers FR-01.66
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
const WD = read("weather-deck.css");
const OPERATION = read("mission-operation.css");
const AGENTS = read("mission-agents.css");

type RGBA = [number, number, number, number];
type RGB = [number, number, number];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Declaration body of the FIRST rule whose selector list is exactly `selector`. */
function block(css: string, selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc(selector)}\\s*\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`CSS block "${selector}" not found`);
  return m[1];
}

function parseColour(raw: string): RGBA {
  const v = raw.trim();
  const hex = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`unparseable colour "${raw}"`);
}

/** `--name: <colour>;` inside a declaration body. Throws when absent, so a rename cannot pass silently. */
function tok(body: string, name: string): RGBA {
  const m = body.match(new RegExp(`--${esc(name)}\\s*:\\s*(#[0-9a-fA-F]{3,6}|rgba?\\([^)]*\\))`));
  if (!m) throw new Error(`token --${name} not found`);
  return parseColour(m[1]);
}

/** Alpha-composite `fg` over an OPAQUE `bg`. */
function over(fg: RGBA, bg: RGB): RGB {
  const a = fg[3];
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as RGB;
}
const solid = (c: RGBA): RGB => [c[0], c[1], c[2]];

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const TEXT = 4.5;
const UI = 3.0;

// ── dark chat card ──────────────────────────────────────────────────────────
const D = block(OPERATION, '.on-photo .mc-op:not([data-state="designgate"])');
const D_BG = solid(tok(D, "card")) && solid(parseColour(D.match(/background:\s*(#[0-9a-fA-F]{6})/)![1]));
const D_CARD = solid(tok(D, "card"));
const D_THEAD = solid(tok(D, "thead"));
const D_BUBBLE = over([...solid(tok(D, "ink")), 0.09] as RGBA, D_CARD); // mission-chat.css: color-mix(ink 9%, card)

// ── light Agents window + feed token set ────────────────────────────────────
const L_CARD = solid(tok(WD, "card"));
const L_INSET = solid(tok(WD, "inset"));
const AG = block(AGENTS, ".ag-window, .artifact");
const AGW = block(AGENTS, ".ag-window");
const AF = block(AGENTS, ".ag-feed");

interface Rung {
  name: string;
  fg: RGB;
  bg: RGB;
  min: number;
}

const dark = (name: string, bg: RGB, bgName: string, min = TEXT): Rung => ({
  name: `dark --${name} / ${bgName}`,
  fg: solid(tok(D, name)),
  bg,
  min,
});
const darkTint = (name: string): Rung => ({
  name: `dark --${name} pill / --${name}-tint over card`,
  fg: solid(tok(D, name)),
  bg: over(tok(D, `${name}-tint`), D_CARD),
  min: TEXT,
});

const LADDER: Rung[] = [
  // dark text on the card ground and on the chat card's own surface
  ...["ink", "body", "muted", "faint", "link", "link-hover", "accent"].flatMap((n) => [
    dark(n, D_BG, "ground"),
    dark(n, D_CARD, "card"),
  ]),
  ...["ok", "err", "warn"].flatMap((n) => [dark(n, D_BG, "ground"), dark(n, D_CARD, "card"), darkTint(n)]),
  darkTint("accent"),
  { name: "dark --ink / table head", fg: solid(tok(D, "ink")), bg: D_THEAD, min: TEXT },
  { name: "dark --ink / human bubble", fg: solid(tok(D, "ink")), bg: D_BUBBLE, min: TEXT },
  { name: "dark --link / human bubble", fg: solid(tok(D, "link")), bg: D_BUBBLE, min: TEXT },
  { name: "dark --muted / human bubble", fg: solid(tok(D, "muted")), bg: D_BUBBLE, min: TEXT },
  // the error badge flips to dark-on-coral
  {
    name: "dark error badge text / coral fill",
    fg: parseColour(OPERATION.match(/\.mcv-badge\s*\{\s*background:\s*#[0-9a-fA-F]{6};\s*color:\s*(#[0-9a-fA-F]{6})/)![1]).slice(0, 3) as RGB,
    bg: solid(tok(D, "err")),
    min: TEXT,
  },
  // non-text: focus ring and the running dot against the dark card
  { name: "dark --accent focus ring / card (UI)", fg: solid(tok(D, "accent")), bg: D_CARD, min: UI },
  { name: "dark --warn running dot / card (UI)", fg: solid(tok(D, "warn")), bg: D_CARD, min: UI },

  // light Agents window (root tokens, portaled outside .on-photo)
  ...(["ink", "body", "accent"] as const).flatMap((n) => [
    { name: `light --${n} / card`, fg: solid(tok(WD, n)), bg: L_CARD, min: TEXT },
    { name: `light --${n} / inset`, fg: solid(tok(WD, n)), bg: L_INSET, min: TEXT },
  ]),
  // .ag-window re-declares --muted (root #79716B is 4.39:1 on --inset)
  { name: "light --muted (window) / card", fg: solid(tok(AGW, "muted")), bg: L_CARD, min: TEXT },
  { name: "light --muted (window) / inset", fg: solid(tok(AGW, "muted")), bg: L_INSET, min: TEXT },
  { name: "light --muted (window) / list ground", fg: solid(tok(AGW, "muted")), bg: solid(tok(AG, "ag-grey")), min: TEXT },
  { name: "light --ag-title / list ground", fg: solid(tok(AG, "ag-title")), bg: solid(tok(AG, "ag-grey")), min: TEXT },
  { name: "light --ag-sub / list ground", fg: solid(tok(AG, "ag-sub")), bg: solid(tok(AG, "ag-grey")), min: TEXT },
  { name: "light --ag-sub / card", fg: solid(tok(AG, "ag-sub")), bg: L_CARD, min: TEXT },
  { name: "light --body / --line-strong count chip", fg: solid(tok(WD, "body")), bg: solid(tok(WD, "line-strong")), min: TEXT },
  ...(["ok", "err", "warn"] as const).map((n) => ({
    name: `light --${n} pill / --${n}-tint`,
    fg: solid(tok(WD, n)),
    bg: solid(tok(WD, `${n}-tint`)),
    min: TEXT,
  })),
  { name: "light hash chip: --accent-hover / --accent-tint", fg: solid(tok(WD, "accent-hover")), bg: solid(tok(WD, "accent-tint")), min: TEXT },
  { name: "light pill: --ag-sub / --inset", fg: solid(tok(AG, "ag-sub")), bg: L_INSET, min: TEXT },
  // the feed token set inside the Agents window (.ag-feed on --card)
  { name: "agent feed --muted / card", fg: solid(tok(AF, "muted")), bg: L_CARD, min: TEXT },
  { name: "agent feed --faint / card", fg: solid(tok(AF, "faint")), bg: L_CARD, min: TEXT },
  { name: "agent feed --link / card", fg: solid(tok(AF, "link")), bg: L_CARD, min: TEXT },
  { name: "agent feed --link-hover / card", fg: solid(tok(AF, "link-hover")), bg: L_CARD, min: TEXT },
  { name: "agent feed --ink / table head", fg: solid(tok(WD, "ink")), bg: solid(tok(AF, "thead")), min: TEXT },
  { name: "agent feed --muted / table head", fg: solid(tok(AF, "muted")), bg: solid(tok(AF, "thead")), min: TEXT },
  { name: "light --accent focus ring / card (UI)", fg: solid(tok(WD, "accent")), bg: L_CARD, min: UI },
  { name: "light --warn running dot / card (UI)", fg: solid(tok(WD, "warn")), bg: L_CARD, min: UI },
];

describe("Mission dark + light token pairs clear WCAG 2.2 AA", () => {
  it("parses the scopes it claims to guard", () => {
    expect(r2(contrast(D_BG, D_CARD))).toBeGreaterThan(1); // the two grounds are distinct and resolved
    expect(LADDER.length).toBeGreaterThan(40);
  });

  it.each(LADDER.map((r) => [r.name, r] as const))("%s", (_name, rung) => {
    const ratio = contrast(rung.fg, rung.bg);
    expect(r2(ratio), `${rung.name} = ${r2(ratio)}:1, needs ${rung.min}:1`).toBeGreaterThanOrEqual(rung.min);
  });
});
