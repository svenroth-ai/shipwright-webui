/*
 * ReminderBanners — what is wrong with the reminder answer, said plainly
 * (mockup page 06). Rule: when something is wrong, never show "nothing due".
 *   a) the tool could not be started / answered in an unknown format (red):
 *      reminder entries are switched off; the rest of the Inbox still works;
 *   b) parked triage items could not be read, `triageError` (orange): the list
 *      may be incomplete;
 *   c) damaged lines in the reminder file (orange): shown only above 0; the
 *      WebUI never edits that file.
 * The tool's own detail text is untrusted and shown as plain text.
 */
import { AlertTriangle } from "lucide-react";

import type { ReminderProblems } from "./reminderProblems";

function Banner({
  tone,
  testId,
  children,
  onRetry,
}: {
  tone: "warn" | "error";
  testId: string;
  children: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className={`inbox-banner is-${tone}`} role={tone === "error" ? "alert" : "status"} data-testid={testId}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="inbox-banner-body">{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} data-testid={`${testId}-retry`}>
          Try again
        </button>
      )}
    </div>
  );
}

export function ReminderBanners({
  problems,
  nameOf,
  onRetry,
}: {
  problems: ReminderProblems;
  nameOf: (projectId: string) => string;
  onRetry: () => void;
}) {
  if (!problems.any) return null;
  const { unavailable, triageErrors, corruptLines, requestFailed } = problems;
  const names = unavailable.map((u) => nameOf(u.projectId));
  const detail = unavailable.find((u) => u.reason)?.reason ?? null;
  return (
    <div data-testid="inbox-reminder-banners">
      {(requestFailed || unavailable.length > 0) && (
        <Banner tone="error" testId="inbox-reminders-unavailable" onRetry={onRetry}>
          <b>Reminders are unavailable.</b> The Shipwright reminder tool could not be started (or answered in a format
          this WebUI does not know). Reminder entries are switched off until this is fixed. Everything else in the
          Inbox still works.
          {names.length > 0 && <> Affected: {names.join(", ")}.</>}
          {detail && <> (Tool detail: &ldquo;{detail}&rdquo;)</>}
        </Banner>
      )}
      {triageErrors.length > 0 && (
        <Banner tone="warn" testId="inbox-reminders-triage-error">
          <b>Parked triage items could not be checked</b>, so this list may be incomplete. Reminders are shown below.
          {triageErrors.map((t) => (
            <span key={t.projectId} className="block">
              (Tool detail, {nameOf(t.projectId)}: &ldquo;{t.detail}&rdquo;)
            </span>
          ))}
        </Banner>
      )}
      {corruptLines > 0 && (
        <Banner tone="warn" testId="inbox-reminders-damaged">
          <b>
            {corruptLines} {corruptLines === 1 ? "line" : "lines"} in the reminder file {corruptLines === 1 ? "is" : "are"} damaged
          </b>{" "}
          and {corruptLines === 1 ? "was" : "were"} skipped; the reminders on {corruptLines === 1 ? "it are" : "them are"} not shown.
          Ask Shipwright to repair the file (the WebUI never edits it).
        </Banner>
      )}
    </div>
  );
}
