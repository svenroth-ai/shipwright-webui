/*
 * ShortcutsSheet — the `?` keyboard cheat-sheet (A21, FR-01.65, AC3/AC4).
 *
 * Generated from the KEYBOARD_SHORTCUTS registry (one source — every binding
 * appears here, no secret shortcut) and shows BOTH chords side by side: a
 * Windows column AND a Mac column, so the map is unambiguous regardless of what
 * the platform detector guessed (AC3 — Windows-first). Every glyph comes from
 * formatChord; nothing is hardcoded.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { KEYBOARD_SHORTCUTS, type ShortcutDef } from "../../lib/commandRegistry";
import { chordForms } from "../../lib/formatChord";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function bySection(): Array<{ section: string; items: ShortcutDef[] }> {
  const order: string[] = [];
  const map = new Map<string, ShortcutDef[]>();
  for (const s of KEYBOARD_SHORTCUTS) {
    if (!map.has(s.section)) {
      map.set(s.section, []);
      order.push(s.section);
    }
    map.get(s.section)!.push(s);
  }
  return order.map((section) => ({ section, items: map.get(section)! }));
}

export function ShortcutsSheet({ open, onOpenChange }: Props) {
  const sections = bySection();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" data-testid="shortcuts-overlay" />
        <Dialog.Content
          className="cmd-palette"
          data-testid="shortcuts-sheet"
          aria-label="Keyboard shortcuts"
        >
          <div className="cmd-search" style={{ justifyContent: "space-between" }}>
            <Dialog.Title className="text-[15px] font-semibold text-[var(--ink)]">
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              data-testid="shortcuts-close"
              className="rounded p-1 text-[var(--muted)] hover:bg-black/5"
            >
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            The full keyboard map. The Windows column shows the Ctrl chord; the
            Mac column shows the Cmd chord.
          </Dialog.Description>

          <div className="cmd-list">
            <div
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]"
            >
              <span>Action</span>
              <span className="text-right">Windows / Linux</span>
              <span className="text-right">Mac</span>
            </div>
            {sections.map(({ section, items }) => (
              <div key={section}>
                <div className="cmd-group-label">{section}</div>
                {items.map((s) => {
                  const forms = chordForms(s.chord);
                  return (
                    <div
                      key={s.id}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-2 py-1.5 text-[13px] text-[var(--ink)]"
                      data-testid={`shortcut-row-${s.id}`}
                    >
                      <span>{s.label}</span>
                      <span className="justify-self-end">
                        <kbd className="cmd-sheet-kbd" data-testid={`shortcut-win-${s.id}`}>
                          {forms.windows}
                        </kbd>
                      </span>
                      <span className="justify-self-end">
                        <kbd className="cmd-sheet-kbd" data-testid={`shortcut-mac-${s.id}`}>
                          {forms.mac}
                        </kbd>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
