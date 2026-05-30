/*
 * PreviewPage — full-screen pop-out of the SmartViewer for a single project
 * file (iterate-2026-05-30-smartviewer-render-ux, AC5). Reached via
 * `/preview?projectId=&path=` opened in a new tab from the SmartViewer
 * pop-out button. Top-level route (NOT under MainLayout) so it has no
 * sidebar — just the rendered document filling the window, with the pane's
 * own horizontal + vertical scrollbars.
 */

import { useSearchParams } from "react-router-dom";

import { SmartViewer } from "../components/external/SmartViewer";

export default function PreviewPage() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId");
  const path = params.get("path");

  if (!projectId || !path) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center p-6 text-sm"
        style={{ background: "var(--color-bg)", color: "var(--color-muted)" }}
        data-testid="preview-page-missing"
      >
        Missing <code className="mx-1">projectId</code> or{" "}
        <code className="mx-1">path</code> query parameter.
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      style={{ background: "var(--color-bg)" }}
      data-testid="preview-page"
    >
      <SmartViewer projectId={projectId} path={path} />
    </div>
  );
}
