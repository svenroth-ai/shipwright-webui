/*
 * CodexSettingsCard.test.tsx — Codex Light AC1/AC5: the global runtime
 * default + stall-timeout Settings controls.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import { CodexSettingsCard } from "./CodexSettingsCard";

afterEach(() => cleanup());

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CodexSettingsCard />
    </QueryClientProvider>,
  );
}

describe("CodexSettingsCard", () => {
  it("defaults the runtime toggle to Claude when settings.codexRuntimeDefault is unset", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("runtime-claude")).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("reflects a persisted codexRuntimeDefault of codex", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: { codexRuntimeDefault: "codex" } })),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("runtime-codex")).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("saves codexRuntimeDefault when the toggle is switched to Codex", async () => {
    const putBodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
      http.put("/api/settings", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        putBodies.push(body);
        return HttpResponse.json({ data: body });
      }),
    );
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByTestId("runtime-toggle")).toBeInTheDocument());
    await user.click(screen.getByTestId("runtime-codex"));
    await waitFor(() => expect(putBodies).toContainEqual({ codexRuntimeDefault: "codex" }));
  });

  it("defaults the stall-timeout input to 15 minutes when unset", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
    );
    renderCard();
    await waitFor(() =>
      expect((screen.getByTestId("settings-codex-stall-timeout-input") as HTMLInputElement).value).toBe("15"),
    );
  });

  it("reflects a persisted stall-timeout value", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: { codexStallTimeoutMinutes: 20 } })),
    );
    renderCard();
    await waitFor(() =>
      expect((screen.getByTestId("settings-codex-stall-timeout-input") as HTMLInputElement).value).toBe("20"),
    );
  });

  it("saves a valid stall-timeout change", async () => {
    const putBodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
      http.put("/api/settings", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        putBodies.push(body);
        return HttpResponse.json({ data: body });
      }),
    );
    renderCard();
    const input = await screen.findByTestId("settings-codex-stall-timeout-input");
    fireEvent.change(input, { target: { value: "30" } });
    await waitFor(() => expect(putBodies).toContainEqual({ codexStallTimeoutMinutes: 30 }));
  });

  it("shows an inline error and does NOT save a value below the 5-minute floor", async () => {
    const putBodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
      http.put("/api/settings", async ({ request }) => {
        putBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: {} });
      }),
    );
    renderCard();
    const input = await screen.findByTestId("settings-codex-stall-timeout-input");
    fireEvent.change(input, { target: { value: "2" } });
    await waitFor(() =>
      expect(screen.getByTestId("settings-codex-stall-timeout-error")).toHaveTextContent("Minimum is 5"),
    );
    expect(putBodies.some((b) => "codexStallTimeoutMinutes" in b)).toBe(false);
  });
});
