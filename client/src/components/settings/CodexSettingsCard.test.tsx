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
  it("defaults the runtime toggle to Claude when settings.runtimeDefault is unset", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("runtime-claude")).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("reflects a persisted runtimeDefault of codex", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: { runtimeDefault: "codex" } })),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("runtime-codex")).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("saves runtimeDefault when the toggle is switched to Codex", async () => {
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
    await waitFor(() => expect(putBodies).toContainEqual({ runtimeDefault: "codex" }));
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

  it("defaults availability to 'both' and integration mode to 'light' when unset", async () => {
    server.use(http.get("/api/settings", () => HttpResponse.json({ data: {} })));
    renderCard();
    await waitFor(() =>
      expect((screen.getByTestId("settings-codex-availability-select") as HTMLSelectElement).value).toBe(
        "both",
      ),
    );
    expect((screen.getByTestId("settings-codex-integration-mode-select") as HTMLSelectElement).value).toBe(
      "light",
    );
  });

  it("saves codexAvailability when changed", async () => {
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
    const select = await screen.findByTestId("settings-codex-availability-select");
    await user.selectOptions(select, "codex_only");
    await waitFor(() => expect(putBodies).toContainEqual({ codexAvailability: "codex_only" }));
  });

  it("hides the RuntimeToggle behind the fixed pill when availability is not 'both'", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: { codexAvailability: "codex_only" } })),
    );
    renderCard();
    await waitFor(() => expect(screen.getByTestId("runtime-toggle-fixed")).toBeInTheDocument());
    expect(screen.queryByTestId("runtime-toggle")).not.toBeInTheDocument();
  });

  it("does not render the Codextender port input while integration mode is 'light'", async () => {
    server.use(http.get("/api/settings", () => HttpResponse.json({ data: {} })));
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("settings-codex-integration-mode-select")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("settings-codextender-port-input")).not.toBeInTheDocument();
  });

  it("switching integration mode to Codextender reveals the port input, defaulted to 4000", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ data: {} })),
      http.put("/api/settings", async ({ request }) => HttpResponse.json({ data: await request.json() })),
    );
    const user = userEvent.setup();
    renderCard();
    const modeSelect = await screen.findByTestId("settings-codex-integration-mode-select");
    await user.selectOptions(modeSelect, "codextender");
    await waitFor(() =>
      expect((screen.getByTestId("settings-codextender-port-input") as HTMLInputElement).value).toBe(
        "4000",
      ),
    );
  });

  it("reflects a persisted codexIntegrationMode + codextenderPort and saves a port change", async () => {
    const putBodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ data: { codexIntegrationMode: "codextender", codextenderPort: 4100 } }),
      ),
      http.put("/api/settings", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        putBodies.push(body);
        return HttpResponse.json({ data: body });
      }),
    );
    renderCard();
    const portInput = await screen.findByTestId("settings-codextender-port-input");
    expect((portInput as HTMLInputElement).value).toBe("4100");
    fireEvent.change(portInput, { target: { value: "5000" } });
    await waitFor(() => expect(putBodies).toContainEqual({ codextenderPort: 5000 }));
  });

  it("rejects a fractional or out-of-TCP-range port without saving (PR-review comment, iterate-2026-09-23)", async () => {
    const putBodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json({ data: { codexIntegrationMode: "codextender", codextenderPort: 4100 } }),
      ),
      http.put("/api/settings", async ({ request }) => {
        putBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: {} });
      }),
    );
    renderCard();
    const portInput = await screen.findByTestId("settings-codextender-port-input");
    expect((portInput as HTMLInputElement).value).toBe("4100");

    fireEvent.change(portInput, { target: { value: "4000.5" } });
    fireEvent.change(portInput, { target: { value: "65536" } });
    fireEvent.change(portInput, { target: { value: "0" } });

    expect((portInput as HTMLInputElement).value).toBe("4100");
    expect(putBodies.some((b) => "codextenderPort" in b)).toBe(false);
  });
});
