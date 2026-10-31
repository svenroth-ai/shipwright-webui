# Mini-plan V5 flat file tree + context menu
- FolderTree.tsx (shared): new props `flat` (no card chrome) and `projectRoot` (absolute Copy Path). Row extracted to FolderTreeRow.tsx (select button, "..." touch button, onContextMenu, 500ms touch long-press). Menu extracted to FolderTreeMenu.tsx: Radix DropdownMenu anchored at the cursor via a fixed 1px virtual trigger (no new dependency; react-context-menu is not installed) for pointer, Radix Dialog bottom sheet (48px items) for touch. Items: Open in Viewer (files only), Copy Path, Copy Relative Path; no shortcut hints.
- folderTreePaths.ts: absolute/relative path + clipboard helper with textarea fallback. "Path copied" role=status toast.
- Keyboard: arrows/Enter existing; ContextMenu key / Shift+F10 opens menu; Esc via Radix; focus returns to the row.
- styles/folder-tree.css: 15px tree, 28px rows, ignored italic muted, 44px coarse targets, 3px teal focus ring, footer. Imported from index.css.
- MissionInfoSidebar passes flat + projectRoot (useProject). TaskDetailPage (Files & Terminal) untouched (not wired yet) but gets 15px font.
- Tests: FolderTreeMenu.test.tsx; existing FolderTree tests kept. FolderTree.tsx drops 394 -> 300 lines.
