/*
 * Spec - reminder-mail-settings (campaign reminders-webui, W4; FR-01.77).
 * Real-browser proof of the Settings card "Reminder mail" against the REAL
 * server routes and the REAL nodemailer transport. A tiny loopback SMTP server
 * runs inside this spec, so "Test mail sent" and the exact failure are real
 * and no mail leaves the machine. Also: the password is write-only (never in
 * any server answer or in the page), and the failed-send notice in the Inbox.
 *
 * Set E2E_SHOTS=<dir> to also write screenshots (manual review).
 */
import net from "node:net";
import { test, expect, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS;
const PASSWORD = `pw-${crypto.randomUUID()}`;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Loopback SMTP that accepts everything (EHLO / AUTH / MAIL / RCPT / DATA / QUIT). */
function startSmtp(): Promise<{ port: number; messages: string[]; close: () => void }> {
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("error", () => undefined);
    let buf = "";
    let data: string[] | null = null;
    sock.write("220 e2e ESMTP\r\n");
    sock.on("data", (c) => {
      buf += c.toString("utf-8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === ".") {
            messages.push(data.join("\r\n"));
            data = null;
            sock.write("250 queued\r\n");
          } else data.push(line);
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) sock.write("250-e2e\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (cmd.startsWith("AUTH")) sock.write("235 ok\r\n");
        else if (cmd === "DATA") {
          data = [];
          sock.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          sock.write("221 bye\r\n");
          sock.end();
        } else sock.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        messages,
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      }),
    ),
  );
}

async function openCard(page: Page) {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-reminder-mail")).toBeVisible({ timeout: 15_000 });
}

// @covers FR-01.77
test.describe("Settings - reminder mail", () => {
  test("off by default; save, password write-only, test mail sent and exact failure", async ({ page }) => {
    const smtp = await startSmtp();
    const answers: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/reminder-mail")) answers.push(await r.text().catch(() => ""));
    });
    try {
      await openCard(page);
      await expect(page.getByTestId("reminder-mail-enabled")).not.toBeChecked();
      await expect(page.getByLabel(/WebUI address/)).toHaveValue(/^http/);
      await expect(page.getByTestId("reminder-mail-password-state")).toHaveText("Password: not set");
      await shot(page, "w4-settings-off");

      // turning it on before it is complete is refused in plain words
      await page.getByTestId("reminder-mail-enabled").check();
      await page.getByTestId("reminder-mail-save").click();
      await expect(page.getByTestId("reminder-mail-result")).toContainText("To turn mail on, fill in: recipient, SMTP server");

      await page.getByLabel("Recipient").fill("operator@example.org");
      await page.getByLabel("SMTP server").fill("127.0.0.1");
      await page.getByLabel("Port").fill(String(smtp.port));
      await page.getByLabel("User name").fill("operator@example.org");
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByTestId("reminder-mail-save").click();
      await expect(page.getByTestId("reminder-mail-result")).toHaveText("Saved.");
      await expect(page.getByTestId("reminder-mail-password-state")).toHaveText("Password: set");
      await expect(page.getByLabel("Password")).toHaveValue("");

      // survives a reload; the password is not in the page or any answer
      await page.reload();
      await expect(page.getByTestId("reminder-mail-enabled")).toBeChecked();
      await expect(page.getByLabel("Recipient")).toHaveValue("operator@example.org");
      await expect(page.getByTestId("reminder-mail-password-state")).toHaveText("Password: set");
      expect(await page.content()).not.toContain(PASSWORD);

      await page.getByTestId("reminder-mail-test").click();
      await expect(page.getByTestId("reminder-mail-result")).toHaveText("Test mail sent.", { timeout: 20_000 });
      // (a scheduled check may also have mailed a summary in the meantime: look for the test mail, do not count)
      const testMail = smtp.messages.find((m) => m.includes("Subject: [Shipwright] Test mail"));
      expect(testMail).toBeDefined();
      for (const m of smtp.messages) expect(m).not.toContain(PASSWORD);
      await shot(page, "w4-settings-sent");

      // a dead server: the exact failure, in plain words
      smtp.close();
      await page.waitForTimeout(3200); // the test route is rate limited to one every 3 s
      await page.getByTestId("reminder-mail-test").click();
      await expect(page.getByTestId("reminder-mail-result")).toContainText(`Test mail failed: connection refused by 127.0.0.1:${smtp.port}`, { timeout: 20_000 });
      await shot(page, "w4-settings-failed");

      expect(answers.join("\n")).not.toContain(PASSWORD);
    } finally {
      smtp.close();
      // leave the stack as found: mail off, no saved password
      await page.request.put("/api/reminder-mail", {
        data: { enabled: false, recipient: "", format: "both", summaryTime: "08:00", summaryWhenEmpty: false, webuiAddress: "", smtpHost: "", smtpPort: 587, smtpUser: "", checkInterval: "1h", clearPassword: true },
      });
    }
  });

  test("a failed send shows a red notice in the Inbox that leads to the mail settings", async ({ page }) => {
    await page.route("**/api/reminder-mail", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        json: {
          settings: { enabled: true, recipient: "operator@example.org", format: "both", summaryTime: "08:00", summaryWhenEmpty: false, webuiAddress: "http://localhost:3847", smtpHost: "smtp.example.org", smtpPort: 587, smtpUser: "", checkInterval: "1h" },
          passwordSet: false,
          status: { lastCheckAt: new Date().toISOString(), lastSent: 0, notes: [], error: { at: new Date().toISOString(), message: "connection refused by smtp.example.org:587", recipient: "operator@example.org" } },
        },
      });
    });
    await page.goto("/inbox");
    const banner = page.getByTestId("inbox-mail-failed");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText("Mail to operator@example.org failed: connection refused by smtp.example.org:587");
    await expect(banner).toContainText("at most 3 tries per item and day");
    await shot(page, "w4-inbox-mail-failed");
    await page.getByTestId("inbox-mail-failed-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("reminder-mail-last-error")).toContainText("connection refused by smtp.example.org:587");
    await shot(page, "w4-settings-error-shown");
  });
});
