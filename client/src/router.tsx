import { createBrowserRouter } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import TaskBoardPage from './pages/TaskBoardPage';
import TaskDetailPage from './pages/TaskDetailPage';
import ProjectsPage from './pages/ProjectsPage';
import ShipsLogPage from './pages/ShipsLogPage';
import InboxPage from './pages/InboxPage';
import TriagePage from './pages/TriagePage';
import SettingsPage from './pages/SettingsPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import PreviewPage from './pages/PreviewPage';
import IntentWizardPage from './components/wizard/IntentWizard/IntentWizardPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <TaskBoardPage /> },
      // Intent Wizard (A08, FR-01.51) — the guided front door, BEFORE the expert
      // ProjectWizard. /wizard = door picker; /wizard/adopt|grade land inside the
      // respective flow at step 1 (AC4). Additive: the expert create stays reachable.
      { path: 'wizard', element: <IntentWizardPage /> },
      { path: 'wizard/:door', element: <IntentWizardPage /> },
      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      // A16 (FR-01.60) — a project's HOME is its Ship's Log. This is the single
      // destination A15's openProjectLog() seam points at (client/src/lib/projectNav.ts).
      { path: 'projects/:projectId/log', element: <ShipsLogPage /> },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'triage', element: <TriagePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'diagnostics', element: <DiagnosticsPage /> },
    ],
  },
  // Full-screen SmartViewer pop-out (AC5) — no MainLayout/sidebar chrome.
  { path: '/preview', element: <PreviewPage /> },
]);
