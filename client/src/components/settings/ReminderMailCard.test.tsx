/*
 * ReminderMailCard — mail Settings card (campaign reminders-webui, W4).
 * Off by default, write-only password, exact test-mail failure shown, a failed
 * send is visible, hostile server text stays plain text.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import { MailFailedBanner } from "../../pages/inbox/MailFailedBanner";
import { ReminderMailCard } from "./ReminderMailCard";

afterEach(() => cleanup());

// Fresh random value per run: nothing hardcoded or guessable.
const TYPED = `pw-${crypto.randomUUID()}`;
const SETTINGS = {
  enabled: false, recipient: "", format: "both", summaryTime: "08:00", summaryWhenEmpty: false,
  webuiAddress: "", smtpHost: "", smtpPort: 587, smtpUser: "", checkInterval: "1h",
};
const STATUS = { lastCheckAt: null, lastSent: 0, error: null as null | { at: string; message: string; recipient: string }, notes: [] };
const view = (over: Record<string, unknown> = {}) => ({ settings: SETTINGS, passwordSet: false, status: STATUS, ...over });

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

// @covers FR-01.77
describe("ReminderMailCard", () => {
  it("is off by default and prefills the WebUI address from where the page was opened", async () => {
    server.use(http.get("/api/reminder-mail", () => HttpResponse.json(view())));
    wrap(<ReminderMailCard />);
    const box = await screen.findByTestId("reminder-mail-enabled");
    expect(box).not.toBeChecked();
    expect(screen.getByLabelText(/WebUI address/)).toHaveValue(window.location.origin);
    expect(screen.getByTestId("reminder-mail-password-state")).toHaveTextContent("not set");
  });

  it("saves the settings and sends a typed password only when there is one; never shows it back", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/reminder-mail", () => HttpResponse.json(view())),
      http.put("/api/reminder-mail", async ({ request }) => {
        const b = (await request.json()) as Record<string, unknown>;
        bodies.push(b);
        const { password: _p, clearPassword: _c, ...settings } = b;
        return HttpResponse.json(view({ settings, passwordSet: true }));
      }),
    );
    const user = userEvent.setup();
    wrap(<ReminderMailCard />);
    await screen.findByTestId("reminder-mail-enabled");
    await user.type(screen.getByLabelText("Recipient"), "me@example.org");
    await user.type(screen.getByLabelText("SMTP server"), "smtp.example.org");
    await user.type(screen.getByLabelText("Password"), TYPED);
    await user.click(screen.getByTestId("reminder-mail-save"));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ recipient: "me@example.org", smtpHost: "smtp.example.org", password: TYPED });
    await waitFor(() => expect(screen.getByTestId("reminder-mail-password-state")).toHaveTextContent("set"));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(TYPED);
    // a second save without typing keeps the saved password: no password field in the body
    await user.click(screen.getByTestId("reminder-mail-save"));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).not.toHaveProperty("password");
    expect(bodies[1]).not.toHaveProperty("clearPassword");
  });

  it("can remove the saved password", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/reminder-mail", () => HttpResponse.json(view({ passwordSet: true }))),
      http.put("/api/reminder-mail", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(view());
      }),
    );
    const user = userEvent.setup();
    wrap(<ReminderMailCard />);
    await user.click(await screen.findByTestId("reminder-mail-clear-password"));
    await user.click(screen.getByTestId("reminder-mail-save"));
    await waitFor(() => expect(bodies[0]).toMatchObject({ clearPassword: true }));
  });

  it("shows the server's plain refusal when a save is rejected", async () => {
    server.use(
      http.get("/api/reminder-mail", () => HttpResponse.json(view())),
      http.put("/api/reminder-mail", () => HttpResponse.json({ error: "invalid_body", message: "To turn mail on, fill in: recipient." }, { status: 400 })),
    );
    const user = userEvent.setup();
    wrap(<ReminderMailCard />);
    await user.click(await screen.findByTestId("reminder-mail-enabled"));
    await user.click(screen.getByTestId("reminder-mail-save"));
    expect(await screen.findByText("To turn mail on, fill in: recipient.")).toBeInTheDocument();
  });

  it("test mail saves first, then shows 'Test mail sent' or the exact failure", async () => {
    let ok = true;
    const order: string[] = [];
    server.use(
      http.get("/api/reminder-mail", () => HttpResponse.json(view())),
      http.put("/api/reminder-mail", async ({ request }) => {
        order.push("save");
        return HttpResponse.json(view({ settings: await request.json() }));
      }),
      http.post("/api/reminder-mail/test", () => {
        order.push("test");
        return ok ? HttpResponse.json({ ok: true, message: "Test mail sent." }) : HttpResponse.json({ ok: false, error: "connection refused by smtp.example.org:587" }, { status: 502 });
      }),
    );
    const user = userEvent.setup();
    wrap(<ReminderMailCard />);
    await user.click(await screen.findByTestId("reminder-mail-test"));
    expect(await screen.findByText("Test mail sent.")).toBeInTheDocument();
    expect(order).toEqual(["save", "test"]);
    ok = false;
    await user.click(screen.getByTestId("reminder-mail-test"));
    expect(await screen.findByText("Test mail failed: connection refused by smtp.example.org:587")).toBeInTheDocument();
  });

  it("shows a failed send in the card as plain text", async () => {
    const message = "<img src=x onerror=alert(1)> refused";
    server.use(http.get("/api/reminder-mail", () => HttpResponse.json(view({ settings: { ...SETTINGS, enabled: true, recipient: "me@example.org" }, status: { ...STATUS, error: { at: "t", message, recipient: "me@example.org" } } }))));
    wrap(<ReminderMailCard />);
    const alert = await screen.findByTestId("reminder-mail-last-error");
    expect(alert).toHaveTextContent("Mail to me@example.org failed:");
    expect(alert.querySelector("img")).toBeNull();
    expect(alert).toHaveTextContent(message);
  });
});

// @covers FR-01.77
describe("MailFailedBanner (Inbox, mockup page 06 d)", () => {
  it("is hidden without an error and when mail is off", async () => {
    server.use(http.get("/api/reminder-mail", () => HttpResponse.json(view({ settings: { ...SETTINGS, enabled: false }, status: { ...STATUS, error: { at: "t", message: "x", recipient: "r@e.org" } } }))));
    wrap(<MailFailedBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("inbox-mail-failed")).toBeNull();
  });

  it("says what failed, that the item stays, and links to the mail settings", async () => {
    server.use(http.get("/api/reminder-mail", () => HttpResponse.json(view({ settings: { ...SETTINGS, enabled: true }, status: { ...STATUS, error: { at: "t", message: "connection refused by smtp.example.org:587", recipient: "operator@example.org" } } }))));
    wrap(<MailFailedBanner />);
    const b = await screen.findByTestId("inbox-mail-failed");
    expect(b).toHaveTextContent("Mail to operator@example.org failed: connection refused by smtp.example.org:587");
    expect(b).toHaveTextContent("The item stays in the Inbox");
    expect(b).toHaveTextContent("at most 3 tries per item and day");
    expect(screen.getByTestId("inbox-mail-failed-settings")).toHaveTextContent("Open mail settings");
  });
});
