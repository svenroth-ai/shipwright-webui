/*
 * DesignGateGallery — the pending-screens grid of the design-gate card
 * (FR-01.58, A14). Renders INSIDE A14's `DesignGateCard` (which is A12's middle
 * `.mc-op` slot in `designgate` mode) — NO new page / route / header / glass
 * recipe (AC1).
 *
 * Three honest states (AC5):
 *   - screens present → a responsive `auto-fill` grid; each card is a REAL
 *     hosted preview (an <iframe> of the emitted `screens/*.html`, served by the
 *     existing design-review `serve.ts`) whose whole surface is a keyboard-
 *     reachable button that opens the real viewer. Fable's "dead thumbnail" is
 *     the defect being killed.
 *   - a screen row with no `file` → an HONEST per-card placeholder that says so.
 *   - gate open + zero screens → an honest empty state, NEVER a fabricated grid.
 *
 * The mission line's wording comes from A10's narrator (`narrateMission`, via
 * <MissionLine>) — the count of pending screens + the "nothing gets built until
 * you approve" consequence clause. This component writes NO copy of its own and
 * hardcodes no phase string (DO-NOT #11).
 */

import { ImageOff } from "lucide-react";

import { designScreenUrl } from "../../../lib/designReviewApi";
import { useDesignScreens } from "../../../hooks/useDesignScreens";
import type { DesignScreen } from "../../../lib/designManifest";
import { MissionLine } from "./MissionLine";

interface Props {
  projectId: string;
  /** Opens the real hosted review viewer (the shared <MockupReviewOverlay>). */
  onOpenPreview: () => void;
}

export function DesignGateGallery({ projectId, onOpenPreview }: Props) {
  const { screens, isResolved, isError } = useDesignScreens(projectId, true);

  // While the manifest is still loading the count is unknown → the narrator
  // drops the number ("Screens are ready for your eyes."), never guesses one. On
  // a real load error the count is likewise unknown (never reported as 0).
  const screenCount = isError ? null : isResolved ? screens.length : null;

  return (
    <>
      <MissionLine input={{ state: "designgate", screenCount }} />

      <div className="mc-gate-scroll" data-testid="design-gate-scroll">
        {isError ? (
          // A REAL failure (5xx / network) — honest, distinct from "none emitted"
          // (a missing manifest is a 404 → the empty state below).
          <div className="mc-gate-empty" data-testid="design-gate-error">
            <ImageOff size={18} aria-hidden="true" />
            <p>The previews couldn&rsquo;t be loaded. Retrying…</p>
          </div>
        ) : isResolved && screens.length === 0 ? (
          <div className="mc-gate-empty" data-testid="design-gate-empty">
            <ImageOff size={18} aria-hidden="true" />
            <p>The gate is open — no previews were emitted for this run yet.</p>
          </div>
        ) : (
          <ul className="mc-gate-grid" data-testid="design-gate-grid">
            {screens.map((screen, i) => (
              <ScreenCard
                // file is unique when present; fall back to number/name/index so
                // file-less placeholder rows never collide on an empty-string key.
                key={screen.file || `${screen.number ?? "n"}-${screen.name}-${i}`}
                projectId={projectId}
                screen={screen}
                onOpenPreview={onOpenPreview}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ScreenCard({
  projectId,
  screen,
  onOpenPreview,
}: {
  projectId: string;
  screen: DesignScreen;
  onOpenPreview: () => void;
}) {
  const fr = screen.frs[0] ?? null;
  return (
    <li className="mc-gate-card" data-testid="design-gate-screen">
      <div className="mc-gate-thumb" aria-hidden="true">
        {screen.file ? (
          <iframe
            className="mc-gate-frame"
            src={designScreenUrl(projectId, screen.file)}
            title=""
            tabIndex={-1}
            loading="lazy"
            // Opaque-origin, script-capable render of the project's own mockup
            // (loopback-only). No allow-same-origin: a thumbnail needs no
            // storage, and the tighter sandbox is the honest default.
            sandbox="allow-scripts"
            data-testid="design-gate-screen-frame"
          />
        ) : (
          <div className="mc-gate-thumb-empty" data-testid="design-gate-screen-placeholder">
            <ImageOff size={15} aria-hidden="true" />
            <span>No preview file</span>
          </div>
        )}
      </div>
      <div className="mc-gate-cap">
        {fr ? <span className="mc-gate-fr mono">{fr}</span> : null}
        <span className="mc-gate-name">{screen.name}</span>
      </div>
      {/* Full-card click target — keeps the whole tile "alive" (AC5) and
          keyboard-reachable with a focus ring (AC9). Transparent overlay so the
          iframe below shows through; the iframe is pointer-events:none in CSS. */}
      <button
        type="button"
        className="mc-gate-open"
        aria-label={`Open ${screen.name} preview`}
        onClick={onOpenPreview}
        data-testid="design-gate-screen-open"
      />
    </li>
  );
}
