/*
 * NO-HARDCODED-COLORS GUARD (A04, FR-01.48, AC1).
 *
 * A04 swept every hardcoded Tailwind palette class (bg-stone-100, text-red-600,
 * border-amber-300, …) and every arbitrary-hex colour class (bg-[#5c5652]) off
 * the app and onto the Weather-Deck @theme utilities (bg-card, text-muted,
 * border-line, text-warn, …) + the legacy --color-* alias layer. This guard
 * stops the next fifteen sub-iterates from re-introducing them one component at
 * a time and rotting the token system back to warm-beige.
 *
 * It FAILS on:
 *   1. a hardcoded palette class  (bg|text|border|ring|…)-(stone|gray|…)-NNN
 *   2. a new arbitrary-hex colour class  (bg|text|border|…)-[#rrggbb]
 * in any client/src *.ts / *.tsx (comments stripped so a doc mention is safe).
 *
 * ALLOWED and therefore NOT scanned:
 *   - client/src/components/terminal/**  — the xterm terminal theme mirrors
 *     Claude's own light/dark appearance and is exact-pinned by ADR-097 /
 *     FR-01.44 (AC6: byte-identical, never swept). Its colours are JS theme
 *     object values, not Tailwind classes, but we exclude the tree wholesale so
 *     nobody has to reason about it here.
 *   - *.test.ts / *.test.tsx  — fixtures/assertions may reference old classes.
 *   - `var(--x, #hex)` fallbacks — a hex INSIDE a var() fallback is a legacy
 *     safety net, not a hardcoded class; the arbitrary-hex regex only bites
 *     `-[#…]` (bracket-then-hash), so `-[var(--x,#hex)]` passes by construction.
 *
 * Prove it bites: add `className="bg-stone-100"` (or `bg-[#abcdef]`) to any
 * scanned file → this test goes RED. Recorded in the iterate ADR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Skip the terminal tree (AC6 out-of-scope) and node_modules. */
function isExcludedDir(name: string): boolean {
  return name === 'node_modules' || name === 'terminal';
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (isExcludedDir(entry)) continue;
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// Strip block comments + whole-line `//` comments so a documented class name
// (e.g. an ADR-referencing note about `bg-neutral-900`) is not miscounted.
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const HUES =
  'stone|gray|slate|zinc|neutral|amber|red|green|blue|teal|emerald|orange|' +
  'yellow|indigo|purple|pink|rose|sky|cyan|lime|fuchsia|violet';
const PREFIXES =
  'bg|text|border|ring|from|to|via|divide|outline|decoration|fill|stroke|' +
  'shadow|ring-offset|caret|accent|placeholder';

// palette class: prefix-hue-NNN  (allow a trailing /opacity modifier)
const PALETTE = new RegExp(String.raw`\b(?:${PREFIXES})-(?:${HUES})-[0-9]{2,3}\b`, 'g');
// arbitrary-hex colour class: prefix-[#rrggbb]  (NOT a var() fallback)
const HEXCLASS = new RegExp(String.raw`\b(?:${PREFIXES})-\[#[0-9a-fA-F]{3,8}\]`, 'g');

const files = walk(SRC);

function offenders(re: RegExp): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const text = strip(readFileSync(f, 'utf8'));
    const m = text.match(re);
    if (m) hits.push(`${path.relative(SRC, f)}: ${[...new Set(m)].join(', ')}`);
  }
  return hits;
}

describe('AC1 — no hardcoded colours reintroduced (Weather-Deck sweep, A04)', () => {
  it('has zero hardcoded Tailwind palette classes in client/src', () => {
    const bad = offenders(PALETTE);
    expect(bad, `hardcoded palette classes:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('has zero arbitrary-hex colour classes in client/src', () => {
    const bad = offenders(HEXCLASS);
    expect(bad, `arbitrary-hex colour classes:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});
