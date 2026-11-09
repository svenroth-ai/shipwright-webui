import type { TriageItem } from "../../lib/triageApi";
import { extractFileMentions } from "../../lib/extractFileMentions";
import { useFileExistence } from "../../hooks/useFileExistence";
import { getComplexity } from "../../lib/triageFilterSort";
import { parseFindings } from "../../lib/triageFindings";
import { checkHelp } from "../../lib/triageHelpText";
import { FileLink } from "./FileLink";
import { FileMentionText } from "./FileMentionText";
import { TriageAmendForm } from "./TriageAmendForm";

interface Props {
  projectId: string;
  item: TriageItem;
  editMode: boolean;
  onEditDone: () => void;
  writesRouteToOutbox: boolean | undefined;
  writeDisabled: boolean;
  writeDisabledReason: string;
  onOpenFile: (path: string) => void;
}

/**
 * Metadata + Detail body of TriageDetailModal, extracted so a compliance
 * finding's file references (structured `evidencePath`, and any mentioned
 * inline in `detail`) can become clickable without growing the modal past
 * its bloat ceiling (iterate-2026-08-29-compliance-file-viewer).
 */
export function TriageDetailMeta({
  projectId,
  item,
  editMode,
  onEditDone,
  writesRouteToOutbox,
  writeDisabled,
  writeDisabledReason,
  onOpenFile,
}: Props) {
  // iterate-2026-08-30-triage-file-viewer-followups — only a path confirmed
  // to exist under the project renders as a clickable link; a mention of a
  // planned-but-not-yet-built or deleted file stays plain text.
  const candidatePaths = [
    ...(item.evidencePath ? [item.evidencePath] : []),
    ...extractFileMentions(item.detail).map((m) => m.path),
  ];
  const existingPaths = useFileExistence(projectId, candidatePaths);
  const findings =
    item.source === "compliance" || item.source === "phaseQuality" ? parseFindings(item.detail) : [];

  const FIELD = "text-[var(--color-muted)]";
  return (
    <>
      {editMode ? (
        <div className="border-t border-[var(--color-border)] pt-4">
          <TriageAmendForm
            projectId={projectId}
            item={item}
            writesRouteToOutbox={writesRouteToOutbox}
            writeDisabled={writeDisabled}
            writeDisabledReason={writeDisabledReason}
            onCancel={onEditDone}
            onSaved={onEditDone}
          />
        </div>
      ) : (
        <>
          {findings.length > 0 && (
            <ul className="m-0 mb-4 grid list-none gap-2 p-0" data-testid="triage-detail-findings">
              {findings.map((f, i) => {
                const h = checkHelp(f.code, f.title);
                return (
                  <li key={`${f.code}-${i}`} className="rounded-md bg-[var(--color-muted-bg)] px-3 py-2 text-sm text-[var(--color-text)]">
                    <div className="flex items-center gap-2 font-medium">
                      <code className="shrink-0 rounded bg-[var(--color-surface)] px-1.5 py-px text-xs">{f.code}</code>
                      <span className="min-w-0 flex-1">{f.title}</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-snug">{h.what}</p>
                    <p className="mt-1 text-[13px] leading-snug">{h.why}</p>
                    <p className="mt-1 text-[13px] leading-snug">
                      <span className="font-semibold">What Fix now does: </span>
                      {h.todo}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <details className="mb-4" open={findings.length === 0} data-testid="triage-detail-raw">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text)]">
              {findings.length > 0 ? "Raw detail" : "Detail"}
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text)]" data-testid="triage-detail-body">
              <FileMentionText text={item.detail} onOpen={onOpenFile} existingPaths={existingPaths} />
            </p>
          </details>
          {item.evidencePath && (
            <p className="mb-4 break-all text-sm text-[var(--color-text)]" data-testid="triage-detail-evidence">
              <span className="font-semibold">Evidence: </span>
              {existingPaths?.has(item.evidencePath) ? (
                <FileLink path={item.evidencePath} onOpen={onOpenFile} />
              ) : (
                item.evidencePath
              )}
            </p>
          )}
          <details className="mb-2" data-testid="triage-detail-more">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text)]">Details</summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-[var(--color-text)]">
              <div>
                <dt className={FIELD}>Suggested priority <span className="font-normal">(follows severity)</span></dt>
                <dd className="font-mono">{item.suggestedPriority}</dd>
              </div>
              <div>
                <dt className={FIELD}>Suggested domain</dt>
                <dd>{item.suggestedDomain}</dd>
              </div>
              <div>
                <dt className={FIELD}>Complexity</dt>
                <dd data-testid="triage-detail-complexity">{getComplexity(item)}</dd>
              </div>
              <div>
                <dt className={FIELD}>Kind</dt>
                <dd>{item.kind}</dd>
              </div>
              <div>
                <dt className={FIELD}>Original ts</dt>
                <dd className="font-mono">{item.originalTs}</dd>
              </div>
              {item.dedupKey && (
                <div className="col-span-2">
                  <dt className={FIELD}>Dedup key</dt>
                  <dd className="break-all font-mono">{item.dedupKey}</dd>
                </div>
              )}
            </dl>
          </details>
        </>
      )}
    </>
  );
}
