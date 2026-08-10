import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelTierSummary } from "./ModelTierSummary";

vi.mock("../../hooks/useModelTierConfig", () => ({
  useModelTierConfig: (projectId: string) => ({
    data: projectId === "p-missing" ? {
      tiers: {
        plan_review: { tier: "inherit", source: "unset" },
        review: { tier: "inherit", source: "unset" },
        finalization: { tier: "inherit", source: "unset" },
        execution: { tier: "inherit", source: "unset" },
      },
      warning: "model_config_missing",
    } : projectId === "p-invalid" ? {
      tiers: {
        plan_review: { tier: "inherit", source: "unset" },
        review: { tier: "inherit", source: "unset" },
        finalization: { tier: "inherit", source: "unset" },
        execution: { tier: "inherit", source: "unset" },
      },
      warning: "model_config_invalid",
    } : {
      tiers: {
        plan_review: { tier: "opus", source: "project_config" },
        review: { tier: "opus", source: "project_config" },
        finalization: { tier: "sonnet", source: "project_config" },
        execution: { tier: "sonnet", source: "project_config" },
      },
    },
  }),
}));

describe("ModelTierSummary", () => {
  it("shows all effective role tiers without offering an edit surface", () => {
    render(<QueryClientProvider client={new QueryClient()}><ModelTierSummary projectId="p-1" /></QueryClientProvider>);
    expect(screen.getByTestId("task-model-tier-p-1-plan_review")).toHaveTextContent("opus");
    expect(screen.getByTestId("task-model-tier-p-1-execution")).toHaveTextContent("sonnet");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains when the selected project has no model configuration file", () => {
    render(<QueryClientProvider client={new QueryClient()}><ModelTierSummary projectId="p-missing" /></QueryClientProvider>);

    expect(screen.getByRole("status")).toHaveTextContent("No project model configuration found");
  });

  it("makes an invalid framework config visible", () => {
    render(<QueryClientProvider client={new QueryClient()}><ModelTierSummary projectId="p-invalid" /></QueryClientProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("could not be read");
  });
});
