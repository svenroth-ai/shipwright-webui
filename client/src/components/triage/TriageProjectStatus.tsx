/*
 * TriageProjectStatus — notices in the summary row above the list
 * (iterate-2026-11-08-triage-page-redesign): a loading line and a load-error
 * block with Retry per project, plus ONE compact orange alert when any
 * project's checkout is behind origin (iterate-2026-11-13-triage-alerts-round4;
 * it used to be one wide chip per project that wrapped). The alert only says
 * THAT something is behind; which projects and by how many commits is in a
 * popover — on hover with a mouse, on tap with touch. Portaled, so the row
 * never clips it.
 */

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { TriangleAlert } from "lucide-react";

import type { TriageProjectStatus as Status } from "../../hooks/useTriage";
import { ListLoadErrorState } from "../common/ListLoadErrorState";

interface Props {
  statuses: readonly Status[];
  nameOf: (projectId: string) => string;
  /** Show the project name in each notice (several projects in scope). */
  named: boolean;
}

const CLOSE_DELAY_MS = 120;

function BehindAlert({ behind, nameOf, named }: { behind: readonly Status[]; nameOf: Props["nameOf"]; named: boolean }) {
  const [open, setOpen] = useState(false);
  const mouse = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverOpen = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const plural = behind.length > 1;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="triage-behind-alert"
          onPointerEnter={(e) => {
            mouse.current = e.pointerType === "mouse";
            if (mouse.current) hoverOpen();
          }}
          onPointerLeave={() => mouse.current && hoverClose()}
          onKeyDown={() => {
            mouse.current = false; // keyboard use toggles by click/Enter like any button
          }}
          // With a mouse the hover already opened it: a click must not toggle it shut again (a click while closed, e.g. assistive tech, still opens).
          onClick={(e) => mouse.current && open && e.preventDefault()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--warn-solid)]/45 bg-[color-mix(in_srgb,var(--warn-solid)_20%,var(--triage-lane-solid))] px-3 text-[13px] text-white/90 transition-colors hover:border-[var(--warn-solid)]/70"
        >
          <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-[var(--warn-solid)]" />
          {plural ? "Projects" : "A project"} behind origin
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={() => mouse.current && hoverOpen()}
          onPointerLeave={() => mouse.current && hoverClose()}
          aria-label="Projects behind origin"
          data-testid="triage-behind-popover"
          className="z-[70] grid w-[min(340px,calc(100vw-16px))] gap-1.5 rounded-lg border border-[var(--warn-solid)]/45 bg-[var(--triage-lane-solid)] p-3 text-[13px] text-white/90 shadow-lg"
        >
          {behind.map((s) => (
            <p key={s.projectId} className="m-0" data-testid={`triage-behind-${s.projectId}`}>
              {named && <b className="font-semibold text-white">{nameOf(s.projectId)}: </b>}
              {s.behind} commit{s.behind === 1 ? "" : "s"} behind origin
              {s.originAvailable ? "" : " — origin is unavailable, so already-dismissed items may still appear here"}
            </p>
          ))}
          <p className="m-0 text-xs text-white/70">
            Run <code className="rounded bg-white/15 px-1 font-mono text-white">git pull</code> in the checkout to catch up.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TriageProjectStatus({ statuses, nameOf, named }: Props) {
  const behind = statuses.filter((s) => !s.isError && !s.isLoading && s.behind != null && s.behind > 0);
  return (
    <>
      {statuses.map((s) => {
        if (s.isError) {
          return (
            <div key={s.projectId} className="basis-full">
              {named && <p className="mb-1 text-xs text-[var(--ink)]">{nameOf(s.projectId)}</p>}
              <ListLoadErrorState
                testId={`triage-load-error-${s.projectId}`}
                label="triage items"
                onRetry={s.refetch}
              />
            </div>
          );
        }
        if (s.isLoading) {
          return (
            <p
              key={s.projectId}
              className="m-0 basis-full text-sm text-[var(--muted)]"
              data-testid={`triage-loading-${s.projectId}`}
            >
              {named ? `${nameOf(s.projectId)}: ` : ""}Loading…
            </p>
          );
        }
        return null;
      })}
      {behind.length > 0 && <BehindAlert behind={behind} nameOf={nameOf} named={named} />}
    </>
  );
}
