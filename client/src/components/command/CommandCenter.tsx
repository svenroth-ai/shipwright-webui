/*
 * CommandCenter — the single mount for the keyboard layer (A21, FR-01.65).
 *
 * Lives once in the app shell (MainLayout). It:
 *   - binds the global chords via useKeyboardMap (Ctrl/⌘+K → palette, ? → sheet);
 *   - builds the palette command list from the registry with REAL deps
 *     (router destinations, projects, the active project's /actions, density);
 *   - tracks recent commands (localStorage) so the palette floats them first.
 *
 * It renders only portalled dialogs (invisible when closed) so it does NOT move
 * any existing route's visual baseline (AC8). The palette-open chord is a
 * keyboard affordance; every ACTION it triggers also has a clickable path
 * (sidebar nav, header create, density toggle, the maximize button) — AC7.
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useKeyboardMap } from "../../hooks/useKeyboardMap";
import { useDensity } from "../../hooks/useDensity";
import { useProjects } from "../../hooks/useProjects";
import { useProjectFilter } from "../../hooks/useProjectFilter";
import { useProjectActions } from "../../hooks/useProjectActions";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { openProjectLog } from "../../lib/projectNav";
import { getNavDestinations } from "../../lib/navDestinations";
import { buildCommands, type Command } from "../../lib/commandRegistry";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsSheet } from "./ShortcutsSheet";

const RECENT_KEY = "webui.command.recent";
const RECENT_CAP = 12;

export function CommandCenter() {
  const navigate = useNavigate();
  const { density, toggleDensity } = useDensity();
  const { activeProjectId, setActiveProjectId } = useProjectFilter();
  const { data: projectList = [] } = useProjects();
  const [recent, setRecent] = useLocalStorage<string[]>(RECENT_KEY, []);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openShortcuts = useCallback(() => setSheetOpen(true), []);
  useKeyboardMap({ onOpenPalette: openPalette, onOpenShortcuts: openShortcuts });

  const realProjects = useMemo(
    () =>
      projectList.filter(
        (p) => !p.synthesized && p.id !== UNASSIGNED_PROJECT_ID,
      ),
    [projectList],
  );
  const resolvedProjectId =
    activeProjectId && activeProjectId !== UNASSIGNED_PROJECT_ID
      ? activeProjectId
      : (realProjects[0]?.id ?? null);

  // Only fetch actions while the palette is open (no work on every keystroke).
  const actionsQuery = useProjectActions(paletteOpen ? resolvedProjectId : null);

  const commands = useMemo<Command[]>(
    () =>
      buildCommands({
        destinations: getNavDestinations(),
        navigate,
        projects: realProjects.map((p) => ({ id: p.id, name: p.name })),
        openProject: (projectId) =>
          openProjectLog(projectId, { setActiveProjectId, navigate }),
        actions: (actionsQuery.data?.actions ?? []).map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
        })),
        launchAction: (actionId) => {
          const params = new URLSearchParams();
          if (resolvedProjectId) params.set("projectId", resolvedProjectId);
          params.set("create", actionId);
          navigate(`/?${params.toString()}`);
        },
        setActiveProject: setActiveProjectId,
        density,
        toggleDensity,
      }),
    [
      navigate,
      realProjects,
      actionsQuery.data,
      resolvedProjectId,
      setActiveProjectId,
      density,
      toggleDensity,
    ],
  );

  const onRun = useCallback(
    (cmd: Command) => {
      setRecent([cmd.id, ...recent.filter((id) => id !== cmd.id)].slice(0, RECENT_CAP));
    },
    [recent, setRecent],
  );

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        recentIds={recent}
        onRun={onRun}
      />
      <ShortcutsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
