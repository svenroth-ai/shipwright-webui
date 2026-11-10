Goal: SmartViewer follows relative links between files across sibling folders in-pane, like VS Code
Reason: Clicking a relative link in a viewed markdown opened a localhost:<port> address (non-md) or did nothing (outside files); %20 paths were double-encoded
Reference: iterate/md-relative-links
AC item: {"confirmed": false, "decided_by": "code", "files": ["client/src/components/external/SmartViewer.tsx", "client/src/components/external/SmartViewer/DocumentMarkdown.tsx", "client/src/components/external/SmartViewer/useDocNavigation.ts"], "kind": "add", "new_text": "A relative link between files in the file viewer, including links across sibling folders, opens the linked file in the viewer itself, for every file type and for files outside the project too, instead of opening a localhost address in the browser.", "owner_fr": "FR-01.02"}
AC decisions: [{"ac": "FR-01.02.new", "mode": "auto", "answer": "auto", "kind": "add", "answered_via": "none", "decided_by": "code", "confirmed": false}]
