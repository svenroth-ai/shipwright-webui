import '@testing-library/jest-dom';
import { server } from './mocks/server';
import { afterAll, afterEach, beforeAll } from 'vitest';

// jsdom lacks ResizeObserver — assistant-ui's primitives use it via
// useOnResizeContent. A no-op polyfill is enough for rendering tests.
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom also lacks scrollIntoView on Elements for many primitives.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// jsdom lacks Element.scrollTo — assistant-ui's viewport auto-scroll
// invokes it on the scroll container ref.
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Element.prototype.scrollTo = function (..._args: unknown[]) {} as any;
}

// jsdom has no layout, so Range/Text geometry is missing. prosemirror-view
// (tiptap 3's scrollIntoView on a focused command) reads it when it scrolls the
// selection into view; an empty rect list makes that a no-op instead of a throw.
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as unknown as Range['getClientRects'];
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = (() => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })) as unknown as Range['getBoundingClientRect'];
  }
}

// jsdom has no layout. An active EmbeddedTerminal fixture represents a visible
// canvas, so give that single surface a realistic box; `active=false` remains
// the production gate for force-mounted hidden panes.
const nativeBoundingRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.dataset.testid === 'embedded-terminal-canvas') {
    return { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 320,
      width: 640, height: 320, toJSON: () => ({}) } as DOMRect;
  }
  return nativeBoundingRect.call(this);
};

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
