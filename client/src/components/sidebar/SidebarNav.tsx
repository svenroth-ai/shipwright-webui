import { useState, useEffect } from 'react';
import { LayoutDashboard, FolderOpen, Inbox, Settings, Menu, Activity, Triangle, PanelLeftClose } from 'lucide-react';
import { SidebarNavItem } from './SidebarNavItem';
import { InboxBadge } from './InboxBadge';
import { TriageBadge } from './TriageBadge';
import { COMPACT_MEDIA_QUERY, useIsCompactViewport } from '../../hooks/useIsCompactViewport';

interface SidebarNavProps {
  inboxCount: number;
  triageCount: number;
  /**
   * Phone overlay-drawer mode (iterate-2026-06-14-phone-responsive-view AC-2).
   * MainLayout hosts the drawer in a Radix `Dialog.Content` (free focus-trap +
   * scroll-lock + Escape + scrim + focus-restore). In drawer mode the sidebar
   * drops the rail/expand chrome and always shows full labels.
   */
  drawer?: boolean;
  /** Called when a nav item is tapped — closes the phone drawer. */
  onNavigate?: () => void;
}

// Auto-collapse to the icon rail across the whole compact band (≤1023px =
// tablet + phone), not just phones — at 768–1023px the full 200px sidebar eats
// the width the board/3-pane need (iterate-2026-06-14-tablet-responsive-view).
// Shares COMPACT_MEDIA_QUERY so the rail threshold can't drift from the rest of
// the responsive layout. The user can still expand the rail; the media handler
// only re-asserts the default when the viewport actually crosses the boundary.
function useMediaCollapse() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(COMPACT_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return [collapsed, setCollapsed] as const;
}

export function SidebarNav({ inboxCount, triageCount, drawer = false, onNavigate }: SidebarNavProps) {
  const [collapsed, setCollapsed] = useMediaCollapse();
  // Read-only compact signal (does NOT track the user's expand/collapse like
  // `collapsed` does) — gates the collapse affordance so it only appears in the
  // ≤1023 band. Desktop has room for the permanent 200px sidebar, so no toggle.
  const isCompact = useIsCompactViewport();
  // Drawer always shows full labels — the ≤1023 rail (sr-only labels) must not
  // leak into the ≤767 drawer (plan-review H2).
  const railed = drawer ? false : collapsed;

  const body = (
    <>
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-5 pb-6">
        {railed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="p-1 rounded hover:bg-white/10"
            aria-label="Expand sidebar"
          >
            <Menu size={20} className="text-white" />
          </button>
        ) : (
          <>
            {/* A05: the real ship's-wheel + wordmark logo (white-on-transparent)
                at 25px height, replacing the hand-drawn SVG + "Shipwright" text.
                There is no "COMMAND" brand-tag element (Fable B5's 2.90:1 failure
                is fixed by the badge not existing) — brand-tag.test.tsx asserts it. */}
            <img
              src="/shipwright-logo-white.png"
              alt="Shipwright"
              className="h-[25px] w-auto shrink-0"
              data-testid="sidebar-brand-logo"
            />
            {/* AC-1 (tablet-view-polish): collapse-back affordance. Without it
                the user could expand the rail but never collapse it again
                (the reported "Menu kann man nicht collapsen" bug). Compact
                band only; the phone drawer closes via the Radix overlay. */}
            {isCompact && !drawer && (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="ml-auto p-1 rounded hover:bg-white/10"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose size={18} className="text-white" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 py-2 px-3">
        <SidebarNavItem icon={LayoutDashboard} label="Task Board" to="/" collapsed={railed} onSelect={onNavigate} />
        <SidebarNavItem icon={FolderOpen} label="Projects" to="/projects" collapsed={railed} onSelect={onNavigate} />
        <SidebarNavItem
          icon={Inbox}
          label="Inbox"
          to="/inbox"
          badge={<InboxBadge count={inboxCount} />}
          collapsed={railed}
          onSelect={onNavigate}
        />
        <SidebarNavItem
          icon={Triangle}
          label="Triage"
          to="/triage"
          badge={<TriageBadge count={triageCount} />}
          collapsed={railed}
          onSelect={onNavigate}
        />
        <SidebarNavItem icon={Activity} label="Diagnostics" to="/diagnostics" collapsed={railed} onSelect={onNavigate} />
      </nav>

      {/* Spacer — pushes Settings to the bottom. Phase B1 removed the
          project list from the sidebar; the TaskBoard header dropdown is
          now the single source of truth for project selection. */}
      <div className="flex-1" />

      {/* Bottom: Settings */}
      <div className="border-t border-white/10 px-3 py-3">
        <SidebarNavItem icon={Settings} label="Settings" to="/settings" collapsed={railed} onSelect={onNavigate} />
      </div>
    </>
  );

  // Phone drawer: Dialog.Content owns positioning/animation; fill it + pad for
  // the iOS safe-area (notch top / home-indicator bottom).
  if (drawer) {
    return (
      <div
        data-testid="sidebar-drawer-body"
        className="flex h-full w-full flex-col bg-[var(--color-sidebar-bg)] [padding-top:env(safe-area-inset-top)] [padding-bottom:env(safe-area-inset-bottom)]"
      >
        {body}
      </div>
    );
  }

  return (
    <aside
      data-testid="sidebar-inline"
      className={`${
        railed ? 'w-[60px] min-w-[60px]' : 'w-[224px] min-w-[224px]'
      } h-screen bg-[var(--color-sidebar-bg)] flex flex-col border-r border-white/[0.07] transition-[width] duration-200`}
    >
      {body}
    </aside>
  );
}
