import { describe, expect, it } from "vitest";

import { createModelConfigRouter } from "./routes.js";

describe("createModelConfigRouter", () => {
  it("returns the selected project's read-only effective tiers", async () => {
    const app = createModelConfigRouter({
      getProjectById: (id) => id === "p-1" ? { id, name: "Project", path: "/project" } : undefined,
      readModelTierConfig: () => ({
        tiers: {
          plan_review: { tier: "opus", source: "project_config" },
          review: { tier: "opus", source: "project_config" },
          finalization: { tier: "sonnet", source: "project_config" },
          execution: { tier: "sonnet", source: "project_config" },
        },
      }),
    });

    const response = await app.request("/api/external/projects/p-1/model-config");
    expect(response.status).toBe(200);
    expect((await response.json()).tiers.review.tier).toBe("opus");
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("does not expose a %s write route", async (method) => {
    const app = createModelConfigRouter({ getProjectById: () => ({ id: "p-1", name: "Project", path: "/project" }) });
    expect((await app.request("/api/external/projects/p-1/model-config", { method })).status).toBe(404);
  });
});
