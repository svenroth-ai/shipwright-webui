/*
 * CaptainsDrawer — the Ship's-Log grade strip (A16, FR-01.60). A 76px glass
 * "captain's drawer", NOT a hero band: it argues the project's control grade in
 * one strip and shows the papers on demand.
 *
 *   [ring]  The captain's drawer · why A · 98/100        [Why an A? ⌄]
 *           <inline sub-scores — ONLY when the reader parsed the table>
 *
 * Provenance honesty (spec AC2):
 *   - Ring is REUSED from the wizard's GradeRing (`.gring`) — NOT a third ring
 *     implementation (A11/A08 own the ring).
 *   - Inline sub-scores render ONLY when `compliance.dimensions` is non-empty.
 *     No dimensions → ring + eyebrow only, NO bars. A full bar for a dashboard
 *     we could not parse would be a fabricated claim.
 *   - "Why an A?" opens the REAL control record via ComplianceDetailModal (the
 *     documents that exist) — not the prototype's file://-safe inline panel.
 *   - The prototype's SUBS demo literals (43/43 FRs, 1882/1882, 209 runs) are
 *     NEVER ported; every value comes from compliance-reader (FR-01.43/60).
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { useProjectCompliance } from "../../hooks/useProjectCompliance";
import { GradeRing } from "../wizard/IntentWizard/GradeRing";
import { ComplianceDetailModal } from "../compliance/ComplianceDetailModal";

export function CaptainsDrawer({ projectId }: { projectId: string }) {
  const { data } = useProjectCompliance(projectId);
  const [open, setOpen] = useState(false);

  // Ungraded (missing dashboard / still loading / invalid) → an honest slim
  // strip, never a ring at score 0. The Grade tool lives on the Projects
  // gallery + wizard; here we just state the fact.
  if (!data || data.status !== "ok") {
    return (
      <div className="log-mast glass-card" data-testid="captains-drawer" data-graded="false">
        <div className="lm-mid">
          <div className="lm-eyebrow">The captain&rsquo;s drawer</div>
          <div style={{ fontSize: 13, color: "var(--body)" }}>
            Not graded yet — the control grade appears once this project has a
            compliance dashboard.
          </div>
        </div>
      </div>
    );
  }

  const { grade, score, verdict, generatedAt, controlVerdictMarkdown, ciSecurityMarkdown } = data;
  // Defensive: a stale cache / older server could omit the additive field.
  const dimensions = data.dimensions ?? [];

  return (
    <div className="log-mast glass-card" data-testid="captains-drawer" data-graded="true">
      <GradeRing letter={grade} score={score} />
      <div className="lm-mid">
        <div className="lm-eyebrow" data-testid="captains-drawer-eyebrow">
          The captain&rsquo;s drawer · why {grade} · {score}/100
        </div>
        {dimensions.length > 0 && (
          <div className="subs" data-testid="captains-drawer-subs">
            {dimensions.map((d) => (
              <span className="sub" key={d.key} title={`${d.label}: ${d.value}`} data-testid={`captains-drawer-sub-${d.key}`}>
                <span className="k">{d.label}</span>
                <span className="mbar" aria-hidden="true">
                  <i style={{ width: d.pct != null ? `${d.pct}%` : 0 }} />
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="lm-why"
        data-testid="captains-drawer-why"
        onClick={() => setOpen(true)}
        title={verdict}
      >
        Why an {grade}? <ChevronDown size={13} />
      </button>

      <ComplianceDetailModal
        open={open}
        onOpenChange={setOpen}
        grade={grade}
        score={score}
        generatedAt={generatedAt}
        controlVerdictMarkdown={controlVerdictMarkdown}
        ciSecurityMarkdown={ciSecurityMarkdown}
      />
    </div>
  );
}
