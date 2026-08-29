import { FileText } from "lucide-react";

interface Props {
  path: string;
  onOpen: (path: string) => void;
}

/**
 * Clickable file-path atom used both for the structured `evidencePath` field
 * and for mentions detected inside free text by `extractFileMentions`. A
 * `<button>`, not an `<a>`, since there is nothing to navigate to — clicking
 * opens the in-page TriageFilePanel instead.
 */
export function FileLink({ path, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className="inline-flex items-center gap-1 align-middle font-mono text-[var(--color-accent,#857568)] underline decoration-dotted hover:text-[var(--color-primary)]"
      data-testid="triage-file-link"
      data-file-path={path}
      title={`Open ${path}`}
    >
      <FileText size={11} className="shrink-0" aria-hidden="true" />
      {path}
    </button>
  );
}
