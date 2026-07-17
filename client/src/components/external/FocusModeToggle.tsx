/*
 * FocusModeToggle — the "maximize terminal" control (A18, FR-01.62) that lives
 * in the MIDDLE card's `.ft-head`. It toggles focus mode via FocusModeContext,
 * which the shell (TaskDetailThreePane) fulfils by collapsing both side cards
 * through the EXISTING useThreePaneLayout collapse→resize path — so the pty gets
 * its resize the same way it always has (no new hide path, no 120-col desync).
 *
 * The keyboard binding (`t`) is A21's job; this only exposes the button.
 * Rendered outside the shell (e.g. TaskDetailPage.test mocks it) it is a safe
 * no-op via the context default.
 */

import { Maximize2, Minimize2 } from "lucide-react";
import { useFocusMode } from "./focus-mode-context";

export function FocusModeToggle() {
  const { maximized, toggle } = useFocusMode();
  const label = maximized ? "Restore side panels" : "Maximize terminal";
  return (
    <button
      type="button"
      className="ft-maximize"
      onClick={toggle}
      data-testid="terminal-maximize"
      aria-pressed={maximized}
      aria-label={label}
      title={label}
    >
      {maximized ? (
        <Minimize2 size={15} aria-hidden="true" />
      ) : (
        <Maximize2 size={15} aria-hidden="true" />
      )}
    </button>
  );
}
