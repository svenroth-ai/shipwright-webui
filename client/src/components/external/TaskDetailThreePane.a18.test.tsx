/*
 * A18 — three-card Files & Terminal: no-remount (AC4) + surface fences (AC5).
 *
 * The middle card hosts the REAL live pty. The restyle reflows with CSS; it must
 * NEVER unmount / re-key / re-parent the center subtree, or the pty session dies.
 * This proves the shell preserves a stable center instance across EVERY layout
 * transition the restyle introduces: collapse, MAXIMIZE (focus mode), and a
 * keyboard splitter nudge. A sentinel child (mount/unmount counter) stands in for
 * the terminal; the E2E flow proves the REAL pty survives the same transitions.
 *
 * AC5 surface fences are asserted against the shipped CSS: the middle card is
 * SOLID beige (`backdrop-filter: none`), the sides are glass — "glass on the
 * middle card is a bug".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { TaskDetailThreePane } from "./TaskDetailThreePane";
import { useFocusMode } from "./focus-mode-context";

let mounts = 0;
let unmounts = 0;

// A stand-in for the terminal subtree: it counts its own mount/unmount and
// consumes the focus context the shell provides so the test can drive maximize
// from INSIDE the center (exactly where the real maximize button lives).
function CenterSentinel() {
  const { maximized, toggle } = useFocusMode();
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  return (
    <div data-testid="center-sentinel" data-maximized={maximized || undefined}>
      <button type="button" data-testid="drive-maximize" onClick={toggle}>
        toggle
      </button>
    </div>
  );
}

function fireKey(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("A18 no-remount (AC4) — the center subtree survives every transition", () => {
  beforeEach(() => {
    localStorage.clear();
    mounts = 0;
    unmounts = 0;
  });

  it("mounts the center exactly once and never unmounts it across collapse / maximize / drag", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1280}
        left={<div data-testid="slot-left" />}
        center={<CenterSentinel />}
        right={<div data-testid="slot-right" />}
      />,
    );

    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    // Capture the exact DOM node: React reuses the same fiber → same node iff
    // the subtree is never remounted. Any dispose/recreate swaps the node.
    const node0 = screen.getByTestId("center-sentinel");

    // 1. Collapse the left side card (Enter on the splitter).
    fireKey(screen.getByTestId("splitter-left"), "Enter");
    expect(screen.getByTestId("center-sentinel")).toBe(node0);

    // 2. Enter maximize (focus mode) from inside the center.
    act(() => {
      fireEvent.click(screen.getByTestId("drive-maximize"));
    });
    expect(screen.getByTestId("three-pane-root").getAttribute("data-maximized")).toBe("true");
    expect(screen.getByTestId("center-sentinel").getAttribute("data-maximized")).toBe("true");
    expect(screen.getByTestId("center-sentinel")).toBe(node0);

    // 3. Leave maximize.
    act(() => {
      fireEvent.click(screen.getByTestId("drive-maximize"));
    });
    expect(screen.getByTestId("three-pane-root").getAttribute("data-maximized")).toBeNull();

    // 4. Keyboard splitter nudge (a resize).
    fireKey(screen.getByTestId("splitter-left"), "ArrowRight");

    // Through ALL of the above: ONE construction, ZERO destructions, SAME node.
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(screen.getByTestId("center-sentinel")).toBe(node0);
  });

  it("a keyboard splitter nudge WHILE maximized does not mutate saved widths (external review, medium)", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1280}
        left={<div />}
        center={<CenterSentinel />}
        right={<div />}
      />,
    );
    const splitter = screen.getByTestId("splitter-left");
    const before = splitter.getAttribute("aria-valuenow");
    act(() => {
      fireEvent.click(screen.getByTestId("drive-maximize"));
    });
    // Dispatch the nudge directly (bypassing the display:none focus barrier) —
    // the handler's maximize guard must no-op it.
    fireKey(splitter, "ArrowRight");
    fireKey(splitter, "ArrowRight");
    act(() => {
      fireEvent.click(screen.getByTestId("drive-maximize"));
    });
    expect(screen.getByTestId("splitter-left").getAttribute("aria-valuenow")).toBe(before);
  });

  it("maximize fully collapses both sides (data-collapsed on both panes)", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1280}
        left={<div />}
        center={<CenterSentinel />}
        right={<div />}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("drive-maximize"));
    });
    expect(screen.getByTestId("pane-left").getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("pane-right").getAttribute("data-collapsed")).toBe("true");
  });
});

describe("A18 surface fences (AC5) — middle SOLID beige, sides glass", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url)); // client/src/components/external
  const stylesDir = path.join(dir, "..", "..", "styles");
  const ft = readFileSync(path.join(stylesDir, "files-terminal.css"), "utf8");
  const wd = readFileSync(path.join(stylesDir, "weather-deck.css"), "utf8");

  it("defines the --surface-reading beige token (single source: --beige)", () => {
    expect(wd).toMatch(/--surface-reading:\s*var\(--beige\)/);
    expect(wd).toMatch(/--beige:\s*#ECE4D5/i);
  });

  it("the on-photo Files/Preview cards are GLASS", () => {
    const onPhotoCard = ft.slice(ft.indexOf(".on-photo .ft-card"));
    expect(onPhotoCard).toMatch(/backdrop-filter:\s*var\(--glass-filter\)/);
    expect(onPhotoCard).toMatch(/background:\s*var\(--glass-light\)/);
  });

  it("the middle .ft-term card is SOLID beige with NO backdrop-filter (glass on the middle is a bug)", () => {
    const term = ft.slice(ft.indexOf(".on-photo .ft-term"), ft.indexOf("}", ft.indexOf(".on-photo .ft-term")));
    expect(term).toMatch(/background:\s*var\(--surface-reading\)/);
    expect(term).toMatch(/backdrop-filter:\s*none/);
    expect(term).not.toMatch(/var\(--glass-filter\)/);
  });

  it("the .ft-head is a greyed band the segmented tabs sit inside", () => {
    expect(ft).toMatch(/\.ft-head\s*\{/);
    expect(ft).toMatch(/\.on-photo \.ft-head\s*\{[^}]*rgba\(41,\s*37,\s*34/);
    // The ft-seg segmented variant is the Transcript/Terminal + file-tab style.
    expect(ft).toMatch(/\.mc-tabs\.ft-seg/);
  });
});
