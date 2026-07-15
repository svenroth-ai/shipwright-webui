/*
 * ComplianceGradeBadge — per-project compliance Control-Grade pill (FR-01.43).
 *
 * Self-contained: owns its own useProjectCompliance query + the detail modal,
 * so it drops into both the Projects table and the Task-Board header. Renders
 * NOTHING unless the read is `ok` (missing dashboard / invalid / loading →
 * graceful absence). Color by grade letter: A→emerald, B→amber, C-and-below→red.
 * Tooltip = verdict + "Generated: <date>" (stale-honesty). Click opens the
 * detail modal; stopPropagation so a click inside a clickable table row doesn't
 * also navigate.
 */

import { useState } from "react";

import { useProjectCompliance } from "../../hooks/useProjectCompliance";
import { ComplianceDetailModal } from "./ComplianceDetailModal";

function gradeClasses(grade: string): string {
  const letter = grade.charAt(0).toUpperCase();
  if (letter === "A") return "bg-ok-tint text-ok border-[var(--ok-line)]";
  if (letter === "B") return "bg-warn-tint text-warn border-[var(--warn-line)]";
  return "bg-err-tint text-err border-[var(--err-line)]";
}

export function ComplianceGradeBadge({
  projectId,
}: {
  projectId: string | null | undefined;
}) {
  const { data } = useProjectCompliance(projectId);
  const [open, setOpen] = useState(false);

  if (!data || data.status !== "ok") return null;

  const { grade, score, verdict, generatedAt } = data;
  const generatedLabel = generatedAt ? generatedAt.slice(0, 10) : "";
  const title = [verdict, generatedLabel && `Generated: ${generatedLabel}`]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <button
        type="button"
        data-testid={`compliance-grade-${projectId}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={title}
        aria-label={`Compliance grade ${grade} (${score} of 100). Click for details.`}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-none transition-colors hover:brightness-95 ${gradeClasses(grade)}`}
      >
        {grade}
      </button>
      <ComplianceDetailModal
        open={open}
        onOpenChange={setOpen}
        grade={grade}
        score={score}
        generatedAt={generatedAt}
        controlVerdictMarkdown={data.controlVerdictMarkdown}
        ciSecurityMarkdown={data.ciSecurityMarkdown}
      />
    </>
  );
}
