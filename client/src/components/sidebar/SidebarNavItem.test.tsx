/*
 * SidebarNavItem — AC-6 (iterate-2026-06-15-mobile-tablet-layout-polish).
 * In the 60px icon rail (collapsed) the count badge ("open items") was clipped
 * because it rendered inline after the sr-only label, past the rail edge. It
 * must instead overlay the icon's corner when collapsed, and stay inline when
 * the sidebar is expanded / a drawer.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Inbox } from "lucide-react";
import { describe, it, expect } from "vitest";

import { SidebarNavItem } from "./SidebarNavItem";

function renderItem(collapsed: boolean) {
  return render(
    <MemoryRouter>
      <SidebarNavItem
        icon={Inbox}
        label="Inbox"
        to="/inbox"
        collapsed={collapsed}
        badge={<span data-testid="the-badge">3</span>}
      />
    </MemoryRouter>,
  );
}

describe("SidebarNavItem badge placement (AC-6)", () => {
  it("overlays the badge on the icon when collapsed (rail) so it is not clipped", () => {
    renderItem(true);
    const overlay = screen.getByTestId("sidebar-nav-badge-overlay");
    expect(overlay).toContainElement(screen.getByTestId("the-badge"));
    expect(overlay.className).toContain("absolute");
    // The badge must NOT also be rendered inline (single instance only).
    expect(screen.getAllByTestId("the-badge")).toHaveLength(1);
  });

  it("renders the badge inline (no overlay) when expanded", () => {
    renderItem(false);
    expect(screen.queryByTestId("sidebar-nav-badge-overlay")).toBeNull();
    expect(screen.getByTestId("the-badge")).toBeInTheDocument();
  });
});
