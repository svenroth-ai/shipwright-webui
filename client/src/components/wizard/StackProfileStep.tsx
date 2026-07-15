import { useProfiles, type ProfileSummary } from '../../hooks/useProfiles';

interface StackProfileStepProps {
  profile: string;
  onProfileChange: (profile: string) => void;
}

const CUSTOM_OPTION: ProfileSummary = {
  name: 'custom',
  label: 'Custom',
  description: 'Manual configuration — define your own stack',
};

export function StackProfileStep({ profile, onProfileChange }: StackProfileStepProps) {
  const { data, isLoading, isError } = useProfiles();

  const profiles: ProfileSummary[] = [
    ...(data ?? []).filter((p) => p.name !== 'custom'),
    CUSTOM_OPTION,
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted)] mb-3">
        Choose a stack profile for your project:
      </p>
      {isLoading && (
        <div
          data-testid="stack-profile-loading"
          className="space-y-3"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="h-[72px] rounded-[var(--radius-button)] bg-[var(--color-muted-bg)] animate-pulse" />
          <div className="h-[72px] rounded-[var(--radius-button)] bg-[var(--color-muted-bg)] animate-pulse" />
        </div>
      )}
      {isError && (
        <p
          data-testid="stack-profile-error"
          role="alert"
          className="text-xs text-[var(--color-error)] -mt-1 mb-2"
        >
          Could not load stack profiles from the server. Only "Custom" is available right now.
        </p>
      )}
      {profiles.map((p) => {
        const isSelected = profile === p.name;
        const display = p.label ?? p.name;
        const desc = p.description ?? '';
        return (
          <button
            key={p.name}
            type="button"
            onClick={() => onProfileChange(p.name)}
            data-testid={`stack-profile-card-${p.name}`}
            className={`w-full text-left px-4 py-3.5 rounded-[var(--radius-button)] border-[1.5px] transition-colors ${
              isSelected
                ? 'border-[var(--color-primary)] bg-inset shadow-[0_0_0_1px_var(--color-primary)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:bg-inset'
            }`}
          >
            <div className="text-sm font-semibold text-[var(--color-text)]">{display}</div>
            {desc && (
              <div className="text-[13px] text-[var(--color-muted)] mt-0.5 leading-snug">
                {desc}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
