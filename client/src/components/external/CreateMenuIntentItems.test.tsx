/*
 * Unit tests for the shared Intent-launcher menu affordances
 * (iterate-2026-07-23-intent-launcher-front-door). The two framing rows are the
 * single source of the guided-wizard front door + the register-manually escape
 * hatch; every create surface composes THESE, so this pins their copy + routes.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MemoryRouter } from "react-router-dom";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

import {
  CreateMenuHeading,
  CreateMenuSeparator,
  GuidedWizardMenuItem,
  RegisterManuallyMenuItem,
  GUIDED_WIZARD_ROUTE,
  REGISTER_MANUALLY_ROUTE,
} from "./CreateMenuIntentItems";

function wrap() {
  return render(
    <MemoryRouter>
      <DropdownMenu.Root defaultOpen>
        <DropdownMenu.Trigger>open</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <CreateMenuHeading />
          <GuidedWizardMenuItem />
          <CreateMenuSeparator />
          <RegisterManuallyMenuItem />
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("CreateMenuIntentItems", () => {
  it("routes are the intended app routes", () => {
    expect(GUIDED_WIZARD_ROUTE).toBe("/wizard");
    expect(REGISTER_MANUALLY_ROUTE).toBe("/projects?new=1");
  });

  it("renders the heading + both framing rows with the canonical copy", () => {
    wrap();
    expect(screen.getByTestId("create-menu-heading").textContent).toMatch(
      /start something/i,
    );
    const guided = screen.getByTestId("create-menu-guided");
    expect(guided.textContent).toMatch(/Guided — Intent Wizard/);
    expect(guided.textContent).toMatch(/recommended/i);
    expect(
      screen.getByTestId("create-menu-register-manually").textContent,
    ).toMatch(/Register a project manually/);
  });

  it("Guided navigates to the wizard", () => {
    wrap();
    fireEvent.click(screen.getByTestId("create-menu-guided"));
    expect(navigate).toHaveBeenCalledWith(GUIDED_WIZARD_ROUTE);
  });

  it("Register manually navigates to the projects registration deep-link", () => {
    wrap();
    fireEvent.click(screen.getByTestId("create-menu-register-manually"));
    expect(navigate).toHaveBeenCalledWith(REGISTER_MANUALLY_ROUTE);
  });
});
