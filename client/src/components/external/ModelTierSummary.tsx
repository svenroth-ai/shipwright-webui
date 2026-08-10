import { useModelTierConfig } from "../../hooks/useModelTierConfig";

const ROLE_LABELS = {
  plan_review: "Plan review",
  review: "Review",
  finalization: "Finalization",
  execution: "Execution",
} as const;

export function ModelTierSummary({ projectId }: { projectId: string }) {
  const { data } = useModelTierConfig(projectId);
  if (!data?.tiers) return null;

  return (
    <section className="mt-2 border-t border-[var(--color-border)] pt-2" data-testid={`task-model-tiers-${projectId}`} aria-label="Effective model tiers">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-medium text-[var(--color-text)]">Effective models</span>
        <span className="text-[var(--color-muted)]">project default</span>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
          <span key={role} className="min-w-0 rounded bg-[var(--color-bg)] px-1.5 py-1" data-testid={`task-model-tier-${projectId}-${role}`}>
            <span className="block truncate text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{ROLE_LABELS[role]}</span>
            <span className="block truncate text-[11px] font-medium capitalize text-[var(--color-text)]">{data.tiers[role].tier}</span>
          </span>
        ))}
      </div>
      {data.warning && (
        <p className="mt-1 text-[10px] text-[var(--color-warning-text,#92400e)]" role="status">
          {data.warning === "model_config_missing"
            ? "No project model configuration found; showing inherited tiers."
            : "Model configuration could not be read; showing inherited tiers where needed."}
        </p>
      )}
    </section>
  );
}
