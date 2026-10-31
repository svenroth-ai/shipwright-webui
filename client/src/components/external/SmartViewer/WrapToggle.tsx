/*
 * Shared "Wrap lines" preference + sticky toggle bar for the Smart Viewer's
 * code (CodeRenderer) and plain-text (TextRenderer) views. ONE stored
 * preference, remembered per browser (getStored/setStored guard storage
 * access with try/catch), default: wrap.
 */

import { useState } from "react";
import { getStored, setStored } from "../../../lib/localStorage";

export const WRAP_STORAGE_KEY = "shipwright:viewer-wrap-lines";

export function useWrapLines(): { wrap: boolean; toggleWrap: () => void } {
  const [wrap, setWrap] = useState<boolean>(() => getStored<boolean>(WRAP_STORAGE_KEY, true) !== false);
  const toggleWrap = () => {
    const next = !wrap;
    setWrap(next);
    setStored(WRAP_STORAGE_KEY, next);
  };
  return { wrap, toggleWrap };
}

export function WrapToggleBar({ wrap, onToggle }: { wrap: boolean; onToggle: () => void }) {
  return (
    <div className="sv-code-bar">
      <button type="button" className="sv-wrap-toggle" aria-pressed={wrap} onClick={onToggle} data-testid="smart-viewer-wrap-toggle">
        Wrap lines
      </button>
    </div>
  );
}
