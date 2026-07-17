/*
 * CommandPalette — the glass command palette (A21, FR-01.65).
 *
 * Built on @radix-ui/react-dialog (already a dependency) for the focus-trap,
 * Escape handling and a11y semantics — NO cmdk, NO new hotkey library (out of
 * scope). Rendered GLASS via `.cmd-palette` (AC2, styles/command-center.css).
 *
 * Keyboard: ArrowDown/ArrowUp (and Ctrl+J/Ctrl+K, which never collide with a
 * typed query) move the selection; Enter runs; Esc closes (Radix). Every entry
 * is also clickable (AC7). Commands come from the registry (one source); Launch
 * entries are the project's REAL /actions (AC9). Recent commands float first.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";

import {
  GROUP_LABELS,
  filterCommands,
  type Command,
  type CommandGroup,
} from "../../lib/commandRegistry";

interface Section {
  label: string | null;
  items: Command[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  /** Command ids in most-recent-first order. */
  recentIds?: string[];
  /** Fired after a command runs (for recent tracking). */
  onRun?: (cmd: Command) => void;
}

const GROUP_ORDER: CommandGroup[] = ["jump", "open", "launch", "filter"];

function buildSections(
  commands: Command[],
  query: string,
  recentIds: string[],
): Section[] {
  if (query.trim() !== "") {
    return [{ label: null, items: filterCommands(commands, query) }];
  }
  const byId = new Map(commands.map((c) => [c.id, c]));
  const recent: Command[] = [];
  const shown = new Set<string>();
  for (const id of recentIds) {
    const cmd = byId.get(id);
    if (cmd && !shown.has(id)) {
      recent.push(cmd);
      shown.add(id);
    }
    if (recent.length >= 6) break;
  }
  const sections: Section[] = [];
  if (recent.length > 0) sections.push({ label: "Recent", items: recent });
  for (const group of GROUP_ORDER) {
    const items = commands.filter((c) => c.group === group && !shown.has(c.id));
    if (items.length > 0) sections.push({ label: GROUP_LABELS[group], items });
  }
  return sections;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  recentIds = [],
  onRun,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(
    () => buildSections(commands, query, recentIds),
    [commands, query, recentIds],
  );
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Reset selection to the top whenever the visible set changes.
  useEffect(() => {
    setSelected(0);
  }, [query, open]);

  // Clear the query on close so the next open starts fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const run = (cmd: Command) => {
    onOpenChange(false);
    onRun?.(cmd);
    // Defer so the dialog unmount/focus-restore settles before navigation.
    setTimeout(() => cmd.run(), 0);
  };

  const move = (delta: number) => {
    if (flat.length === 0) return;
    setSelected((i) => {
      const next = (i + delta + flat.length) % flat.length;
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-cmd-index="${next}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
      return next;
    });
  };

  const onInputKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    const key = ev.key.toLowerCase();
    if (ev.key === "ArrowDown" || (ev.ctrlKey && key === "j")) {
      ev.preventDefault();
      move(1);
    } else if (ev.key === "ArrowUp" || (ev.ctrlKey && key === "k")) {
      ev.preventDefault();
      move(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const cmd = flat[selected];
      if (cmd) run(cmd);
    }
    // All other keys (incl. plain j/k) fall through to the query input.
  };

  let flatIndex = -1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" data-testid="cmd-overlay" />
        <Dialog.Content
          className="cmd-palette"
          data-testid="command-palette"
          aria-label="Command palette"
          onOpenAutoFocus={(e) => {
            // Focus our search input, not the first item.
            e.preventDefault();
            (
              listRef.current?.parentElement?.querySelector(
                "input",
              ) as HTMLInputElement | null
            )?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search for a command, then press Enter to run it. Arrow keys move the
            selection; Escape closes.
          </Dialog.Description>

          <div className="cmd-search">
            <Search size={16} aria-hidden="true" className="text-[var(--muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Type a command or search…"
              aria-label="Search commands"
              aria-controls="cmd-listbox"
              role="combobox"
              aria-expanded
              autoComplete="off"
              spellCheck={false}
              data-testid="command-palette-input"
            />
          </div>

          <div
            className="cmd-list"
            id="cmd-listbox"
            role="listbox"
            aria-label="Commands"
            ref={listRef}
          >
            {flat.length === 0 ? (
              <div className="cmd-empty" data-testid="command-palette-empty">
                No matching commands.
              </div>
            ) : (
              sections.map((section, si) => (
                <div key={section.label ?? `results-${si}`}>
                  {section.label ? (
                    <div className="cmd-group-label">{section.label}</div>
                  ) : null}
                  {section.items.map((cmd) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isSel = idx === selected;
                    return (
                      <button
                        type="button"
                        key={cmd.id}
                        role="option"
                        aria-selected={isSel}
                        data-cmd-index={idx}
                        data-testid={`command-item-${cmd.id}`}
                        className="cmd-item"
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => run(cmd)}
                      >
                        <span className="truncate">{cmd.label}</span>
                        {cmd.hint ? (
                          <span className="cmd-item-hint">{cmd.hint}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
