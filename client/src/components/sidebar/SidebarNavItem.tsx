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
        `relative flex items-center gap-[10px] px-3 py-[9px] pointer-coarse:min-h-[44px] rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-white/[0.12] text-white'
            : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
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
