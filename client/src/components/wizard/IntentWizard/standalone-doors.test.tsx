/**
 * Standalone view: no Intent Wizard doors, only "Register an existing project";
 * the Create menu loses its guided entry; Codex settings collapse on Claude-only.
 * @covers FR-01.51
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { afterEach, describe, expect, it } from "vitest";

import { DoorGrid } from "./DoorGrid";
import { GuidedWizardSection } from "../../external/CreateMenuIntentItems";
import { CodexSettingsCardFields } from "../../settings/CodexSettingsCardFields";
import { setStandaloneViewEnabled } from "../../../lib/standaloneView";
import type { ReadinessState } from "./useReadiness";

const ready: ReadinessState = { report: null, ready: true, loading: false, error: false };

afterEach(() => setStandaloneViewEnabled(false));

describe("Standalone view hides the Intent Wizard", () => {
  // @covers FR-01.51
  it("DoorGrid shows only the Register card", () => {
    setStandaloneViewEnabled(true);
    render(
      <MemoryRouter>
        <DoorGrid readiness={ready} onPickDoor={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("wizard-door-register")).toBeTruthy();
    expect(screen.queryByTestId("wizard-door-new")).toBeNull();
    expect(screen.queryByTestId("wizard-door-adopt")).toBeNull();
    expect(screen.queryByTestId("wizard-door-grade")).toBeNull();
    expect(screen.queryByTestId("wizard-add-existing-line")).toBeNull();
  });

  // @covers FR-01.51
  it("DoorGrid keeps the three doors outside Standalone", () => {
    render(
      <MemoryRouter>
        <DoorGrid readiness={ready} onPickDoor={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("wizard-door-new")).toBeTruthy();
    expect(screen.queryByTestId("wizard-door-register")).toBeNull();
  });

  // @covers FR-01.51
  it("Create menu guided section is omitted in Standalone only", async () => {
    const menu = () => (
      <MemoryRouter>
        <DropdownMenu.Root open>
          <DropdownMenu.Trigger>t</DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <GuidedWizardSection />
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </MemoryRouter>
    );
    const { unmount } = render(menu());
    expect(await screen.findByTestId("create-menu-guided")).toBeTruthy();
    unmount();
    setStandaloneViewEnabled(true);
    render(menu());
    expect(screen.queryByTestId("create-menu-guided")).toBeNull();
    expect(screen.queryByTestId("create-menu-heading")).toBeNull();
  });
});

describe("Codex settings on Claude only", () => {
  const props = {
    runtime: "claude" as const,
    changeRuntime: () => {},
    changeAvailability: () => {},
    integrationMode: "light" as const,
    changeIntegrationMode: () => {},
    port: 1,
    changePort: () => {},
    defaultPort: 1,
    stallMinutes: 15,
    changeStallMinutes: () => {},
    stallError: null,
    minStallTimeoutMinutes: 5,
  };

  // @covers FR-01.51
  it("hides run-mode and stall-timeout sections", () => {
    render(<CodexSettingsCardFields {...props} availability="claude_only" />);
    expect(screen.getByTestId("settings-codex-availability")).toBeTruthy();
    expect(screen.queryByTestId("settings-codex-integration-mode")).toBeNull();
    expect(screen.queryByTestId("settings-codex-stall-timeout")).toBeNull();
  });

  // @covers FR-01.51
  it("shows them when Codex is available", () => {
    render(<CodexSettingsCardFields {...props} availability="both" />);
    expect(screen.getByTestId("settings-codex-integration-mode")).toBeTruthy();
    expect(screen.getByTestId("settings-codex-stall-timeout")).toBeTruthy();
  });
});
