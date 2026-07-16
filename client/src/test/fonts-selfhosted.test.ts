/*
 * FONTS ARE SELF-HOSTED (A05, AC4) — the static half of the guarantee.
 *
 * The runtime half (zero fonts.googleapis/gstatic REQUESTS on load, and Geist
 * Mono actually resolving inside the pinned Playwright container) is the
 * network/computed-style probe in e2e/visual/04-chrome-a05.spec.ts. This meta
 * test locks the SOURCE facts so a future edit can't quietly re-add the CDN:
 *   - index.html carries no Google-Fonts <link>/preconnect.
 *   - main.tsx imports both @fontsource-variable faces.
 *   - --font-mono is defined for real (the pre-existing orphan is killed by
 *     tokens.no-dead-vars.test.ts; here we assert the definition exists).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(path.join(CLIENT, rel), 'utf8');

describe('AC4 — fonts self-hosted (static source facts)', () => {
  it('index.html has NO Google-Fonts CDN link or preconnect', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('main.tsx imports both self-hosted variable faces', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/@fontsource-variable\/inter/);
    expect(main).toMatch(/@fontsource-variable\/geist-mono/);
  });

  it('the packages are real dependencies (not a dangling import)', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@fontsource-variable/inter']).toBeDefined();
    expect(pkg.dependencies['@fontsource-variable/geist-mono']).toBeDefined();
  });

  it('--font-mono is defined for real (Tailwind @theme), wired to --mono', () => {
    const wd = read('src/styles/weather-deck.css');
    expect(wd).toMatch(/--font-mono:\s*var\(--mono\)/);
    // --mono itself resolves to the self-hosted Geist Mono family.
    expect(wd).toMatch(/--mono:\s*'Geist Mono Variable'/);
    expect(wd).toMatch(/--sans:\s*'Inter Variable'/);
  });
});
