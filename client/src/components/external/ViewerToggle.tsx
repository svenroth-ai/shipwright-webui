/*
 * ViewerToggle — shows / hides the Smart Viewer pane on a touch tablet
 * (iterate-2026-10-08-tablet-mobile-layout-polish). On the tablet band the
 * viewer starts hidden so the terminal keeps its width; this is the explicit
 * way back to it (opening a file from the tree also opens it). Renders nothing
 * outside the tablet band, where the splitter / 3-pane layout owns the viewer.
 */
import { PanelRight, PanelRightClose } from "lucide-react";
import { useFocusMode } from "./focus-mode-context";

export function ViewerToggle() {
  const { viewer } = useFocusMode();
  if (!viewer.available) return null;
  const label = viewer.open ? "Hide smart viewer" : "Show smart viewer";
  return (
    <button
      type="button"
      className="ft-maximize"
      onClick={viewer.toggle}
      data-testid="viewer-toggle"
      aria-pressed={viewer.open}
      aria-label={label}
      title={label}
    >
      {viewer.open ? (
        <PanelRightClose size={15} aria-hidden="true" />
      ) : (
        <PanelRight size={15} aria-hidden="true" />
      )}
    </button>
  );
}
