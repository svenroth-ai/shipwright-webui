/*
 * MobileTopBarSlot — AC-1 (iterate-2026-06-15-mobile-tablet-layout-polish).
 * The slot must publish its element via STATE (not a bare ref) so a portal
 * consumer re-renders and mounts into it (plan-review M1). Consumed outside a
 * provider it returns null without crashing.
 */

import { render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, it, expect } from "vitest";

import {
  MobileTopBarSlotProvider,
  MobileTopBarSlotTarget,
  useMobileTopBarSlot,
} from "./MobileTopBarSlot";

function PortalConsumer() {
  const ctx = useMobileTopBarSlot();
  if (!ctx?.slot) return null;
  return createPortal(<div data-testid="injected">dropdown</div>, ctx.slot);
}

describe("MobileTopBarSlot (AC-1)", () => {
  it("publishes the slot element so a portal consumer renders INTO it", async () => {
    render(
      <MobileTopBarSlotProvider>
        <MobileTopBarSlotTarget className="slot" />
        <PortalConsumer />
      </MobileTopBarSlotProvider>,
    );
    const injected = await screen.findByTestId("injected");
    expect(screen.getByTestId("mobile-topbar-slot")).toContainElement(injected);
  });

  it("returns null outside a provider (no crash)", () => {
    function Bare() {
      const ctx = useMobileTopBarSlot();
      return <div data-testid="ctx">{ctx === null ? "null" : "present"}</div>;
    }
    render(<Bare />);
    expect(screen.getByTestId("ctx").textContent).toBe("null");
  });
});
