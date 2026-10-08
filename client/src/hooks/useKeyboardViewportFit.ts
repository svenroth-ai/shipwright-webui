import { useEffect } from 'react';

/**
 * Keep the app shell inside the VISIBLE viewport while a soft keyboard is up.
 *
 * Why this exists: on iOS Safari (and Chrome/Android since 108's
 * `interactive-widget=resizes-visual` default) the on-screen keyboard shrinks
 * only the *visual* viewport. The layout viewport — and therefore `100dvh` —
 * stays full-height, so the keyboard simply covered the bottom of the app and
 * the browser panned the page up to reveal the caret, dragging the whole shell
 * (title bar included) out of view. The terminal then showed little more than
 * the line being typed.
 *
 * What it does (coarse pointers only — a desktop never has a soft keyboard):
 *  - mirrors `visualViewport.height` / `.offsetTop` into `--app-vh` / `--app-top`
 *    on `<html>`; `styles/keyboard-fit.css` sizes the shell from them,
 *  - sets `data-kbd-open` while the keyboard is up (visual viewport at least
 *    {@link KEYBOARD_MIN_PX} shorter than the layout viewport — URL-bar
 *    collapse is ~50–100px and must not count),
 *  - sets `data-kbd-terminal` when the focused element lives in the embedded
 *    terminal, so the CSS can additionally fold away the page chrome and hand
 *    the terminal every remaining pixel.
 * The terminal's own ResizeObserver refits xterm when its box changes.
 */
export const KEYBOARD_MIN_PX = 140;

interface FitState {
  open: boolean;
  terminal: boolean;
  height: number;
  top: number;
}

/** Pure decision, exported for unit tests. */
export function computeKeyboardFit(
  layoutHeight: number,
  vvHeight: number,
  vvOffsetTop: number,
  terminalFocused: boolean,
  scale = 1,
): FitState {
  // Pinch-zoom also shrinks visualViewport.height (innerHeight / scale) — that
  // is not a keyboard, so only an unzoomed visual viewport can report one.
  const open = scale <= 1.01 && layoutHeight - vvHeight >= KEYBOARD_MIN_PX;
  return {
    open,
    terminal: open && terminalFocused,
    height: Math.round(vvHeight),
    top: Math.max(0, Math.round(vvOffsetTop)),
  };
}

function inTerminal(el: Element | null): boolean {
  return Boolean(el && el.closest('[data-testid="embedded-terminal"]'));
}

export function useKeyboardViewportFit(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const root = document.documentElement;

    const apply = () => {
      const fit = computeKeyboardFit(
        window.innerHeight,
        vv.height,
        vv.offsetTop,
        inTerminal(document.activeElement),
        vv.scale,
      );
      if (fit.open) {
        root.style.setProperty('--app-vh', `${fit.height}px`);
        root.style.setProperty('--app-top', `${fit.top}px`);
        root.setAttribute('data-kbd-open', '');
        // Only a panned visual viewport needs the shell translated; a transform
        // is also a containing block for fixed descendants, so avoid it at 0.
        if (fit.top > 0) root.setAttribute('data-kbd-pan', '');
        else root.removeAttribute('data-kbd-pan');
      } else {
        root.style.removeProperty('--app-vh');
        root.style.removeProperty('--app-top');
        root.removeAttribute('data-kbd-open');
        root.removeAttribute('data-kbd-pan');
      }
      if (fit.terminal) root.setAttribute('data-kbd-terminal', '');
      else root.removeAttribute('data-kbd-terminal');
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    document.addEventListener('focusin', apply);
    document.addEventListener('focusout', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.removeEventListener('focusin', apply);
      document.removeEventListener('focusout', apply);
      root.style.removeProperty('--app-vh');
      root.style.removeProperty('--app-top');
      root.removeAttribute('data-kbd-open');
      root.removeAttribute('data-kbd-pan');
      root.removeAttribute('data-kbd-terminal');
    };
  }, []);
}
