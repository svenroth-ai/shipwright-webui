/*
 * ReminderMailCard — Settings card "Reminder mail" (campaign reminders-webui,
 * W4; mockup page 04). Mail is OFF by default. The card saves on the Save
 * button (not on every keystroke: half-typed SMTP settings must not be applied)
 * and "Send test mail" saves first, so the test always uses what is on screen.
 *
 * The password is write-only. An empty password field means "keep the saved
 * one"; the card only ever learns whether one is set. A failed send shows the
 * exact failure (plain text) here and as a banner in the Inbox (mockup page 06).
 */
import { useEffect, useState } from "react";

import { useReminderMail, useSaveReminderMail, useSendReminderTestMail } from "../../hooks/useReminderMail";
import { ReminderMailFields, type MailForm } from "./ReminderMailFields";

type Result = { tone: "ok" | "error"; text: string } | null;

export function ReminderMailCard() {
  const { data, isError } = useReminderMail();
  const save = useSaveReminderMail();
  const test = useSendReminderTestMail();
  const [form, setForm] = useState<MailForm | null>(null);
  const [clearPassword, setClearPassword] = useState(false);
  const [result, setResult] = useState<Result>(null);

  // Seed once from the server; the WebUI address defaults to where this page was opened.
  useEffect(() => {
    if (!data || form) return;
    const s = data.settings;
    setForm({ ...s, webuiAddress: s.webuiAddress || window.location.origin, password: "" });
  }, [data, form]);

  if (isError) {
    return (
      <section data-testid="settings-reminder-mail" style={cardStyle}>
        <h2 style={titleStyle}>Reminder mail</h2>
        <p role="alert" style={{ fontSize: "13px", color: "var(--color-danger, #b3261e)", margin: 0 }}>
          The mail settings could not be loaded.
        </p>
      </section>
    );
  }
  if (!data || !form) return null;

  const set: Parameters<typeof ReminderMailFields>[0]["set"] = (key, value) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    if (key === "password") setClearPassword(false);
  };

  async function persist(): Promise<boolean> {
    if (!form) return false;
    const { password, ...settings } = form;
    const res = await save.mutateAsync({ ...settings, ...(password ? { password } : {}), ...(clearPassword && !password ? { clearPassword: true } : {}) });
    if (!res.ok) {
      setResult({ tone: "error", text: res.message });
      return false;
    }
    setClearPassword(false);
    setForm({ ...res.view.settings, password: "" });
    return true;
  }

  const onSave = async (): Promise<void> => {
    setResult(null);
    if (await persist()) setResult({ tone: "ok", text: "Saved." });
  };

  const onTest = async (): Promise<void> => {
    setResult(null);
    if (!(await persist())) return;
    const r = await test.mutateAsync();
    setResult(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: `Test mail failed: ${r.error}` });
  };

  const busy = save.isPending || test.isPending;
  const passwordSet = data.passwordSet && !clearPassword;
  const err = data.settings.enabled ? data.status.error : null;

  return (
    <section style={cardStyle} className="flex flex-col gap-3" data-testid="settings-reminder-mail">
      <div>
        <h2 style={titleStyle}>Reminder mail</h2>
        <p style={{ fontSize: "13px", color: "var(--color-muted)", margin: "4px 0 0" }}>
          Off by default. When on, the server mails you about due items. The alert in the Inbox works with or without it.
        </p>
      </div>
      {err && (
        <p role="alert" data-testid="reminder-mail-last-error" style={{ margin: 0, fontSize: "13px", color: "#fff", background: "#7a1f17", border: "1px solid #f97066", borderRadius: "var(--radius-button)", padding: "10px 12px", overflowWrap: "anywhere" }}>
          <b>Mail to {err.recipient} failed:</b> {err.message.replace(/\.+$/, "")}. {data?.settings.checkInterval === "daily" ? "The server tries again at tomorrow's check (one check a day)." : "The server tries again at the next check (at most 3 tries per item and day)."}
        </p>
      )}
      <ReminderMailFields form={form} set={set} passwordSet={passwordSet} onClearPassword={() => {
          setClearPassword(true);
          setForm((f) => (f ? { ...f, password: "" } : f));
        }} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={() => void onSave()} disabled={busy} data-testid="reminder-mail-save">
          Save
        </button>
        <button type="button" onClick={() => void onTest()} disabled={busy} data-testid="reminder-mail-test" style={testButtonStyle}>
          Send test mail
        </button>
        <span role="status" data-testid="reminder-mail-result" style={{ fontSize: "13px", color: result?.tone === "error" ? "var(--color-danger, #b3261e)" : "var(--color-muted)", overflowWrap: "anywhere", minWidth: 0 }}>
          {result?.text ?? 'Result shows here, e.g. "Test mail sent" or the exact failure.'}
        </span>
      </div>
    </section>
  );
}

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-sm)",
  padding: "20px",
} as const;
const titleStyle = { fontSize: "15px", fontWeight: 600, color: "var(--color-text)", margin: 0 } as const;
const testButtonStyle = {
  height: "var(--btn-h, 36px)",
  padding: "0 16px",
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--color-text)",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--r-btn, 8px)",
  cursor: "pointer",
} as const;
