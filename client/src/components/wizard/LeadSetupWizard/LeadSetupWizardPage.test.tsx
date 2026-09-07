/*
 * LeadSetupWizardPage.test.tsx — CI diff-coverage gap fix (Diff coverage
 * gate, iterate-2026-09-07-leadwright-setup-wizard). Route host is a thin
 * wrapper (CSS side-effect imports + the wizard mount); the wizard itself
 * is mocked so this file stays about the host, not the wizard's internals.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import LeadSetupWizardPage from "./LeadSetupWizardPage";

vi.mock("./LeadSetupWizard", () => ({
  LeadSetupWizard: () => <div data-testid="mock-lead-setup-wizard" />,
}));

afterEach(cleanup);

describe("LeadSetupWizardPage", () => {
  it("mounts the LeadSetupWizard", () => {
    render(<LeadSetupWizardPage />);
    expect(screen.getByTestId("mock-lead-setup-wizard")).toBeInTheDocument();
  });
});
