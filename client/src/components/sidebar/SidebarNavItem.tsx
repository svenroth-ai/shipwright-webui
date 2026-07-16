import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  to: string;
  badge?: ReactNode;
  collapsed?: boolean;
  /** Called after the link is activated — used to close the phone drawer. */
  onSelect?: () => void;
}

export function SidebarNavItem({ icon: Icon, label, to, badge, collapsed, onSelect }: SidebarNavItemProps) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onSelect}
      className={({ isActive }) =>
        // Active nav (A05): teal-tint ground, white label, teal icon, and a 3px
        // teal left rail (the `before:` pseudo — inset 6px top/bottom, radius
        // 0 3px 3px 0), exactly as the prototype's `.nav-item.active` /
        // `.nav-item.active::before`. Colours come from tokens so the
        // no-hardcoded-colors guard stays green.
        // 14px/500 nav items (prototype .nav-item): text-sm + font-medium.
        `relative flex items-center gap-[10px] px-3 py-[9px] pointer-coarse:min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? "bg-[var(--nav-active-bg)] text-white [&_svg]:text-[var(--nav-active-rail)] before:absolute before:left-0 before:top-[6px] before:bottom-[6px] before:w-[3px] before:rounded-[0_3px_3px_0] before:bg-[var(--nav-active-rail)] before:content-['']"
            : 'text-white/[0.66] hover:bg-white/[0.06] hover:text-white'
        }`
      }
    >
      {/* In the 60px rail (collapsed) the inline badge after the sr-only label
          overflowed past the rail edge and was clipped ("open items" count cut
          off). Overlay it on the icon's top-right instead so it stays inside
          the rail (iterate-2026-06-15 AC-6). Expanded / drawer keep it inline. */}
      <span className="relative shrink-0">
        <Icon size={18} />
        {collapsed && badge && (
          <span
            data-testid="sidebar-nav-badge-overlay"
            className="absolute -right-2 -top-2 origin-top-right scale-[0.8]"
          >
            {badge}
          </span>
        )}
      </span>
      <span className={collapsed ? 'sr-only' : 'font-medium flex-1'}>
        {label}
      </span>
      {!collapsed && badge}
    </NavLink>
  );
}
