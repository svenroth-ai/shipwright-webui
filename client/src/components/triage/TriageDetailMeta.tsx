import type { TriageItem } from "../../lib/triageApi";
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
  return (
    <>
      <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs mb-4">
        <div>
          <dt className="text-[var(--color-muted)]">Suggested priority</dt>
          <dd className="font-mono">{item.suggestedPriority}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">Suggested domain</dt>
          <dd>{item.suggestedDomain}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">Kind</dt>
          <dd>{item.kind}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">Original ts</dt>
          <dd className="font-mono text-[10px]">{item.originalTs}</dd>
        </div>
        {item.dedupKey && (
          <div className="col-span-2">
            <dt className="text-[var(--color-muted)]">Dedup key</dt>
            <dd className="font-mono text-[10px] break-all">{item.dedupKey}</dd>
          </div>
        )}
        {item.evidencePath && (
          <div className="col-span-2">
            <dt className="text-[var(--color-muted)]">Evidence</dt>
            <dd className="text-[10px] break-all">
              <FileLink path={item.evidencePath} onOpen={onOpenFile} />
            </dd>
          </div>
        )}
      </dl>

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
        <div className="border-t border-[var(--color-border)] pt-4">
          <h4 className="text-xs font-semibold text-[var(--color-text)] uppercase mb-2">
            Detail
          </h4>
          <p
            className="text-sm text-[var(--color-text)] whitespace-pre-wrap"
            data-testid="triage-detail-body"
          >
            <FileMentionText text={item.detail} onOpen={onOpenFile} />
          </p>
        </div>
      )}
    </>
  );
}
