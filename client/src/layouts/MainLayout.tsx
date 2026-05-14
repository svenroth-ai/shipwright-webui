import { Outlet } from 'react-router-dom';
import { SidebarNav } from '../components/sidebar/SidebarNav';
import { DiagnosticsBanner } from '../components/common/DiagnosticsBanner';
import { useExternalInbox } from '../hooks/useExternalInbox';
import { useTriageCounts } from '../hooks/useTriage';

export function MainLayout() {
  const { data: inbox = [] } = useExternalInbox();
  const { data: triageCounts } = useTriageCounts();
  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarNav inboxCount={inbox.length} triageCount={triageCounts?.total ?? 0} />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--color-background)]">
        <DiagnosticsBanner />
        <div className="flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
