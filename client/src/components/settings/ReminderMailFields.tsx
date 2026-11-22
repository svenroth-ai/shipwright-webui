/*
 * ReminderMailFields — the form fields of the "Reminder mail" Settings card
 * (mockup page 04). Presentational: every value and handler comes from
 * ReminderMailCard, which owns the state. The password input is write-only:
 * it never shows a saved value, only "set / not set".
 */
import type { ReactNode } from "react";

import type { CheckInterval, MailFormat, ReminderMailSettings } from "../../lib/reminderMailApi";

export interface MailForm extends ReminderMailSettings {
  /** Typed password; "" means "leave the saved one alone". */
  password: string;
}

const control = {
  fontSize: "14px",
  padding: "6px 8px",
  color: "var(--color-text)",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-input, 6px)",
  maxWidth: "420px",
} as const;
const help = { fontSize: "12px", color: "var(--color-muted)" } as const;

function Field({ label, htmlFor, helpText, children }: { label: string; htmlFor: string; helpText?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
        {label}
      </label>
      {children}
      {helpText && <span style={help}>{helpText}</span>}
    </div>
  );
}

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
      {children}
    </label>
  );
}

const SUMMARY_TIMES = ["07:00", "08:00", "09:00", "12:00", "18:00"];

export function ReminderMailFields({
  form,
  set,
  passwordSet,
  onClearPassword,
}: {
  form: MailForm;
  set: <K extends keyof MailForm>(key: K, value: MailForm[K]) => void;
  passwordSet: boolean;
  onClearPassword: () => void;
}) {
  const usesSummary = form.format !== "item";
  const times = SUMMARY_TIMES.includes(form.summaryTime) ? SUMMARY_TIMES : [...SUMMARY_TIMES, form.summaryTime].sort();
  return (
    <div className="flex flex-col gap-3">
      <Check id="reminder-mail-enabled" checked={form.enabled} onChange={(v) => set("enabled", v)}>
        Send reminder mail
      </Check>
      <Field label="Recipient" htmlFor="reminder-mail-recipient">
        <input id="reminder-mail-recipient" type="email" autoComplete="off" value={form.recipient} onChange={(e) => set("recipient", e.target.value)} style={control} />
      </Field>
      <Field label="What to send" htmlFor="reminder-mail-format">
        <select id="reminder-mail-format" value={form.format} onChange={(e) => set("format", e.target.value as MailFormat)} style={control}>
          <option value="item">One mail per due item</option>
          <option value="summary">One daily summary</option>
          <option value="both">Both: one mail per item and a daily summary</option>
        </select>
      </Field>
      <Field label="Daily summary time" htmlFor="reminder-mail-summary-time" helpText={'Only used when "daily summary" or "both" is chosen.'}>
        <select id="reminder-mail-summary-time" value={form.summaryTime} disabled={!usesSummary} onChange={(e) => set("summaryTime", e.target.value)} style={{ ...control, maxWidth: "260px" }}>
          {times.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Check id="reminder-mail-summary-empty" checked={form.summaryWhenEmpty} onChange={(v) => set("summaryWhenEmpty", v)}>
        Send the summary even when nothing is due
      </Check>
      <Field
        label="WebUI address (used for the links in the mail)"
        htmlFor="reminder-mail-address"
        helpText="Filled in from where you opened this page. Change it if you reach the WebUI under another address, for example on your phone."
      >
        <input id="reminder-mail-address" autoComplete="off" value={form.webuiAddress} onChange={(e) => set("webuiAddress", e.target.value)} style={control} />
      </Field>
      <Field label="SMTP server" htmlFor="reminder-mail-host">
        <input id="reminder-mail-host" autoComplete="off" value={form.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} style={control} />
      </Field>
      <Field label="Port" htmlFor="reminder-mail-port">
        <input id="reminder-mail-port" inputMode="numeric" value={String(form.smtpPort)} onChange={(e) => set("smtpPort", Number(e.target.value.replace(/\D/g, "")) || 0)} style={{ ...control, maxWidth: "120px" }} />
      </Field>
      <Field label="User name" htmlFor="reminder-mail-user">
        <input id="reminder-mail-user" autoComplete="off" value={form.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} style={control} />
      </Field>
      <Field
        label="Password"
        htmlFor="reminder-mail-password"
        helpText={
          <>
            Saved in the file <b>.env.local</b> in the WebUI&apos;s own user folder (<b>~/.shipwright-webui/</b>), outside every project repository.
            Never in a repo, never in logs, never sent back to the browser once saved.
          </>
        }
      >
        <div className="flex items-center gap-2">
          <input
            id="reminder-mail-password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            placeholder={passwordSet ? "A password is saved (type to replace it)" : "Not set"}
            onChange={(e) => set("password", e.target.value)}
            style={{ ...control, flex: 1 }}
          />
          {passwordSet && (
            <button type="button" onClick={onClearPassword} className="font-semibold" style={{ ...help, color: "var(--color-text)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }} data-testid="reminder-mail-clear-password">
              Remove saved password
            </button>
          )}
        </div>
        <span style={help} data-testid="reminder-mail-password-state">
          {passwordSet ? "Password: set" : "Password: not set"}
        </span>
      </Field>
      <Field label="How often the server checks what is due" htmlFor="reminder-mail-interval">
        <select id="reminder-mail-interval" value={form.checkInterval} onChange={(e) => set("checkInterval", e.target.value as CheckInterval)} style={{ ...control, maxWidth: "260px" }}>
          <option value="15m">every 15 minutes</option>
          <option value="1h">every hour</option>
          <option value="daily">once a day, at the summary time</option>
        </select>
      </Field>
    </div>
  );
}
