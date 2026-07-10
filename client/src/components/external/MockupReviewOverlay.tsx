/*
 * MockupReviewOverlay — full-bleed, sandboxed in-app host for the design
 * phase's OWN emitted review viewer (FR-01.45, AC1/AC2).
 *
 * Radix Dialog (shared pattern with SmartViewerModal) but FULL-BLEED
 * (`inset-0`) — the viewer owns the whole surface. The iframe loads the
 * server-hosted `.../designs/index.html` (which the server serves as text/html
 * with an injected bridge that overrides `window.showSaveFilePicker`). When the
 * user clicks Export in the viewer's own feedback panel, the bridge posts the
 * markdown here; we validate origin + source, write it into the worktree via
 * `writeDesignFeedback`, and show a "Saved — Round N" confirmation. The panel
 * stays open (user decision) — Resume is a separate explicit click on the card.
 *
 * Sandbox: `allow-scripts allow-same-origin allow-modals`. `allow-same-origin`
 * is required for the viewer's own localStorage; the content is the project's
 * own design artifacts served loopback-only (accepted trade-off — see the serve
 * route header / ADR).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, MonitorPlay, X } from "lucide-react";

import {
  designsViewerUrl,
  writeDesignFeedback,
  isDesignFeedbackMessage,
} from "../../lib/designReviewApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Lift the saved round up so the card can hint "press Resume to apply". */
  onFeedbackSaved?: (round: number) => void;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; round: number }
  | { kind: "error"; message: string };

export function MockupReviewOverlay({
  open,
  onOpenChange,
  projectId,
  onFeedbackSaved,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Same-origin host + this iframe only (plan review R7).
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isDesignFeedbackMessage(event.data)) return;

      setSave({ kind: "saving" });
      writeDesignFeedback(projectId, event.data.markdown)
        .then((res) => {
          setSave({ kind: "saved", round: res.round });
          onFeedbackSaved?.(res.round);
        })
        .catch((err: unknown) => {
          setSave({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not save feedback.",
          });
        });
    },
    [projectId, onFeedbackSaved],
  );

  useEffect(() => {
    if (!open) {
      setSave({ kind: "idle" });
      return;
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, handleMessage]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="mockup-review-overlay"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface,#ffffff)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <MonitorPlay
              size={15}
              className="shrink-0 text-[var(--color-accent,#857568)]"
              aria-hidden="true"
            />
            <Dialog.Title className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text,#1a1a1a)]">
              Review mockups
            </Dialog.Title>

            <SaveIndicator save={save} />

            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="mockup-review-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-[var(--color-muted-bg,#ede8e1)]">
            <iframe
              ref={iframeRef}
              title="Design mockups review viewer"
              src={designsViewerUrl(projectId)}
              // allow-same-origin: the viewer needs its own localStorage. Content
              // is the project's own design artifacts, loopback-only.
              sandbox="allow-scripts allow-same-origin allow-modals"
              className="h-full w-full border-0"
              data-testid="mockup-review-iframe"
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SaveIndicator({ save }: { save: SaveState }) {
  if (save.kind === "saving") {
    return (
      <span
        data-testid="mockup-review-saving"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-muted,#6b7280)]"
      >
        <Loader2 size={13} className="animate-spin" /> Saving…
      </span>
    );
  }
  if (save.kind === "saved") {
    return (
      <span
        data-testid="mockup-review-saved"
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#d1fae5] px-2 py-0.5 text-[12px] font-semibold text-[#065f46]"
      >
        <Check size={13} /> Saved — Round {save.round}
      </span>
    );
  }
  if (save.kind === "error") {
    return (
      <span
        data-testid="mockup-review-error"
        className="truncate text-[12px] font-medium text-[var(--color-error,#dc2626)]"
        title={save.message}
      >
        Save failed
      </span>
    );
  }
  return null;
}
