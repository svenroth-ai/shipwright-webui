import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu } from 'lucide-react';
import { SidebarNav } from '../components/sidebar/SidebarNav';
import { DiagnosticsBanner } from '../components/common/DiagnosticsBanner';
import { SceneBackdrop } from '../components/common/SceneBackdrop';
import { useExternalInbox } from '../hooks/useExternalInbox';
import { useTriageCounts } from '../hooks/useTriage';
import { useIsPhoneViewport } from '../hooks/useIsCompactViewport';
import {
  MobileTopBarSlotProvider,
  MobileTopBarSlotTarget,
} from '../components/external/MobileTopBarSlot';

export function MainLayout() {
  const { data: inbox = [] } = useExternalInbox();
  const { data: triageCounts } = useTriageCounts();
  const isPhone = useIsPhoneViewport();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on route change (AC-2). Radix handles Escape / scrim /
  // focus-trap / scroll-lock / focus-restore via Dialog.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const inboxCount = inbox.length;
  const triageCount = triageCounts?.total ?? 0;

  return (
    <MobileTopBarSlotProvider>
    <div className="flex h-[100dvh] overflow-hidden">
      {isPhone ? (
        <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 [overscroll-behavior:contain]" />
            <Dialog.Content
              data-testid="mobile-nav-drawer"
              aria-label="Navigation"
              className="fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[260px] max-w-[85vw] flex-col shadow-2xl outline-none"
            >
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <SidebarNav
                drawer
                inboxCount={inboxCount}
                triageCount={triageCount}
                onNavigate={() => setDrawerOpen(false)}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        <SidebarNav inboxCount={inboxCount} triageCount={triageCount} />
      )}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--color-background)]">
        {isPhone ? (
          <div
            data-testid="mobile-topbar"
            className="flex shrink-0 items-center gap-2 bg-[var(--color-sidebar-bg)] px-1 [padding-top:env(safe-area-inset-top)]"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              data-testid="mobile-nav-trigger"
              className="flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10"
            >
              <Menu size={22} />
            </button>
            <span className="text-[15px] font-bold text-white">Shipwright</span>
            {/* Page-injected content (Task Board portals its project dropdown
                here on phones — iterate-2026-06-15 AC-1). Empty on other
                routes. min-w-0 lets the dropdown truncate instead of pushing
                the bar wider than the viewport on narrow phones. */}
            <MobileTopBarSlotTarget className="flex min-w-0 flex-1 items-center justify-end pr-1" />
          </div>
        ) : null}
        <DiagnosticsBanner />
        {/* Weather-Deck scene layer (A03, FR-01.48): one signature backdrop on
            every route. The photo plate is frozen; `.scene-fore` is the scroller
            and keeps the `main-scroll-container` contract.
            padding-bottom env(safe-area-inset-bottom): the page was clipped at
            the bottom on devices with a bottom inset (iPad home-indicator /
            Safari bottom bar) because only the phone path reserved it. Applied
            app-wide here; a no-op (0px) on desktop. (tablet-view-polish AC-3) */}
        <SceneBackdrop className="[scrollbar-gutter:stable] [overscroll-behavior:contain] [padding-bottom:env(safe-area-inset-bottom)]">
          <Outlet />
        </SceneBackdrop>
      </main>
    </div>
    </MobileTopBarSlotProvider>
  );
}
