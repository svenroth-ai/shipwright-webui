/*
 * PromoteModal.tsx — operator form for the cross-store Promote action.
 *
 * Pre-fills priority + domain from the triage item's suggestedPriority /
 * suggestedDomain. Tags are comma-split on submit (matches NewIssueModal
 * lead-foundation pattern from ADR-100).
 *
 * Toast feedback:
 *   - 201 ok  → success toast + close + invalidate queries (handled by hook)
 *   - 207 partial → "promote partially completed; click Retry to finish"
 *   - 409  → "already promoted by another session" / "promote in progress"
 *   - 4xx  → form-level error
 *
 * XSS-safety: every triage field is rendered as plain text (not through
 * MarkdownText). Mirror MasterTaskCard's domain-chip XSS test pattern.
 */

import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";

import {
  type TriageComplexityHint,
  type TriageItem,
  type TriagePriority,
} from "../../lib/triageApi";
import { usePromoteTriageItem } from "../../hooks/useTriage";
import { SeverityBadge, SourceBadge } from "./TriageBadgeUI";

const PRIORITY_OPTIONS: TriagePriority[] = ["P0", "P1", "P2", "P3"];
const COMPLEXITY_OPTIONS: TriageComplexityHint[] = ["small", "medium", "large"];

interface PromoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  item: TriageItem;
  /** Called after a successful 201 Promote so the parent can close + toast. */
  onPromoted?: (taskId: string, recovered: boolean) => void;
}

export function PromoteModal({
  open,
  onOpenChange,
  projectId,
  item,
  onPromoted,
}: PromoteModalProps) {
  const promote = usePromoteTriageItem(projectId);

  const [priority, setPriority] = useState<TriagePriority>(
    item.suggestedPriority,
  );
  const [domain, setDomain] = useState<string>(item.suggestedDomain);
  const [complexityHint, setComplexityHint] = useState<TriageComplexityHint | "">(
    "",
  );
  const [tagsRaw, setTagsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPriority(item.suggestedPriority);
      setDomain(item.suggestedDomain);
      setComplexityHint("");
      setTagsRaw("");
      setError(null);
    }
  }, [open, item]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!domain.trim()) {
      setError("Domain is required");
      return;
    }
    const tags = tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await promote.mutateAsync({
      triageId: item.id,
      priority,
      domain: domain.trim(),
      complexityHint: complexityHint || undefined,
      tags,
    });
    if (result.kind === "ok") {
      onPromoted?.(result.data.task.taskId, result.data.recovered);
      onOpenChange(false);
    } else if (result.kind === "partial") {
      setError(
        `Promote partially completed. ExternalTask ${result.data.taskId} created — click Submit again to finish the status flip.`,
      );
    } else {
      const body = result.body as { error?: string; message?: string };
      setError(
        body.message ||
          `Promote failed (${result.status}): ${body.error ?? "unknown"}`,
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[540px] max-w-[90vw] bg-[var(--color-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]"
          data-testid="triage-promote-modal"
        >
          <form onSubmit={onSubmit} className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  Promote to backlog
                </Dialog.Title>
                <Dialog.Description className="text-sm text-stone-500 mt-1">
                  Creates an ExternalTask carrying a back-ref and flips the
                  triage item to <code>promoted</code>.
                </Dialog.Description>
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

            <div className="border border-stone-200 rounded p-3 mb-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <SourceBadge source={item.source} />
                <SeverityBadge severity={item.severity} />
                <code className="text-[11px] text-stone-500">{item.id}</code>
              </div>
              <h3 className="text-sm font-medium text-stone-900">
                {item.title}
              </h3>
              {item.dedupKey && (
                <p
                  className="text-[10px] text-stone-500 font-mono"
                  data-testid="promote-dedupKey"
                >
                  dedup: {item.dedupKey}
                </p>
              )}
              <p className="text-xs text-stone-600 whitespace-pre-wrap">
                {item.detail}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-stone-700">
                  Priority *
                </span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TriagePriority)}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-stone-300 rounded"
                  data-testid="promote-priority"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-stone-700">
                  Domain *
                </span>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-stone-300 rounded"
                  placeholder="engineering"
                  data-testid="promote-domain"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-stone-700">
                  Complexity hint
                </span>
                <select
                  value={complexityHint}
                  onChange={(e) =>
                    setComplexityHint(e.target.value as TriageComplexityHint | "")
                  }
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-stone-300 rounded"
                  data-testid="promote-complexity"
                >
                  <option value="">— unspecified —</option>
                  {COMPLEXITY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-stone-700">Tags</span>
                <input
                  type="text"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-stone-300 rounded"
                  placeholder="auth, billing"
                  data-testid="promote-tags"
                />
              </label>
            </div>

            <p className="text-[11px] text-stone-500 mt-2">
              Auto-tags <code>source:{item.source}</code>,{" "}
              <code>severity:{item.severity}</code>,{" "}
              <code>triage:{item.id}</code> are added automatically.
            </p>

            {error && (
              <div
                className="mt-4 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded"
                data-testid="promote-error"
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2.5 mt-5">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] hover:border-[var(--color-accent)] transition-colors inline-flex items-center justify-center"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={promote.isPending}
                className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                data-testid="promote-submit"
              >
                {promote.isPending && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Promote
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
