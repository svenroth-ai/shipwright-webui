/*
 * THE AA CONTRAST LADDER — machine-checked (A03, FR-01.48, AC1).
 *
 * This is the reason the A03 sub-iterate exists. Fable MEASURED four legibility
 * failures in the prototype (brand tag 2.90, terminal dim 3.65–3.92, --faint as
 * body text 2.52, dismissed-triage opacity:.6 over photo); they were deliberately
 * NOT spot-patched because they are a systemic token job. This test is that job:
 * a WCAG 2.1 relative-luminance implementation over the declared
 * (text-token × allowed-ground) matrix. It FAILS below 4.5:1 (body) / 3:1 (large
 * text + UI boundary), and it proves each of the four failures is fixed or
 * explicitly re-roled.
 *
 * The biting tokens (--ink/--body/--muted/--faint/--accent and the composite
 * grounds) are PARSED from weather-deck.css, so editing a token re-drives the
 * math. Prove it bites: set `--body` to `#9a948d` in weather-deck.css → this test
 * goes RED (`--body on card` drops to 3.00). Recorded in the iterate ADR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const WD = readFileSync(path.join(dir, 'weather-deck.css'), 'utf8');
const OP = readFileSync(path.join(dir, 'on-photo.css'), 'utf8');

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Parse a solid `--name: #hex;` definition out of a CSS string. Throws if absent
 *  so the ladder can never silently pass on a token that was renamed/removed. */
function token(css: string, name: string): RGB {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`token --${name} not found in CSS (ladder cannot resolve it)`);
  return hexToRgb(m[1]);
}

/** Isolate a single CSS rule body (declarations between `{ }`) whose selector
 *  matches `head`, so contextual overrides (`.on-photo`, the rule-3 glass block)
 *  are parsed from their OWN scope rather than the first global match. */
function block(css: string, head: RegExp): string {
  const m = css.match(new RegExp(head.source + '\\s*\\{([^}]*)\\}', head.flags));
  if (!m) throw new Error(`CSS block ${head} not found`);
  return m[1];
}

// WCAG 2.1 relative luminance + contrast ratio.
const srgbToLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const relLum = ([r, g, b]: RGB) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const BODY_MIN = 4.5;
const LARGE_MIN = 3.0; // large text (>=18.66px bold / >=24px) + UI boundaries

// ── grounds ──
const CARD: RGB = [255, 255, 255];
const BEIGE = token(WD, 'beige');
const TAUPE = token(WD, 'taupe');
const TERMINAL: RGB = [0x13, 0x11, 0x10]; // A18 terminal ground — ladder contract
const GLASS_WORST = token(WD, 'ground-glass-worst');
const PHOTO_WORST = token(WD, 'ground-photo-worst');

// ── base (dark-on-light) text tokens, parsed ──
const INK = token(WD, 'ink');
const BODY = token(WD, 'body');
const MUTED = token(WD, 'muted');
const FAINT = token(WD, 'faint');
const ACCENT = token(WD, 'accent');

// ── on-photo light chrome — PARSED from the .on-photo flip block so a bad edit
//    to the on-dark accent bites here (not a stale hard-coded copy). ──
const ON_PHOTO = block(OP, /\.on-photo/);
const INK_LIGHT: RGB = [255, 255, 255];       // .on-photo --ink (#fff, presence-checked below)
const ACCENT_ON_DARK = token(ON_PHOTO, 'accent'); // .on-photo --accent (light teal #35B8A4)
const TERM_TEXT: RGB = [0xF2, 0xF0, 0xEC];      // A18 terminal text (not in A03 CSS — ladder contract)

// ── glass secondary — PARSED from the rule-3 block. base --faint (#A8A29E) is
//    NON-TEXT; rule 3 DARKENS it to a readable #6B645D specifically so secondary
//    text on a see-through glass ground clears AA. These are the values actually
//    rendered on glass, not the base tokens. ──
const RULE3 = block(OP, /\.on-photo\s*:is\(\.record[^)]*\)/);
const G_BODY = token(RULE3, 'body');   // #1C1917
const G_MUTED = token(RULE3, 'muted'); // #4A443E
const G_FAINT = token(RULE3, 'faint'); // #6B645D (the DARKENED faint — readable)

