import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Weather-Deck scene layer (A03, FR-01.48).
 *
 * Reproduces the prototype `applyScene()` DOM contract (Spec/prototype/app.js:230)
 * verbatim:
 *   <div class="screen" data-scene="deck" data-depth="immersive">
 *     <div class="scene-bg"><img loading="lazy" decoding="async"></div>
 *     <div class="scene-fore on-photo">{children}</div>
 *   </div>
 *
 * Layering (styled in weather-deck.css): the plate (photo) is position:absolute
 * and FROZEN — only `.scene-fore` scrolls, so the backdrop never repaints on
 * scroll. `.on-photo` flips bare-chrome tokens light while solid surfaces reset
 * back to dark-on-white (on-photo.css).
 *
 * DO NOT emit `data-scene-tier`; DO NOT set `data-depth="band"`. The imagery
 * tier/band model is RETRACTED (guard test: SceneBackdrop.test.tsx).
 */

interface Backdrop {
  /** File under client/public/backdrops/ (Vite serves it at the web root). */
  img: string;
  /** Wizard-style left-weighted scrim (→ `.scene-bg.well-left`). */
  well?: boolean;
}

/**
 * ONE signature backdrop on every route — the Apple Liquid-Glass model decided by
 * Sven 2026-07-14 (Spec/prototype/app.js BACKDROPS, lines 216–229). Kept a map even
 * though every value is uniform today: it is the seam First Contact's own hero
 * (lighthouse.jpg) plugs into when A08 builds that route.
 */
const BACKDROPS: Record<string, Backdrop> = {
  board: { img: 'deck-golden.jpg' },
  tasks: { img: 'deck-golden.jpg' },
  projects: { img: 'deck-golden.jpg' },
  inbox: { img: 'deck-golden.jpg' },
  triage: { img: 'deck-golden.jpg' },
  settings: { img: 'deck-golden.jpg' },
  diagnostics: { img: 'deck-golden.jpg' },
  wizard: { img: 'deck-golden.jpg', well: true },
  // First Contact's OWN hero plate — the lighthouse, exempt from the deck-golden
  // signature backdrop (iterate-2026-07-23-first-contact-hero, FR-01.51). The
  // left-weighted `well` scrim darkens the left so the white hero copy stays
  // legible; the doors below are the wizard's white .wz-opt cards.
  'first-contact': { img: 'lighthouse.jpg', well: true },
};

const DEFAULT_BACKDROP: Backdrop = { img: 'deck-golden.jpg' };

/** First path segment → BACKDROPS key ('' → board). */
function routeKey(pathname: string): string {
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  return seg === '' ? 'board' : seg;
}

export function SceneBackdrop({
  children,
  className,
}: {
  children: ReactNode;
  /** Utility classes for the scrolling `.scene-fore` (safe-area inset, gutter, …). */
  className?: string;
}) {
  const { pathname } = useLocation();
  const backdrop = BACKDROPS[routeKey(pathname)] ?? DEFAULT_BACKDROP;
  return (
    <div
      className="screen flex min-h-0 flex-1 flex-col"
      data-scene="deck"
      data-depth="immersive"
      data-testid="scene-backdrop"
    >
      <div className={`scene-bg${backdrop.well ? ' well-left' : ''}`} aria-hidden="true">
        <img src={`/backdrops/${backdrop.img}`} alt="" loading="lazy" decoding="async" />
      </div>
      <div
        className={`scene-fore on-photo${className ? ` ${className}` : ''}`}
        data-testid="main-scroll-container"
      >
        {children}
      </div>
    </div>
  );
}
