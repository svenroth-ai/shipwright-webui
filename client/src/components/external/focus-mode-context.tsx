/*
 * FocusModeContext — bridges the "maximize terminal" toggle (A18, FR-01.62)
 * from the resizable shell (TaskDetailThreePane, which owns useThreePaneLayout)
 * to the maximize control rendered in the MIDDLE card's `.ft-head` (built up in
 * TaskDetailPage and passed to the shell as `center`, i.e. a shell descendant).
 *
 * Why a context and not a prop: the middle card's head must live under the SAME
 * Radix Tabs.Root as its body (the Transcript/Terminal tabs pin
 * getByRole("tab") for the whole terminal E2E corpus), so the card is composed
 * in the page. The shell provides this context around its children; the page's
 * center — rendered as a shell descendant — consumes it. No prop plumbing, no
 * lifted hook, and the shell's public contract is unchanged.
 *
 * The DEFAULT value is a safe no-op so the maximize button renders (and does
 * nothing) when the card is mounted OUTSIDE the shell — e.g. TaskDetailPage.test
 * mocks TaskDetailThreePane, so `center` renders without the provider.
 */

import { createContext, useContext } from "react";

export interface FocusModeApi {
  maximized: boolean;
  toggle: () => void;
}

const NOOP: FocusModeApi = { maximized: false, toggle: () => {} };

export const FocusModeContext = createContext<FocusModeApi>(NOOP);

export function useFocusMode(): FocusModeApi {
  return useContext(FocusModeContext);
}
