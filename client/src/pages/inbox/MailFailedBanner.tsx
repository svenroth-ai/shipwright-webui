/*
 * MailFailedBanner — a reminder mail could not be sent (mockup page 06 d).
 * Red, plain wording, a button to the mail settings. The recipient and the
 * failure text come from the server and are shown as plain text only.
 */
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useReminderMail } from "../../hooks/useReminderMail";

export function MailFailedBanner() {
  const { data } = useReminderMail();
  const navigate = useNavigate();
  const err = data?.settings.enabled ? data.status.error : null;
  if (!err) return null;
  return (
    <div className="inbox-banner is-error" role="alert" data-testid="inbox-mail-failed">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="inbox-banner-body">
        <b>Mail to {err.recipient} failed:</b> {err.message.replace(/\.+$/, "")}. The item stays in the Inbox. {data?.settings.checkInterval === "daily"
          ? "The server tries again at tomorrow's check (one check a day)."
          : "The server tries again at the next check (at most 3 tries per item and day)."}
      </div>
      <button type="button" onClick={() => navigate("/settings")} data-testid="inbox-mail-failed-settings">
        Open mail settings
      </button>
    </div>
  );
}
