/*
 * reminder-mail-wiring.ts — the few lines `index.ts` needs (it sits at its bloat
 * baseline): build the service, mount the Settings routes, start the timer.
 * The mail code itself lives in `core/reminder-mail/`.
 */

import type { Hono } from "hono";

import { getConfig } from "../config.js";
import { runReminderDue } from "../core/reminder-cli-runner.js";
import { ReminderMailService } from "../core/reminder-mail/service.js";
import { loadSettings } from "../core/reminder-mail/settings.js";
import { startReminderMailTimer, type MailTimer } from "../core/reminder-mail/timer.js";
import { nodemailerTransport } from "../core/reminder-mail/transport.js";
import { createReminderMailRoutes } from "./reminder-mail.js";
import { createReminderRoutes, type ReminderRoutesDeps } from "./reminders.js";

export function mountReminders(app: Hono, projects: ReminderRoutesDeps["projects"]): MailTimer {
  const dir = getConfig().registryDir;
  const log = (line: Record<string, unknown>): void => console.warn(JSON.stringify(line));
  const service = new ReminderMailService({ dir, listProjects: () => projects.getAll(), readDue: (p) => runReminderDue(p), makeTransport: nodemailerTransport, log });
  app.route("/", createReminderRoutes({ projects }));
  app.route("/", createReminderMailRoutes({ dir, service }));
  // First check 20 s after start: a boot that dies early (port already taken) must not claim a mail it never sends.
  const timer = startReminderMailTimer({ run: () => service.runCheck(), getSchedule: () => loadSettings(dir), log, initialDelayMs: 20_000 });
  // No new check once the server is shutting down.
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => timer.stop());
  return timer;
}
