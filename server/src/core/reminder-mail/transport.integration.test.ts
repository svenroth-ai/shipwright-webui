/*
 * The REAL nodemailer transport against a loopback fake SMTP server: the mail
 * actually crosses a socket, so the headers, the plain/HTML parts and the
 * failure descriptions are verified as the recipient / the operator would see
 * them. No real mail leaves the machine.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeItemMail } from "./compose.js";
import { logoAttachment } from "./logo.js";
import { startFakeSmtp, type FakeSmtp } from "./fake-smtp.js";
import { ReminderMailService } from "./service.js";
import { DEFAULT_SETTINGS, saveSettings, writeSmtpPassword } from "./settings.js";
import { describeSendError, nodemailerTransport } from "./transport.js";

let smtp: FakeSmtp;
let dir: string;
const PASS = `pw-${randomUUID()}`;

beforeEach(async () => {
  smtp = await startFakeSmtp();
  dir = mkdtempSync(path.join(os.tmpdir(), "rmail-int-"));
});
afterEach(async () => {
  await smtp.close();
  rmSync(dir, { recursive: true, force: true });
});

// @covers FR-01.77
describe("nodemailer transport (loopback fake SMTP)", () => {
  it("delivers a hostile reminder as escaped plain text with no path in it", async () => {
    const mail = composeItemMail(
      { item: { kind: "reminder", id: "rem-1", title: "<script>alert(1)</script>", due: "2026-11-22", why: "see C:\\Users\\me\\repo\\x.md", decided: null, open: "o".repeat(3000), command: null, links: [], severity: null }, projectName: "P", projectId: "p1" },
      "http://localhost:3847",
    );
    await nodemailerTransport({ host: "127.0.0.1", port: smtp.port, user: "me@example.org", pass: PASS }).send({ from: "Shipwright Command Center <me@example.org>", to: "you@example.org", ...mail, attachments: logoAttachment() });
    expect(smtp.messages).toHaveLength(1);
    const raw = smtp.messages[0];
    expect(raw).toMatch(/Subject: \[Shipwright\] Due:/);
    expect(raw).toContain("To: you@example.org");
    expect(raw).toContain("Shipwright Command Center");
    expect(raw).toContain("Content-ID: <shipwright-logo>");
    expect(raw).not.toMatch(/Users|\\repo/);
    expect(raw).not.toContain("<script>alert(1)</script></h2>"); // HTML part is escaped
    expect(raw).not.toContain("o".repeat(1001));
    expect(raw).toContain("http://localhost:3847/inbox");
  });

  it("test mail through the service: sent, the password reaches only the AUTH exchange", async () => {
    await saveSettings(dir, { ...DEFAULT_SETTINGS, enabled: true, recipient: "you@example.org", smtpHost: "127.0.0.1", smtpPort: smtp.port, smtpUser: "me@example.org", webuiAddress: "http://localhost:3847" });
    await writeSmtpPassword(dir, PASS);
    const svc = new ReminderMailService({ dir, listProjects: () => [], readDue: async () => ({ kind: "failed", reason: "x" }), makeTransport: nodemailerTransport });
    expect(await svc.sendTest()).toEqual({ ok: true });
    expect(smtp.messages[0]).toContain("Subject: [Shipwright] Test mail");
    expect(smtp.messages[0]).not.toContain(PASS);
    expect(smtp.authLines.length).toBeGreaterThan(0);
  });

  it("a closed port gives the exact, plain failure", async () => {
    await smtp.close();
    const cfg = { host: "127.0.0.1", port: smtp.port, user: "", pass: null };
    const err = await nodemailerTransport(cfg).send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t", html: "<p>t</p>" }).catch((e: unknown) => e);
    expect(describeSendError(err, cfg)).toBe(`connection refused by 127.0.0.1:${smtp.port}`);
    smtp = await startFakeSmtp(); // afterEach closes whatever is current
  });
});
