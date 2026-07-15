/*
 * ComplianceDetailModal — click-through detail for the compliance Grade badge
 * (FR-01.43). Radix Dialog (same pattern as TriageDetailModal).
 *
 * Body renders the server-sliced Control-Verdict + CI-Security markdown via the
 * existing DocumentMarkdown (react-markdown + remark-gfm) so the dimension /
 * severity tables look 1:1 like the dashboard — no table re-modeling. The slice
 * deliberately excludes the dashboard's trailing "Compliance Artifacts" links
 * table (relative links, dead in-browser).
 */

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { DocumentMarkdown } from "../external/SmartViewer/DocumentMarkdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: string;
  score: number;
  generatedAt: string;
  controlVerdictMarkdown: string;
  ciSecurityMarkdown: string;
}

export function ComplianceDetailModal({
  open,
  onOpenChange,
  grade,
  score,
  generatedAt,
  controlVerdictMarkdown,
  ciSecurityMarkdown,
}: Props) {
  const body = [controlVerdictMarkdown, ciSecurityMarkdown]
    .filter((s) => s && s.trim())
    .join("\n\n");
  const generatedLabel = generatedAt ? generatedAt.slice(0, 10) : "";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[760px] max-w-[92vw] max-h-[85vh] overflow-y-auto bg-[var(--color-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]"
          data-testid="compliance-detail-modal"
        >
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  Compliance — Grade {grade} ({score}/100)
                </Dialog.Title>
                {generatedLabel && (
                  <p className="text-xs text-[var(--color-muted)] mt-1">
                    Generated: {generatedLabel}
                  </p>
                )}
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] transition-colors"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4">
              <DocumentMarkdown text={body} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
