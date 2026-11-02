# Plan

Goal: every Mission document link opens in the Info sidebar Viewer and dead paths stop being links.
Reason: after #563/#564 Mission links still opened a second viewer, a hand-off path did nothing and Outputs rows said File not found.
Reference: .shipwright/agent_docs/iterates/iterate-2026-11-02-mission-links-viewer-probe.json

Small bug iterate, five Mission link fixes: MissionBody openDoc -> MissionInfoSidebar docs (no middle panel, phone tabs Overview/Activity/Info); POST session-file/probe (V4 decision core, yes/no only) plus pathProbe/useOpenable for chat chips, Outputs rows and terminal links; Outputs missing tag; nested sub-agent transcript regression fixture.
