/*
 * MissionSegmented — the reusable "pill-in-a-trough" segmented control of Mission
 * Control (A13, FR-01.57). One `.mc-tabs` group; the active option gets the white
 * chip + `--sh-xs` (`.mc-tab.active`).
 *
 * ARIA: this is a single-select `radiogroup` (NOT a `tablist`) on purpose. A
 * `role="tab"` here would make the "Files & Terminal" option collide with the
 * center Radix "Terminal" tab under `getByRole("tab", {name:/terminal/i})`, which
 * the A11/A12 specs pin to exactly ONE match. Radiogroup + roving-tabindex +
 * arrow-key selection-follows-focus is the correct keyboard model for a segmented
 * view switch and keeps that query at count 1.
 *
 * A18 reuses this component for the Transcript/Terminal + file-viewer tabs via the
 * `ft-seg` variant (`.mc-tabs.ft-seg`) — build-it-once, exported here.
 */

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Stable Playwright/unit hook; falls back to none. */
  testId?: string;
}

interface MissionSegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Required — labels the radiogroup for assistive tech. */
  ariaLabel: string;
  /** `ft-seg` = the A18 Files-&-Terminal variant (`.mc-tabs.ft-seg`). */
  variant?: "default" | "ft-seg";
  className?: string;
}

export function MissionSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "default",
  className,
}: MissionSegmentedProps<T>) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (nextIndex: number) => {
    const wrapped = (nextIndex + options.length) % options.length;
    const next = options[wrapped];
    if (!next) return;
    onChange(next.value);
    // Selection follows focus (WAI-ARIA radio pattern): move the roving focus too.
    btnRefs.current[wrapped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((o) => o.value === value);
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(current - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`mc-tabs${variant === "ft-seg" ? " ft-seg" : ""}${className ? ` ${className}` : ""}`}
      onKeyDown={onKeyDown}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`mc-tab${selected ? " active" : ""}`}
            data-testid={opt.testId}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
