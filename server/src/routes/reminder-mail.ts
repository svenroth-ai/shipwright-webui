/*
 * reminder-mail.ts — Settings routes for the reminder mail (campaign
 * reminders-webui, W4).
 *
 *   GET  /api/reminder-mail        — settings + status; the password is NEVER
 *                                    returned, only `passwordSet: boolean`
 *   PUT  /api/reminder-mail        — save settings; `password` (write-only) is
 *                                    stored in `.env.local`, `clearPassword`
 *                                    removes it, omitting both keeps it
 *   POST /api/reminder-mail/test   — send one fixed sample mail to the saved
 *                                    recipient; the exact failure is returned
 *
 * Guards (same as the W1 reminder routes): a cross-site GET is refused, writes
 * need a JSON content-type (a cross-site "simple" POST would run past CORS).
 */

import { Hono } from "hono";

import type { ReminderMailService } from "../core/reminder-mail/service.js";
import { hasSmtpPassword, loadSettings, parseSettingsBody, saveSettings, writeSmtpPassword } from "../core/reminder-mail/settings.js";

const TEST_MIN_GAP_MS = 3000;

export function createReminderMailRoutes(deps: { dir: string; service: ReminderMailService; now?: () => number }): Hono {
  const app = new Hono();
  const clock = deps.now ?? Date.now;
  let lastTest = 0;

  const view = (): Record<string, unknown> => ({
    settings: loadSettings(deps.dir),
    passwordSet: hasSmtpPassword(deps.dir),
    status: deps.service.getStatus(),
  });

  app.use("/api/reminder-mail", async (c, next) => {
    if (c.req.method === "GET" && c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "cross_site_refused" }, 403);
    if (c.req.method === "PUT" && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ error: "unsupported_media_type" }, 415);
    }
    await next();
  });

  app.get("/api/reminder-mail", (c) => c.json(view()));

  app.put("/api/reminder-mail", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parseSettingsBody(raw);
    if (!parsed.ok) return c.json({ error: "invalid_body", message: parsed.error }, 400);
    // The saved password must never follow a changed server to a new host: type it again.
    const before = loadSettings(deps.dir);
    const s = parsed.settings;
    const serverChanged = before.smtpHost !== s.smtpHost || before.smtpPort !== s.smtpPort || before.smtpUser !== s.smtpUser;
    if (serverChanged && parsed.password.kind === "keep" && hasSmtpPassword(deps.dir) && before.smtpHost !== "") {
      return c.json({ error: "invalid_body", message: "You changed the SMTP server or user name. Enter the password again for the new server (or remove the saved one)." }, 400);
    }
    try {
      if (parsed.password.kind === "set") writeSmtpPassword(deps.dir, parsed.password.value);
      else if (parsed.password.kind === "clear") writeSmtpPassword(deps.dir, null);
      await saveSettings(deps.dir, parsed.settings);
      if (!parsed.settings.enabled) await deps.service.clearError(); // a stale failure must not outlive "mail off"
    } catch (err) {
      // The message of OUR errors (repo refusal) is safe; nothing here ever holds the password text.
      const message = err instanceof Error && err.message.startsWith("The WebUI user folder") ? err.message : "The settings could not be saved.";
      return c.json({ error: "save_failed", message }, 500);
    }
    return c.json(view());
  });

  app.post("/api/reminder-mail/test", async (c) => {
    if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "cross_site_refused" }, 403);
    if (clock() - lastTest < TEST_MIN_GAP_MS) return c.json({ ok: false, error: "Please wait a moment before sending another test mail." }, 429);
    lastTest = clock();
    const r = await deps.service.sendTest();
    return c.json(r.ok ? { ok: true, message: "Test mail sent." } : { ok: false, error: r.error }, r.ok ? 200 : 502);
  });

  return app;
}
