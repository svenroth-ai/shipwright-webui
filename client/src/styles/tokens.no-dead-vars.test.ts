/*
 * DEAD-TOKEN GUARD (A03, FR-01.48, AC4) — Fable defect B1.
 *
 * A `var(--x)` with NO fallback that resolves to NO definition is a silent visual
 * bug: the property computes to its initial value and real UI un-styles (Fable
 * found 13 such tokens un-styling an Inbox pill, a wizard plan-card, a settings
 * select). Fifteen sub-iterates are about to lean on the Weather-Deck token names,
 * so this fails the build on any fallback-less `var(--x)` that isn't defined
 * somewhere in the app's CSS (or set inline in a component).
 *
 * Prove it bites: reference `var(--nope)` (no fallback) in any client/src file →
 * this test goes RED. Recorded in the iterate ADR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(css|ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// Strip block comments + whole-line `//` comments so a doc mention of `var(--x)`
// (e.g. this very guard's own docstring) is not miscounted as a live reference.
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = walk(SRC);
const texts = new Map(files.map((f) => [f, strip(readFileSync(f, 'utf8'))]));

/** Every custom property DEFINED anywhere: `--x:` in CSS, or as an inline-style
 *  object key `'--x':` / `"--x":` in a component. */
const defined = new Set<string>();
for (const text of texts.values()) {
  for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const m of text.matchAll(/['"](--[\w-]+)['"]\s*:/g)) defined.add(m[1]);
}
// Tailwind v4 emits its own theme + internal vars (--tw-*, default color scales,
// --spacing, --radius-*, --font-*, …) that live in the generated stylesheet, not
// our source. Treat those namespaces as defined so the guard checks OUR tokens.
const KNOWN_PREFIXES = ['--tw-'];
const isKnown = (name: string) =>
  defined.has(name) || KNOWN_PREFIXES.some((p) => name.startsWith(p));

describe('AC4 — no dead tokens (Fable B1)', () => {
  // @covers FR-01.48
  it('every fallback-less var(--x) reference resolves to a definition', () => {
    const orphans = new Map<string, string[]>();
    for (const [file, text] of texts) {
      // var(--x) NOT followed by a comma (i.e. no fallback) before the `)`.
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        const name = m[1];
        if (!isKnown(name)) {
          const rel = path.relative(SRC, file);
          orphans.set(name, [...(orphans.get(name) ?? []), rel]);
        }
      }
    }
    const report = [...orphans.entries()].map(([n, fs]) => `${n} — ${[...new Set(fs)].join(', ')}`);
    expect(report, `fallback-less var() with no definition:\n  ${report.join('\n  ')}`).toEqual([]);
  });

  // @covers FR-01.48
  it('the pre-existing --font-mono orphan (index.css) is gone', () => {
    let indexCss = '';
    for (const [file, text] of texts) if (file.endsWith('index.css')) indexCss = text;
    expect(indexCss).not.toMatch(/var\(--font-mono\b/);
  });

  // @covers FR-01.48
  it('the Weather-Deck v2 compatibility aliases are all defined (no un-styled UI)', () => {
    for (const alias of [
      '--line-card', '--lead', '--hero', '--recess', '--line-meaning', '--accent-deep',
      '--amber', '--amber-tint', '--amber-line', '--sh-hero', '--sh-card', '--radius-sm',
    ]) {
      expect(defined.has(alias), `${alias} must be defined`).toBe(true);
    }
  });
});
