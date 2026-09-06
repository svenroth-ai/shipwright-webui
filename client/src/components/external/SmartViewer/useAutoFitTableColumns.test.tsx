/*
 * useAutoFitTableColumns.test — DOM-layer wiring for tableAutoFit.ts. jsdom
 * has no real layout engine, so `getBoundingClientRect` is mocked to a
 * deterministic function of the cell's own text length (long free-text
 * content measures wide, short enum-like content measures narrow) — the
 * pure sizing decisions themselves are covered exhaustively in
 * tableAutoFit.test.ts; this file only proves the hook wires the DOM
 * correctly (colgroup applied/skipped, re-measured on resize).
 */
import { useRef } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { useAutoFitTableColumns } from "./useAutoFitTableColumns";

type ROCallback = () => void;
let capturedCallbacks: ROCallback[] = [];
let originalResizeObserver: typeof ResizeObserver | undefined;

class MockResizeObserver {
  constructor(cb: ROCallback) {
    capturedCallbacks.push(cb);
  }
  observe = () => {};
  unobserve = () => {};
  disconnect = () => {};
}

function LONG_TEXT(n: number) {
  return "word ".repeat(n).trim();
}

function TestHarness({
  headers,
  widthBox,
  scoped = true,
}: {
  headers: string[];
  widthBox: { current: number };
  scoped?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAutoFitTableColumns(ref, [headers.join("|")]);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) {
          Object.defineProperty(el, "clientWidth", {
            configurable: true,
            get: () => widthBox.current,
          });
        }
      }}
      data-testid="container"
      className={scoped ? "smart-viewer-markdown" : undefined}
    >
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {headers.map((h) => (
              <td key={h}>{h}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

describe("useAutoFitTableColumns", () => {
  beforeEach(() => {
    capturedCallbacks = [];
    originalResizeObserver = globalThis.ResizeObserver as typeof ResizeObserver | undefined;
    (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    // deterministic "measured width" = 8px per character, floor 20px.
    // setup.ts overwrites HTMLElement.prototype.getBoundingClientRect directly
    // (not via a spy), which shadows anything patched on Element.prototype —
    // the mock here has to target the same own-property setup.ts created.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = Math.max(20, (this.textContent ?? "").length * 8);
      return {
        width,
        height: 20,
        top: 0,
        left: 0,
        bottom: 20,
        right: width,
        x: 0,
        y: 0,
        toJSON() {
          return this;
        },
      } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalResizeObserver) {
      (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
        originalResizeObserver;
    }
    document.body.innerHTML = "";
  });

  it("adds a <colgroup> with explicit widths when one column is free text", async () => {
    const { container } = render(
      <TestHarness headers={["ID", LONG_TEXT(80)]} widthBox={{ current: 1000 }} />,
    );
    await waitFor(() => {
      expect(container.querySelector("table > colgroup")).toBeTruthy();
    });
    const cols = container.querySelectorAll("table > colgroup > col");
    expect(cols).toHaveLength(2);
    // "ID" = 2 chars * 8 = 16, floored to the 20px mock minimum, +1px safety margin.
    expect(cols[0]).toHaveStyle({ width: "21px" });
  });

  it("leaves the table untouched when every column is already short", async () => {
    const { container } = render(
      <TestHarness headers={["ID", "Area", "Priority"]} widthBox={{ current: 1000 }} />,
    );
    await waitFor(() => {
      // give the effect a tick to run before asserting absence
      expect(container.querySelector("table")).toBeTruthy();
    });
    expect(container.querySelector("table > colgroup")).toBeNull();
  });

  it("re-measures on ResizeObserver callback and picks up the NEW container width", async () => {
    const widthBox = { current: 1000 };
    const { container } = render(
      <TestHarness headers={["ID", LONG_TEXT(80)]} widthBox={widthBox} />,
    );
    await waitFor(() => {
      expect(container.querySelector("table > colgroup")).toBeTruthy();
    });
    const widthBefore = container.querySelector<HTMLElement>("table > colgroup > col:last-child")!
      .style.width;
    expect(capturedCallbacks.length).toBeGreaterThan(0);

    // Narrow the pane, then fire the observer callback the same way a real
    // resize would — if the callback were a no-op, the flex column's width
    // would stay exactly what it was before.
    widthBox.current = 400;
    capturedCallbacks.forEach((cb) => cb());

    await waitFor(() => {
      const widthAfter = container.querySelector<HTMLElement>(
        "table > colgroup > col:last-child",
      )!.style.width;
      expect(widthAfter).not.toBe(widthBefore);
    });
  });

  it("is a no-op outside a .smart-viewer-markdown ancestor (shared DocumentMarkdown consumers)", async () => {
    const { container } = render(
      <TestHarness headers={["ID", LONG_TEXT(80)]} widthBox={{ current: 1000 }} scoped={false} />,
    );
    // give the effect a tick to run before asserting absence
    await waitFor(() => {
      expect(container.querySelector("table")).toBeTruthy();
    });
    expect(container.querySelector("table > colgroup")).toBeNull();
    expect(container.querySelector("table")?.style.tableLayout).toBe("");
    // Not just the callback — no ResizeObserver is installed at all outside scope.
    expect(capturedCallbacks).toHaveLength(0);
  });
});
