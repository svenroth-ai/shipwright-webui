/*
 * terminal-appearance.test.ts (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44). Exercises the Hono route with an injected reader.
 */

import { describe, expect, it } from "vitest";
import { createTerminalAppearanceRoutes } from "./terminal-appearance.js";

async function get(readClaudeTheme: () => Promise<string | null>) {
  const app = createTerminalAppearanceRoutes({ readClaudeTheme });
  const res = await app.request("/api/terminal/claude-theme");
  return { status: res.status, body: (await res.json()) as { theme: string | null } };
}

describe("GET /api/terminal/claude-theme", () => {
  it("returns the mirrored theme string", async () => {
    const { status, body } = await get(async () => "light-daltonized");
    expect(status).toBe(200);
    expect(body.theme).toBe("light-daltonized");
  });

  it("returns { theme: null } when no theme is resolvable", async () => {
    const { status, body } = await get(async () => null);
    expect(status).toBe(200);
    expect(body.theme).toBeNull();
  });
});
