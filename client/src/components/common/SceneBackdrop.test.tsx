/*
 * SceneBackdrop — DOM contract + the RETRACTED-attribute guard (A03, FR-01.48, AC3).
 *
 * The imagery tier/band model (`data-scene-tier`, `data-depth="band"`) is
 * withdrawn (proposal §5.1). Dialing the photo back turns the white glass cards
 * white-on-white — they only pop on the photo. This guard fails if either
 * retracted attribute reappears in the rendered scene OR anywhere in source.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SceneBackdrop } from './SceneBackdrop';

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <SceneBackdrop>
        <div data-testid="page">page</div>
      </SceneBackdrop>
    </MemoryRouter>,
  );
}

describe('SceneBackdrop — applyScene() DOM contract', () => {
  it('emits the frozen plate + scrolling fore with the signature backdrop', () => {
    const { getByTestId, container } = renderAt('/');
    const screen = getByTestId('scene-backdrop');
    expect(screen.getAttribute('data-scene')).toBe('deck');
    expect(screen.getAttribute('data-depth')).toBe('immersive');

    const img = container.querySelector('.scene-bg > img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/backdrops/deck-golden.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');

    // .scene-fore is the scroller and keeps the main-scroll-container contract.
    const fore = getByTestId('main-scroll-container');
    expect(fore.className).toContain('scene-fore');
    expect(fore.className).toContain('on-photo');
    expect(fore).toContainElement(getByTestId('page'));
  });

  it('the wizard route carries well-left; other routes do not', () => {
    const wizard = renderAt('/wizard');
    expect(wizard.container.querySelector('.scene-bg')?.className).toContain('well-left');
    const board = renderAt('/');
    expect(board.container.querySelector('.scene-bg')?.className).not.toContain('well-left');
  });
});

describe('AC3 — the RETRACTED imagery tier/band model is absent', () => {
  it('the rendered scene emits NO data-scene-tier and NO data-depth="band"', () => {
    const { container } = renderAt('/');
    expect(container.querySelector('[data-scene-tier]')).toBeNull();
    expect(container.querySelector('[data-depth="band"]')).toBeNull();
  });

  it('no data-scene-tier / data-depth="band" anywhere in client/src (source guard)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(css|ts|tsx)$/.test(entry) && p !== fileURLToPath(import.meta.url)) {
          // Strip comments so a docstring saying "DO NOT emit data-scene-tier"
          // is not itself flagged — the guard catches live emission, not docs.
          const t = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
          if (/data-scene-tier/.test(t) || /data-depth\s*=\s*["']band["']/.test(t)) {
            offenders.push(path.relative(root, p));
          }
        }
      }
    };
    walk(root);
    expect(offenders, `retracted scene attributes found in:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
