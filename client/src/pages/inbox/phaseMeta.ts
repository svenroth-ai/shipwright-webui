/* Leaf module: phase ids + icons shared by InboxCard and InboxCardShell (no import cycle). */
import {
  Hammer,
  ListChecks,
  Palette,
  FlaskConical,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from "lucide-react";


// Known phase ids (mirrors PIPELINE_PHASES but we intentionally don't couple
// to Kanban phaseMapping, which uses a slightly different vocab). Used as the
// classifyPhase allowlist to derive a best-effort phase tag for the context
// pill from the task title.
export const KNOWN_PHASES = [
  "project",
  "design",
  "plan",
  "build",
  "test",
  "security",
  "compliance",
  "changelog",
  "deploy",
] as const;

export const PHASE_ICON: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  build: Hammer,
  design: Palette,
  plan: ListChecks,
  project: ListChecks,
  test: FlaskConical,
  deploy: Rocket,
  compliance: ShieldCheck,
  security: ShieldAlert,
  changelog: Workflow,
};
