/*
 * FolderTreeMenu — the FileTree row actions (mission-desktop-style-v2 V5):
 * "Open in Viewer", "Copy Path" (absolute), "Copy Relative Path". No keyboard
 * shortcuts are shown (Mac/Windows differ). Pointer: a Radix dropdown anchored
 * at the cursor; touch ("..." button / long press): a bottom sheet with 48px items.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { createPortal } from "react-dom";

export interface TreeMenuTarget {
  path: string;
  kind: "file" | "dir";
  x: number;
  y: number;
  sheet: boolean;
}

interface Props {
  target: TreeMenuTarget | null;
  onClose: () => void;
  onOpen: (path: string, kind: "file" | "dir") => void;
  /** False while the absolute project folder is unknown: "Copy Path" is disabled. */
  canCopyPath: boolean;
  onCopyPath: (path: string) => void;
  onCopyRelative: (path: string) => void;
}

export function FolderTreeMenu({ target, onClose, onOpen, canCopyPath, onCopyPath, onCopyRelative }: Props) {
  if (!target) return null;
  const base = target.path.split("/").pop() ?? target.path;
  const items: Array<{ label: string; run: () => void; disabled?: boolean }> = [];
  items.push({ label: "Open in Viewer", run: () => onOpen(target.path, target.kind) });
  items.push({ label: "Copy Path", run: () => onCopyPath(target.path), disabled: !canCopyPath });
  items.push({ label: "Copy Relative Path", run: () => onCopyRelative(target.path) });

  if (target.sheet) {
    return (
      <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="ft-sheet-scrim" />
          <Dialog.Content
            className="ft-sheet"
            aria-describedby={undefined}
            data-testid="folder-tree-sheet"
          >
            <div className="grab" aria-hidden="true" />
            <Dialog.Title className="sheet-t">{base}</Dialog.Title>
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                className="ft-sheet-item"
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  it.run();
                }}
              >
                {it.label}
              </button>
            ))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <DropdownMenu.Root key={`${target.path}:${target.x}:${target.y}`} open modal={false} onOpenChange={(o) => !o && onClose()}>
      {/* Portalled to <body>: the glass cards use backdrop-filter, which would make
          `position: fixed` relative to the card instead of the viewport. */}
      {createPortal(
        <DropdownMenu.Trigger asChild>
          <span
            aria-hidden="true"
            style={{ position: "fixed", left: target.x, top: target.y, width: 1, height: 1, pointerEvents: "none", overflow: "hidden" }}
          >
            {base}
          </span>
        </DropdownMenu.Trigger>,
        document.body,
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ft-ctx"
          align="start"
          side="bottom"
          aria-label="File actions"
          data-testid="folder-tree-menu"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {items.map((it, i) => (
            <div key={it.label}>
              {i === 1 && <DropdownMenu.Separator className="ft-ctx-sep" />}
              <DropdownMenu.Item className="ft-ctx-item" disabled={it.disabled} onSelect={it.run}>
                {it.label}
              </DropdownMenu.Item>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
