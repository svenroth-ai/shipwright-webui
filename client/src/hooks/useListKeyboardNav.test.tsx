/*
 * useListKeyboardNav — AC4: j/k move a VISIBLE selection; AC1 fence: inert in
 * text entry.
 */
import { render, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListKeyboardNav } from "./useListKeyboardNav";

function Harness({
  enabled = true,
  onLaunch,
}: {
  enabled?: boolean;
  onLaunch?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useListKeyboardNav({ containerRef: ref, itemSelector: "[data-nav-item]", enabled });
  return (
    <div>
      <input data-testid="filter" />
      <div ref={ref} data-testid="list">
        <div data-nav-item tabIndex={0} data-testid="i0">
          zero
          <span data-nav-action="l">
            <button type="button" onClick={onLaunch} data-testid="i0-launch">
              launch
            </button>
          </span>
        </div>
        <div data-nav-item tabIndex={0} data-testid="i1">
          one
        </div>
        <div data-nav-item tabIndex={0} data-testid="i2">
          two
        </div>
      </div>
    </div>
  );
}

function press(el: Element | Document, key: string): boolean {
  const ev = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  const spy = vi.spyOn(ev, "preventDefault");
  el.dispatchEvent(ev);
  return spy.mock.calls.length > 0;
}

function selectedId(): string | null {
  const el = document.querySelector('[data-nav-selected="true"]');
  return el?.getAttribute("data-testid") ?? null;
}

afterEach(() => cleanup());

describe("useListKeyboardNav", () => {
  beforeEach(() => render(<Harness />));

  it("selects the first item on 'j' and moves down", () => {
    press(document.body, "j");
    expect(selectedId()).toBe("i0");
    press(document.body, "j");
    expect(selectedId()).toBe("i1");
  });

  it("moves up on 'k' and clamps at the ends", () => {
    press(document.body, "j");
    press(document.body, "j");
    press(document.body, "k");
    expect(selectedId()).toBe("i0");
    press(document.body, "k");
    expect(selectedId()).toBe("i0"); // clamped
  });

  it("moves DOM focus to the selected item (so its own Enter opens it)", () => {
    press(document.body, "j");
    expect(document.activeElement).toBe(document.querySelector('[data-testid="i0"]'));
  });

  it("supports ArrowDown / ArrowUp as aliases", () => {
    press(document.body, "ArrowDown");
    expect(selectedId()).toBe("i0");
  });

  it("does NOT preventDefault Enter (the item owns Enter)", () => {
    press(document.body, "j");
    const prevented = press(document.querySelector('[data-testid="i0"]')!, "Enter");
    expect(prevented).toBe(false);
  });
});

describe("useListKeyboardNav — quick actions", () => {
  it("a data-nav-action key clicks the matching control inside the selected item", () => {
    const onLaunch = vi.fn();
    render(<Harness onLaunch={onLaunch} />);
    press(document.body, "j"); // select i0 (which owns the launch control)
    const prevented = press(document.querySelector('[data-testid="i0"]')!, "l");
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("leaves an unmatched quick-action key untouched (no preventDefault)", () => {
    render(<Harness />);
    press(document.body, "j");
    press(document.body, "k"); // back to nothing selectable beyond i0
    // 'x' has no matching control → not handled.
    const prevented = press(document.querySelector('[data-testid="i0"]')!, "x");
    expect(prevented).toBe(false);
  });
});

describe("useListKeyboardNav — THE FENCE", () => {
  beforeEach(() => render(<Harness />));

  it("is inert when focus is in an input", () => {
    const input = document.querySelector('[data-testid="filter"]') as HTMLElement;
    input.focus();
    const prevented = press(input, "j");
    expect(selectedId()).toBeNull();
    expect(prevented).toBe(false);
  });
});

describe("useListKeyboardNav — disabled", () => {
  it("does nothing when enabled=false", () => {
    render(<Harness enabled={false} />);
    press(document.body, "j");
    expect(selectedId()).toBeNull();
  });
});
