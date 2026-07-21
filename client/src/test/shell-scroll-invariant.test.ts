/*
 * SHELL SCROLL INVARIANT — the title bar must reach the right edge.
 * (iterate-2026-07-21-mac-titlebar-right-clip)
 *
 * THE DEFECT THIS PINS. `.scene-fore` (the shell scroller rendered by
 * SceneBackdrop) used to carry `scrollbar-gutter: stable`. That permanently
 * reserves a scrollbar-wide strip on the RIGHT of the scrollport — and every
 * title bar (`.page-head`, `.mc-top`) is a CHILD of that scrollport, so each one
 * stopped short of the viewport edge while `.scene-bg` (the photo plate, which
 * is absolutely positioned on `.screen` and therefore FULL width) showed through
 * the reserved strip. Sven reported it on macOS Edge + Safari as "the title bar
 * is cut, right hand side, about 5mm"; measured in headed Edge on Windows it is
 * a 15px strip on every route.
 *
 * 15px, not the 6px the app believes it draws: `scrollbar-width: thin` is set on
 * `html, body` in index.css and scrollbar-width DOES NOT INHERIT, so the shell
 * scroller resolves `auto` and reserves the NATIVE width.
 *
 * CHESTERTON-FENCE — why the gutter was there, and why removing it is safe now.
 * PR #8 (iterate 3.8c, April 2026) added it to stop a horizontal "spring" when
 * switching routes: some routes overflowed the shell scroller and some did not,
 * so the content width changed with the scrollbar's presence. That reason was
 * REAL (measured: 15px, not the ~6px the commit message estimated). It is now
 * obsolete because every route bounds its own scrolling BELOW the title bar —
 * Inbox / Projects / Triage / Ship's Log / Diagnostics use a `overflow-y-auto`
 * body, and the Board scrolls inside its columns. Settings was the last route
 * still handing its scroll up to the shell; this iterate gave it the same body.
 *
 * So the two assertions below are a PAIR and must move together:
 *   (1) the shell scroller reserves no gutter  — the fix, and
 *   (2) every PageHead route bounds its own scroll — what makes (1) safe.
 * Deleting (2) silently re-arms the spring that (1) removed the guard for.
 *
 * Behavioural proof lives in e2e/flows/title-bar-full-bleed.spec.ts, which
 * measures the real gap in a real browser. This file is the cheap CI ratchet.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_SRC = join(__dirname, '..');
const PAGES_DIR = join(CLIENT_SRC, 'pages');

/**
 * Registry of the routes that render a full-bleed title bar, mapped to the file
 * that OWNS that route's bounded scroll. Usually the page itself; the Board
 * delegates to its column component, which scrolls per column
 * (`overflow-y-auto`) inside an `overflow-y-hidden` rail. Both drift directions
 * are asserted below (registry -> disk, and disk -> registry) per the
 * registry-driven SSoT meta-test rule.
 */
const TITLE_BAR_ROUTES: Record<string, string[]> = {
  'DiagnosticsPage.tsx': ['pages/DiagnosticsPage.tsx'],
  'InboxPage.tsx': ['pages/InboxPage.tsx'],
  'ProjectsPage.tsx': ['pages/ProjectsPage.tsx'],
  'SettingsPage.tsx': ['pages/SettingsPage.tsx'],
  'ShipsLogPage.tsx': ['pages/ShipsLogPage.tsx'],
  'TriagePage.tsx': ['pages/TriagePage.tsx'],
  // The Board has TWO body modes and needs a bounded scroller in BOTH. A single
  // owner is what let the list view ship unbounded: the registry pointed only at
  // the kanban rail, so `/?view=list` handed its scroll to the shell (measured:
  // overflowed by ~19000px, title bar clipped 15px) while this test stayed green.
  'TaskBoardPage.tsx': ['pages/TaskBoardPage.tsx', 'components/external/TaskBoardColumns.tsx'],
};

/**
 * Files whose `.scene-fore` rules must never re-reserve width. MainLayout passes
 * the utility classes; weather-deck.css DEFINES the scroller and is the natural
 * place someone would "re-stabilise" it; SceneBackdrop composes the class list.
 */
const SHELL_SCROLLER_SOURCES = [
  'layouts/MainLayout.tsx',
  'styles/weather-deck.css',
  'components/common/SceneBackdrop.tsx',
];

