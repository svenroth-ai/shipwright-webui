/*
 * CLOSED-TYPE-SCALE GUARD (A05, FR-01.48, AC3) — Fable "~20 inline font-sizes".
 *
 * The design system has SIX type steps (styles/type-scale.css): 30 / 20 / 16 /
 * 14 / 12 / 11. Fable counted ~20 inline font-sizes breaking that scale. This
 * guard fails the build on a NEW inline `fontSize: 'Npx'` / off-scale
 * `text-[Npx]` in client/src, so the scale cannot silently drift open again while
 * tsc + lint stay green.
 *
 * A05's own visible win: the five 24px page titles were landed on the 20px step
 * (they now render through <PageHead> / .page-title). `24` is therefore NOT
 * allowlisted below — a reintroduced `text-[24px]` fails here, proving the guard
 * bites on a size the scale actually closed.
 *
 * The ALLOWLIST carries the pre-existing dense-surface sizes that live in
 * components owned by later sub-iterates (A11–A18 restyle the transcript /
 * triage / wizard / campaign surfaces). They are ACCOUNTED debt, not new steps —
 * the count of *unaccounted* off-scale sizes is 0. The xterm terminal tree is
 * excluded wholesale (its font metrics are pinned by ADR-097 / FR-01.44, AC6).
 *
 * Prove it bites: add `className="text-[17px]"` (or `style={{fontSize:'17px'}}`)
 * to any scanned file → this test goes RED. Recorded in the iterate ADR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The six canonical steps (styles/type-scale.css). Values are px, no unit. */
const STEPS = new Set(['11', '12', '14', '16', '20', '30']);

/**
 * Pre-existing off-scale sizes, each ACCOUNTED as legacy debt on a dense data
 * surface owned by a later sub-iterate (A11–A18). Not new steps; a plain number
 * only. Adding a size here is a deliberate, reviewed act — NOT a silent drift.
 *   10    — micro labels/counts (triage ids, campaign step ids, tool meta)
 *   11.5  — mono pill / data-cell text (SlashCommandChip, badges)
 *   12.5  — tool/skill card path rows, mission line
 *   13    — control text: dropdowns, buttons, sub-lines, dialog bodies (pervasive)
 *   15    — comfortable-bubble / prompt input reading size
 */
const ALLOWLIST = new Set(['10', '11.5', '12.5', '13', '15']);

const ALLOWED = new Set([...STEPS, ...ALLOWLIST]);

/** Skip the terminal tree (AC6 out-of-scope), node_modules, and this test. */
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

// Strip block comments + whole-line `//` comments so a documented size mention
// (this file's own docstring) is not miscounted.
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// off-scale sources:
//   text-[Npx]   Tailwind arbitrary font-size class
//   fontSize: 'Npx' / "Npx"   inline style STRING literal
//   fontSize: N               inline style NUMBER literal (React coerces → px)
const TEXT_CLASS = /\btext-\[([0-9.]+)px\]/g;
const INLINE_FS = /\bfontSize:\s*["']([0-9.]+)px["']/g;
const INLINE_FS_NUM = /\bfontSize:\s*([0-9][0-9.]*)\s*[,}]/g;

const files = walk(SRC);

function violations(): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const text = strip(readFileSync(f, 'utf8'));
    const bad = new Set<string>();
    for (const m of text.matchAll(TEXT_CLASS)) if (!ALLOWED.has(m[1])) bad.add(`text-[${m[1]}px]`);
    for (const m of text.matchAll(INLINE_FS)) if (!ALLOWED.has(m[1])) bad.add(`fontSize:'${m[1]}px'`);
    for (const m of text.matchAll(INLINE_FS_NUM)) if (!ALLOWED.has(m[1])) bad.add(`fontSize:${m[1]}`);
    if (bad.size) hits.push(`${path.relative(SRC, f)}: ${[...bad].join(', ')}`);
  }
  return hits;
}

describe('AC3 — the type scale is closed (six steps + accounted legacy allowlist)', () => {
  it('has zero UNACCOUNTED off-scale inline font-sizes in client/src', () => {
    const bad = violations();
    expect(bad, `off-scale font-sizes not on a step and not allowlisted:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('24px is NOT allowlisted — the five page titles were landed on the 20px step', () => {
    expect(ALLOWED.has('24')).toBe(false);
  });

  it('the six canonical steps are the closed design set', () => {
    expect([...STEPS].sort()).toEqual(['11', '12', '14', '16', '20', '30'].sort());
  });
});
