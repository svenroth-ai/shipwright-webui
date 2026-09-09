import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { CreateMenuSplitButton } from "./CreateMenuSplitButton";
import type { ActionDefinition } from "../../lib/externalApi";

// Radix DropdownMenu needs these jsdom shims to open.
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

const SAMPLE_ACTIONS: ActionDefinition[] = [
  {
    id: "new-task",
    label: "New task",
    kind: "external_launch",
    command_template: "x",
  },
  {
    id: "new-pipeline",
    label: "New pipeline",
    kind: "external_launch",
    command_template: "y",
  },
  {
    id: "new-iterate",
    label: "New iterate",
    kind: "external_launch",
    command_template: "z",
  },
];

describe("CreateMenuSplitButton", () => {
  it("primary click fires the first action", () => {
    const onSelect = vi.fn();
    render(<CreateMenuSplitButton actions={SAMPLE_ACTIONS} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("create-menu-primary"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("new-task");
  });

  // iterate-2026-07-23-intent-launcher-front-door — the dropdown is the front
  // door: Guided leads, the direct actions follow, register-manually closes.
  it("the dropdown leads with Guided and ends with Register manually", async () => {
    render(
      <MemoryRouter>
        <CreateMenuSplitButton actions={SAMPLE_ACTIONS} onSelect={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId("create-menu-caret"));
    const menu = await screen.findByTestId("create-menu-dropdown");
    const guided = within(menu).getByTestId("create-menu-guided");
    const pipeline = within(menu).getByTestId("create-menu-item-new-pipeline");
    const register = within(menu).getByTestId("create-menu-register-manually");
    // Order is load-bearing (AC1): Guided leads, direct actions follow,
    // register-manually closes — a mere presence check would pass on any order.
    expect(
      guided.compareDocumentPosition(pipeline) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      pipeline.compareDocumentPosition(register) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("disables both buttons when isLoading", () => {
    render(
      <CreateMenuSplitButton
        actions={SAMPLE_ACTIONS}
        onSelect={() => {}}
        isLoading
      />,
    );
    expect(
      (screen.getByTestId("create-menu-primary") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("create-menu-caret") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders null-safe when no actions are provided", () => {
    const onSelect = vi.fn();
    render(<CreateMenuSplitButton actions={[]} onSelect={onSelect} />);
    // Primary still renders (as "New"), but clicking is a no-op because the
    // button is disabled via the `!primary` guard.
    const btn = screen.getByTestId("create-menu-primary") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("regression: does NOT listen for `c` or `Shift+C` keys itself", () => {
    // This is a negative assertion: the component attaches NO global key
    // handlers. Verifying that by scanning the source string at module
    // load time is brittle; instead we synthesize the events on the
    // document and assert nothing fires the onSelect prop.
    const onSelect = vi.fn();
    render(<CreateMenuSplitButton actions={SAMPLE_ACTIONS} onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.keyDown(document, { key: "C", shiftKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  // iterate-2026-09-09-phone-touch-targets-plus-cta — mirrors the
  // `mockCompact`/`mockPhone` matchMedia-stub pattern used by
  // TaskDetailHeader.phone.test.tsx; `useIsPhoneViewport()` reads
  // `(max-width: 767px)` directly.
  describe("icon-only on phone (useIsPhoneViewport)", () => {
    function mockPhone(matches: boolean) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 767px)" ? matches : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
    }
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
      vi.restoreAllMocks();
    });

    it("drops the visible label and carries an aria-label instead, on phone", () => {
      mockPhone(true);
      render(<CreateMenuSplitButton actions={SAMPLE_ACTIONS} onSelect={() => {}} />);
      const primary = screen.getByTestId("create-menu-primary");
      expect(primary).toHaveClass("bps-main--icon-only");
      expect(primary).toHaveTextContent("");
      expect(primary).toHaveAccessibleName("New task");
      expect(screen.getByTestId("create-menu-caret")).toHaveClass("bps-caret--touch");
    });

    it("keeps the visible label as the accessible name off phone", () => {
      mockPhone(false);
      render(<CreateMenuSplitButton actions={SAMPLE_ACTIONS} onSelect={() => {}} />);
      const primary = screen.getByTestId("create-menu-primary");
      expect(primary.className).not.toContain("bps-main--icon-only");
      expect(primary).toHaveAccessibleName("New task");
      expect(primary).not.toHaveAttribute("aria-label");
    });

    it("falls back to a real accessible name even when the action label is an empty string", () => {
      mockPhone(true);
      const blankLabelActions: ActionDefinition[] = [
        { ...SAMPLE_ACTIONS[0], label: "" },
      ];
      render(<CreateMenuSplitButton actions={blankLabelActions} onSelect={() => {}} />);
      expect(screen.getByTestId("create-menu-primary")).toHaveAccessibleName("New");
    });
  });
});
