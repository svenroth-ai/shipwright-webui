/*
 * Reset-actions confirmation modal (extracted from ActionsConfigRow,
 * iterate-2026-06-14-actions-config-ux).
 *
 * Uses Radix to match the rest of the WebUI (see
 * `external/ConfirmDeleteDialog.tsx`) instead of `window.confirm`, which
 * doesn't render in the WebUI palette and is awkward to test.
 */

import * as Dialog from "@radix-ui/react-dialog";

export interface ResetActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  onConfirm: () => void;
  testIdSuffix: string;
}

export function ResetActionsDialog({
  open,
  onOpenChange,
  projectName,
  onConfirm,
  testIdSuffix,
}: ResetActionsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          data-testid={`actions-config-reset-confirm-${testIdSuffix}`}
          className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 p-4 shadow-xl"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-card-hover)",
          }}
        >
          <Dialog.Title className="text-base font-semibold text-neutral-900">
            Reset actions.json?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-700">
            Remove <span className="font-mono text-xs">.shipwright-webui/actions.json</span>{" "}
            from <span className="font-medium">{projectName}</span>? The project
            will fall back to the bundled default. The file on disk will be
            deleted.
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="bg-white px-3 py-1 text-sm text-neutral-800 hover:bg-neutral-50"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-button)",
                }}
                data-testid={`actions-config-reset-cancel-${testIdSuffix}`}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              className="bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
              style={{ borderRadius: "var(--radius-button)" }}
              data-testid={`actions-config-reset-confirm-button-${testIdSuffix}`}
            >
              Reset
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
