interface ProjectInfoStepProps {
  name: string;
  path: string;
  standalone: boolean;
  onStandaloneChange: (standalone: boolean) => void;
  onNameChange: (name: string) => void;
  onPathChange: (path: string) => void;
}

export function ProjectInfoStep({ name, path, standalone, onStandaloneChange, onNameChange, onPathChange }: ProjectInfoStepProps) {
  // Iterate 14.7.1 replaced the old "Browse" button (sandboxed half-paths from
  // showDirectoryPicker) with a clipboard-paste helper. iterate-2026-07-06
  // removed that button too: the directory field is a plain editable input and
  // the user copies the full path from Explorer/Finder and pastes it in
  // directly (Ctrl+V) — the same gesture the button performed.
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-[13px] font-semibold text-[var(--color-text)] mb-1.5 tracking-tight">
          Project Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My Awesome App"
          className="w-full h-12 px-3.5 border-[1.5px] border-[var(--color-border)] rounded-[var(--radius-button)] text-sm text-[var(--color-text)] bg-[var(--color-surface)] placeholder:text-[var(--color-muted)] hover:border-[var(--color-accent)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary)]/10 transition-colors"
        />
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-[var(--color-text)] mb-1.5 tracking-tight">
          Project Directory
        </label>
        <input
          type="text"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder="C:\Users\...\my-app"
          className="w-full h-12 px-3.5 border-[1.5px] border-[var(--color-border)] rounded-[var(--radius-button)] text-[13px] font-mono text-[var(--color-text)] bg-[var(--color-surface)] placeholder:text-[var(--color-muted)] hover:border-[var(--color-accent)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary)]/10 transition-colors"
        />
        <p className="text-xs text-[var(--color-muted)] mt-1.5">
          Copy the full path from Explorer/Finder and paste it in here.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={standalone}
          onChange={(e) => onStandaloneChange(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
        />
        <span className="text-[13px] text-[var(--color-text)] leading-snug">
          <span className="font-semibold tracking-tight">Standalone — don't touch this repository</span>
          <span className="block text-xs text-[var(--color-muted)] mt-0.5">
            Nothing is written into the project folder (no .shipwright-webui, no .gitignore edits). The
            board, terminal and Launch/Resume work as usual; the webui keeps its files in your user
            directory. Shipwright plugins are not required.
          </span>
        </span>
      </label>
    </div>
  );
}