/**
 * Both spellings of a permanently reserved gutter. `overflow-y: scroll` is the
 * same defect wearing different clothes: it renders a scrollbar track (and takes
 * its width) whether or not the content overflows.
 */
const RESERVES_WIDTH = /scrollbar-gutter|overflow-y:\s*scroll|overflow-y-scroll/;

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/**
 * Strip comments before asserting on CODE. Without this the rules below trip on
 * their own documentation — the comment in MainLayout.tsx explaining why the
 * gutter must never return necessarily contains the words it bans. Line comments
 * are stripped too, and that direction matters: a leftover
 * `// was: flex-1 overflow-y-auto` would otherwise keep the bounded-scroll
 * assertion green after the real wrapper was deleted.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every `className="..."` literal in a source file.
 *
 * Asserting on WHOLE-FILE text was too weak to mean anything: it only asked
 * "does this file mention an overflow utility somewhere". `TaskBoardColumns.tsx`
 * carries three, so deleting the load-bearing one still left the incidental
 * `overflow-hidden` on a card and the test stayed green. A bounded scroller is
 * one ELEMENT that both takes the remaining height and scrolls, so the tokens
 * have to co-occur on a single element.
 */
function classNames(src: string): string[] {
  return [...code(src).matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
}

/** A single element that both claims the leftover height and scrolls in it. */
function hasBoundedScroller(src: string): boolean {
  return classNames(src).some((cls) => /\bflex-1\b/.test(cls) && /\boverflow-y-(auto|hidden|scroll)\b/.test(cls));
}

describe('shell scroll invariant — the title bar reaches the right edge', () => {
  it('the shell scroller reserves NO width for a scrollbar (it would inset every title bar)', () => {
    for (const rel of SHELL_SCROLLER_SOURCES) {
      const src = code(read(join(CLIENT_SRC, ...rel.split('/'))));
      expect(
        src,
        [
          `${rel} re-introduced permanently reserved width on the shell scroller.`,
          'That strip is subtracted from the scrollport, and .page-head / .mc-top are',
          'INSIDE it — so every title bar stops ~15px short of the viewport edge and the',
          'full-width photo plate shows through. This is the exact defect Sven reported',
          'on macOS ("title bar is cut, right hand side, about 5mm").',
          'Both `scrollbar-gutter: stable` and `overflow-y: scroll` do it.',
          'If a route ever needs a stable width again, bound THAT ROUTE\'s scroll (see the',
          'sibling assertion) rather than reserving width on the shared shell.',
        ].join(' '),
      ).not.toMatch(RESERVES_WIDTH);
    }
  });

  it('every route that renders a title bar bounds its own vertical scroll', () => {
    for (const [page, owners] of Object.entries(TITLE_BAR_ROUTES)) {
      const pagePath = join(PAGES_DIR, page);
      expect(existsSync(pagePath), `registry lists ${page} but it is not on disk`).toBe(true);
      expect(read(pagePath), `${page} is in the title-bar registry but does not render <PageHead`).toMatch(
        /<PageHead/,
      );

      for (const owner of owners) {
        const ownerPath = join(CLIENT_SRC, ...owner.split('/'));
        expect(existsSync(ownerPath), `${page} maps to ${owner}, which is not on disk`).toBe(true);
        expect(
          hasBoundedScroller(read(ownerPath)),
          [
            `${owner} (a scroll owner for ${page}) has no single element that both takes the`,
            'remaining height and scrolls in it, so it hands scrolling up to the shared shell',
            'scroller. That re-arms the cross-route width "spring" PR #8 originally reserved a',
            'scrollbar gutter to hide — and that gutter is exactly what clipped the title bar.',
            'Use the Diagnostics pattern: one element carrying BOTH flex-1 and overflow-y-*,',
            'placed UNDER <PageHead>.',
          ].join(' '),
        ).toBe(true);
      }
    }
  });

  it('no page renders a title bar without being in the registry (reverse drift)', () => {
    const onDisk = readdirSync(PAGES_DIR)
      .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
      .filter((f) => /<PageHead/.test(read(join(PAGES_DIR, f))));

    const missing = onDisk.filter((f) => !(f in TITLE_BAR_ROUTES));
    expect(
      missing,
      `these pages render <PageHead> but are absent from TITLE_BAR_ROUTES: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
