/*
 * Radix DropdownMenu wrapping the Phase field in task mode. Each item gets
 * a 10x10 rounded-3 colored square (from phase.color) + label. Extracted
 * verbatim from NewIssueModal.tsx (lines 1305-1368). The Radix dropdown's
 * JSDOM quirk (Content doesn't mount under fireEvent.click) is documented
 * in NewIssueModal.test.tsx — tests assert against the trigger label.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";

import type { PhaseDefinition } from "../../../lib/externalApi";
import { glossaryLookup } from "../../../lib/glossary";

interface PhaseDropdownProps {
  phases: PhaseDefinition[];
  value: string;
  onChange: (id: string) => void;
}

export function PhaseDropdown({ phases, value, onChange }: PhaseDropdownProps) {
  const current = phases.find((p) => p.id === value) ?? phases[0];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="new-issue-phase-select"
          // A07 — JIT tooltip: the currently-selected phase's plain-language
          // one-liner surfaces on hover, right where the jargon appears.
          title={glossaryLookup(current?.id) ?? glossaryLookup(current?.label)}
          className="flex w-full items-center gap-2.5 rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-2 text-[13px] text-[var(--color-text,#1a1a1a)] hover:border-[var(--color-primary,#6b5e56)]"
        >
          <span
            className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[3px]"
            style={{ background: current?.color ?? "#9ca3af" }}
            aria-hidden
          />
          <span className="flex-1 text-left font-medium">
            {current?.label ?? "Select…"}
          </span>
          <ChevronDown
            size={12}
            className="text-[var(--body,#44403c)]"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          data-testid="new-issue-phase-menu"
          className="z-[60] min-w-[220px] rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-white p-1 shadow-[var(--shadow-card,0_6px_30px_rgba(0,0,0,0.10))]"
        >
          {phases.map((p) => {
            const active = p.id === value;
            return (
              <DropdownMenu.Item
                key={p.id}
                data-testid={`new-issue-phase-option-${p.id}`}
                onSelect={() => onChange(p.id)}
                title={glossaryLookup(p.id) ?? glossaryLookup(p.label)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] text-[var(--color-text,#1a1a1a)] outline-none hover:bg-[var(--color-muted-bg,#ede8e1)] focus:bg-[var(--color-muted-bg,#ede8e1)] ${
                  active ? "font-medium" : ""
                }`}
              >
                <span
                  className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[3px]"
                  style={{ background: p.color ?? "#9ca3af" }}
                  aria-hidden
                />
                <span className="flex-1">{p.label}</span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
