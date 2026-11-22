/*
 * fake-smtp.ts — test support (not a test file): a tiny in-process SMTP server
 * on a loopback port, so the REAL nodemailer transport can be exercised end to
 * end without sending any real mail. Advertises AUTH PLAIN/LOGIN and accepts any
 * credentials; records every message body and every AUTH line it sees.
 */

import net from "node:net";

export interface FakeSmtp {
  port: number;
  messages: string[];
  authLines: string[];
  close(): Promise<void>;
}

export async function startFakeSmtp(): Promise<FakeSmtp> {
  const messages: string[] = [];
  const authLines: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => undefined);
    let buf = "";
    let data: string[] | null = null;
    let loginStep = 0;
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === ".") {
            messages.push(data.join("\r\n"));
            data = null;
            sock.write("250 queued\r\n");
          } else data.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        const cmd = line.toUpperCase();
        if (loginStep > 0) {
          authLines.push(line);
          loginStep = loginStep === 1 ? 2 : 0;
          sock.write(loginStep === 2 ? "334 UGFzc3dvcmQ6\r\n" : "235 ok\r\n");
        } else if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) sock.write("250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (cmd.startsWith("AUTH PLAIN")) {
          authLines.push(line);
          sock.write("235 ok\r\n");
        } else if (cmd.startsWith("AUTH LOGIN")) {
          loginStep = 1;
          sock.write("334 VXNlcm5hbWU6\r\n");
        } else if (cmd.startsWith("MAIL") || cmd.startsWith("RCPT")) sock.write("250 ok\r\n");
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    messages,
    authLines,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