interface Rung {
  name: string;
  fg: RGB;
  bg: RGB;
  min: number;
}
const LADDER: Rung[] = [
  // dark text on light SOLID grounds (card #FFFFFF, beige #ECE4D5)
  { name: '--ink body/card', fg: INK, bg: CARD, min: BODY_MIN },
  { name: '--ink body/beige', fg: INK, bg: BEIGE, min: BODY_MIN },
  { name: '--body body/card', fg: BODY, bg: CARD, min: BODY_MIN },
  { name: '--muted body/card', fg: MUTED, bg: CARD, min: BODY_MIN },
  { name: '--muted large/beige', fg: MUTED, bg: BEIGE, min: LARGE_MIN },
  { name: '--accent link/card', fg: ACCENT, bg: CARD, min: BODY_MIN },
  { name: '--accent large/beige', fg: ACCENT, bg: BEIGE, min: LARGE_MIN },
  // on a GLASS ground the primary/link tokens are unchanged; secondary text is the
  // darkened rule-3 tokens below (base --muted/--body are never rendered on glass).
  { name: '--ink primary/glass', fg: INK, bg: GLASS_WORST, min: BODY_MIN },
  { name: '--accent link/glass', fg: ACCENT, bg: GLASS_WORST, min: BODY_MIN },
  // light chrome on dark grounds
  { name: 'on-photo --ink body/taupe', fg: INK_LIGHT, bg: TAUPE, min: BODY_MIN },
  { name: 'on-photo --ink body/terminal', fg: INK_LIGHT, bg: TERMINAL, min: BODY_MIN },
  { name: 'accent #35B8A4 large/taupe', fg: ACCENT_ON_DARK, bg: TAUPE, min: LARGE_MIN },
  { name: 'accent #35B8A4 large/terminal', fg: ACCENT_ON_DARK, bg: TERMINAL, min: LARGE_MIN },
  { name: 'terminal #f2f0ec body/terminal', fg: TERM_TEXT, bg: TERMINAL, min: BODY_MIN },
  // rule-3 darkened glass secondary (a glass ground is see-through → lower contrast;
  // these are the READABLE values rendered on glass, distinct from the base tokens)
  { name: 'glass 2ndary rule-3 --body #1C1917', fg: G_BODY, bg: GLASS_WORST, min: BODY_MIN },
  { name: 'glass 2ndary rule-3 --muted #4A443E', fg: G_MUTED, bg: GLASS_WORST, min: BODY_MIN },
  { name: 'glass 2ndary rule-3 --faint #6B645D', fg: G_FAINT, bg: GLASS_WORST, min: BODY_MIN },
];

describe('AA contrast ladder (AC1) — every declared token×ground pair clears its role', () => {
  it.each(LADDER)('$name >= $min:1', ({ fg, bg, min }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('AC1 — the four Fable-B5 failures are FIXED or explicitly RE-ROLED', () => {
  it('brand tag 2.90 — teal-on-dark MUST be #35B8A4, not #0E7A6B (A05 also removes the badge)', () => {
    // The measured failure: --accent #0E7A6B on anthracite #23262C.
    expect(r2(contrast(ACCENT, TAUPE))).toBeLessThan(BODY_MIN); // ~2.90 — the old tag fails
    expect(contrast(ACCENT_ON_DARK, TAUPE)).toBeGreaterThanOrEqual(LARGE_MIN); // fixed
  });

  it('terminal dim 3.65–3.92 — old #78716C fails body; the fix is #f2f0ec on #131110', () => {
    const OLD_DIM: RGB = [0x78, 0x71, 0x6c];
    expect(contrast(OLD_DIM, TERMINAL)).toBeLessThan(BODY_MIN); // ~3.92 — fails as body
    expect(contrast(TERM_TEXT, TERMINAL)).toBeGreaterThanOrEqual(BODY_MIN); // ~16.5 — fixed
  });

  it('--faint 2.52 — RE-ROLED to NON-TEXT (excluded from the ladder body matrix)', () => {
    expect(contrast(FAINT, CARD)).toBeLessThan(BODY_MIN); // 2.52 — proves it is not a text token
    const inLadder = LADDER.some((r) => r.fg === FAINT);
    expect(inLadder, '--faint must NOT appear as a text rung').toBe(false);
  });

  it('dismissed-triage opacity:.6 — replaced by a DEFINED muted token on a SOLID ground', () => {
    // opacity over a photo is not a contrast strategy; --muted on a solid card is.
    expect(contrast(MUTED, CARD)).toBeGreaterThanOrEqual(BODY_MIN); // ~4.79
  });
});

describe('AC1 — grounds are honest', () => {
  it('#35B8A4 (light teal) is NEVER small text on a light ground', () => {
    expect(contrast(ACCENT_ON_DARK, CARD)).toBeLessThan(BODY_MIN); // ~2.46
  });

  it('--ground-photo-worst is a NON-TEXT ground: bare light text fails on the bright photo', () => {
    expect(contrast(INK_LIGHT, PHOTO_WORST)).toBeLessThan(BODY_MIN); // ~1.5 → text must ride chrome
  });

  it('the composite grounds are DERIVED constants committed in weather-deck.css', () => {
    expect(WD).toMatch(/--ground-glass-worst:\s*#[0-9A-Fa-f]{6}/);
    expect(WD).toMatch(/--ground-photo-worst:\s*#[0-9A-Fa-f]{6}/);
  });

  it('the .on-photo flip carries the light chrome + darkened-glass-secondary tokens', () => {
    expect(OP).toMatch(/--ink:\s*#fff/);
    expect(OP).toMatch(/--faint:\s*#6B645D/);
  });
});
