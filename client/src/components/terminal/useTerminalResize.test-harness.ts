/*
 * Shared test harness for the useTerminalResize specs.
 *
 * Split out (iterate-2026-06-20-split-useterminalresize-test) so the two test
 * files — `useTerminalResize.test.ts` (safeFit + ResizeObserver/tab-activation)
 * and `useTerminalResize.repaint.test.ts` (visibility/focus repaint +
 * data-driven settle-arm) — each stay under the 300-LOC guideline without
 * duplicating the FakeRO + renderHook scaffolding.
 *
 * jsdom ships no ResizeObserver; `installResizeHarness()` installs a FakeRO that
 * captures the observer callback + exposes a manual trigger, plus the mock
 * term/fit and the `setup` that renders the hook. Call it in `beforeEach`
 * (paired with `vi.useFakeTimers()`); the captured callback resets per install.
 */

import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { useTerminalResize } from "./useTerminalResize";

export function makeTerm(): Terminal {
  return {
    cols: 80,
    rows: 24,
    refresh: vi.fn(),
    _core: {
      _renderService: {
        dimensions: { css: { cell: { width: 7, height: 14 } } },
      },
    },
  } as unknown as Terminal;
}

export function makeFit(): FitAddon {
  return { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() } as unknown as FitAddon;
}

export function setHidden(value: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => value,
  });
}

export interface SetupResult {
  socketSend: ReturnType<typeof vi.fn>;
  settleArm: ReturnType<typeof vi.fn>;
  term: Terminal;
  fit: FitAddon;
  disposed: { current: boolean };
  rerender: (active: boolean) => void;
  unmount: () => void;
}

export interface ResizeHarness {
  /** Invoke the captured ResizeObserver callback (manual throttle driver). */
  triggerRO: () => void;
  /** The FakeRO `observe` spy from the most recent hook mount (or null). */
  getROObserve: () => ReturnType<typeof vi.fn> | null;
  /** The FakeRO `disconnect` spy from the most recent hook mount (or null). */
  getRODisconnect: () => ReturnType<typeof vi.fn> | null;
  /** Render the hook with an initial `active` value. */
  setup: (initialActive: boolean) => SetupResult;
}

export function installResizeHarness(): ResizeHarness {
  let cb: (() => void) | null = null;
  let observe: ReturnType<typeof vi.fn> | null = null;
  let disconnect: ReturnType<typeof vi.fn> | null = null;

  class FakeRO {
    constructor(c: () => void) {
      cb = c;
    }
    observe = (observe = vi.fn());
    unobserve = vi.fn();
    disconnect = (disconnect = vi.fn());
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;

  const setup = (initialActive: boolean): SetupResult => {
    const socketSend = vi.fn();
    const settleArm = vi.fn();
    const term = makeTerm();
    const fit = makeFit();
    const disposed = { current: false };
    const container = document.createElement("div");

    const { rerender, unmount } = renderHook(
      (props: { active: boolean }) => {
        const containerRef = useRef<HTMLDivElement | null>(container);
        const termRef = useRef<Terminal | null>(term);
        const fitAddonRef = useRef<FitAddon | null>(fit);
        const disposedRef = useRef<boolean>(disposed.current);
        const settleArmRef = useRef<(() => void) | null>(settleArm);
        // Sync the disposed flag into the ref the hook sees.
        disposedRef.current = disposed.current;
        useTerminalResize({
          containerRef,
          termRef,
          fitAddonRef,
          disposedRef,
          socketSend,
          active: props.active,
          settleArmRef,
        });
      },
      { initialProps: { active: initialActive } },
    );

    return {
      socketSend,
      settleArm,
      term,
      fit,
      disposed,
      rerender: (active: boolean) => rerender({ active }),
      unmount,
    };
  };

  return {
    triggerRO: () => cb?.(),
    getROObserve: () => observe,
    getRODisconnect: () => disconnect,
    setup,
  };
}
