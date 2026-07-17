/*
 * LaunchFailureNotice — the ONE renderer for a launch failure (FR-01.61, A17).
 *
 * A PERSISTENT, inline notice (never a toast — a toast that evaporates while
 * the operator is in another tab IS the bug this iterate fixes). The campaign
 * card, the task card and the task-detail header all mount this component with
 * the SAME `failure` descriptor from `lib/launchFailure.ts`, so the words never
 * drift between surfaces (AC4). The surface wires the recovery actions the
 * mapping declares honest (AC3) — an action it cannot honor is simply omitted,
 * and 403/422 declare no Retry so no Retry can render.
 */

import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Copy,
  Info,
  Play,
  RefreshCw,
  RotateCw,
  Settings,
  Terminal,
} from "lucide-react";

import type { LaunchFailure, LaunchFailureAction } from "../../lib/launchFailure";

export interface LaunchFailureActionConfig {
  onClick?: () => void;
  /** Internal route — rendered as a react-router Link when set (no onClick). */
  href?: string;
  label?: string;
}

export interface LaunchFailureNoticeProps {
  failure: LaunchFailure;
  /** What was attempted, in the operator's words (e.g. "Launch B1 — glossary"). */
  attempted?: string;
  /** Rendered (mono) only when `failure.showPath` is set. */
  path?: string | null;
  /** Per-action wiring; an action in `failure.actions` renders only if present. */
  actions?: Partial<Record<LaunchFailureAction, LaunchFailureActionConfig>>;
  /** Disables Retry while a re-launch is in flight. */
  busy?: boolean;
  /** testid base: the notice is `<testId>`, actions are `<testId>-<action>`. */
  testId: string;
  className?: string;
}

const DEFAULT_LABEL: Record<LaunchFailureAction, string> = {
  retry: "Retry",
  "copy-command": "Copy command",
  "open-terminal": "Open terminal",
  resume: "Resume",
  "open-project-settings": "Project settings",
  refresh: "Refresh",
};

const ICON: Record<LaunchFailureAction, typeof RotateCw> = {
  retry: RotateCw,
  "copy-command": Copy,
  "open-terminal": Terminal,
  resume: Play,
  "open-project-settings": Settings,
  refresh: RefreshCw,
};

export function LaunchFailureNotice({
  failure,
  attempted,
  path,
  actions = {},
  busy = false,
  testId,
  className = "",
}: LaunchFailureNoticeProps) {
  const recovery = failure.tone === "recovery";
  const HeadIcon = recovery ? Info : AlertTriangle;
  const tint = recovery ? "var(--info-tint, #eef4ff)" : "var(--err-tint, #fdecea)";
  const fg = recovery ? "var(--info, #2563eb)" : "var(--err, #dc2626)";

  return (
    <div
      role="alert"
      data-testid={testId}
      data-launch-failure-code={failure.code}
      className={
        "flex flex-col gap-1.5 rounded-[var(--radius-button,8px)] border px-3 py-2 text-[12px] " +
        className
      }
      style={{ background: tint, borderColor: `color-mix(in srgb, ${fg} 35%, transparent)` }}
    >
      <div className="flex items-center gap-1.5 font-semibold" style={{ color: fg }}>
        <HeadIcon size={14} aria-hidden />
        <span data-testid={`${testId}-title`}>{failure.title}</span>
        <span
          className="ml-auto font-mono text-[10px] font-normal opacity-70"
          data-testid={`${testId}-code`}
          title="machine reason"
        >
          {failure.code}
        </span>
      </div>

      {attempted && (
        <div className="text-[11px] font-medium text-[var(--color-text,#111827)]" data-testid={`${testId}-attempted`}>
          {attempted}
        </div>
      )}

      <p className="leading-[1.45] text-[var(--color-text,#1a1a1a)]" data-testid={`${testId}-sentence`}>
        {failure.sentence}
      </p>

      {failure.showPath && path && (
        <code
          data-testid={`${testId}-path`}
          className="block overflow-x-auto whitespace-pre rounded-[6px] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-2 py-1 font-mono text-[11px] text-[var(--color-text,#111827)]"
        >
          {path}
        </code>
      )}

      {failure.actions.length > 0 && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5" data-testid={`${testId}-actions`}>
          {failure.actions.map((action) => {
            const cfg = actions[action];
            if (!cfg || (!cfg.onClick && !cfg.href)) return null;
            const Ico = ICON[action];
            const label = cfg.label ?? DEFAULT_LABEL[action];
            const disabled = action === "retry" && busy;
            const cls =
              "inline-flex items-center gap-1 rounded-[6px] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-2 py-1 text-[11px] font-medium text-[var(--color-text,#111827)] transition enabled:hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:cursor-not-allowed disabled:opacity-50";
            const inner = (
              <>
                <Ico size={12} aria-hidden />
                {disabled && action === "retry" ? "Retrying…" : label}
              </>
            );
            if (cfg.href) {
              return (
                <Link key={action} to={cfg.href} data-testid={`${testId}-${action}`} className={cls}>
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={action}
                type="button"
                onClick={cfg.onClick}
                disabled={disabled}
                data-testid={`${testId}-${action}`}
                className={cls}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
