/*
 * Test double for MissionInfoSidebar in MissionBody tests: hosts the requested Mission document exactly
 * where the real sidebar does (inside `mission-side-doc`), without the sidebar's own queries. The real
 * sidebar is covered by MissionInfoSidebar.test.tsx and the Playwright flow.
 */
import { useEffect, useState } from "react";

import type { SidebarDocs } from "./MissionInfoSidebar";

export function MissionInfoSidebarDocsStub({ docs }: { docs?: SidebarDocs }) {
  const request = docs?.request ?? null;
  const [closedNonce, setClosedNonce] = useState<number | null>(null);
  useEffect(() => {
    docs?.onActiveChange(request?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  if (!docs || !request || closedNonce === request.nonce) return null;
  return (
    <div data-testid="mission-side-doc">
      {docs.render(request.key, () => {
        setClosedNonce(request.nonce);
        docs.onActiveChange(null);
      })}
    </div>
  );
}
