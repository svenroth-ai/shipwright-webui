/*
 * Public re-export so legacy import paths keep working:
 *
 *   import { NewIssueModal } from "../components/external/NewIssueModal";
 *
 * Both call-sites (`TaskBoardPage`, `TriagePage`) use the extensionless
 * path. Vite + Vitest + tsc all resolve this directory's index.tsx —
 * verified pre-build per Step 3.5 review OpenAI #1.
 */

export { NewIssueModal } from "./NewIssueModal";
export type { NewIssueModalProps } from "./NewIssueModal";
