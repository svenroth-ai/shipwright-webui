/*
 * MobileTopBarSlot — a portal target that lets a page inject content into the
 * global phone top bar (the "Shipwright" strip in MainLayout) without coupling
 * the shell to page internals.
 *
 * iterate-2026-06-15-mobile-tablet-layout-polish (AC-1): on phones the Task
 * Board moves its <ProjectFilterDropdown/> up next to the brand. The dropdown
 * is board-scoped and reads the module-level useProjectFilter store, so the
 * board portals its OWN instance into this slot — MainLayout stays generic and
 * other routes leave the slot empty.
 *
 * Lifecycle (plan-review M1): the slot element is published via useState (NOT a
 * raw ref), so the publish triggers a re-render of the portal consumer. On the
 * first paint the slot is null and the consumer portals nothing; after the
 * target mounts and publishes, the provider re-renders and the portal appears.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface MobileTopBarSlotValue {
  /** The live slot element, or null until the target mounts. */
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

const MobileTopBarSlotContext = createContext<MobileTopBarSlotValue | null>(
  null,
);

export function MobileTopBarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <MobileTopBarSlotContext.Provider value={{ slot, setSlot }}>
      {children}
    </MobileTopBarSlotContext.Provider>
  );
}

/** Consumer hook — returns null when rendered outside a provider. */
export function useMobileTopBarSlot(): MobileTopBarSlotValue | null {
  return useContext(MobileTopBarSlotContext);
}

/**
 * Renders the slot <div> and publishes it to the context once mounted. Place
 * this inside the phone top bar. `setSlot` from useState has a stable identity,
 * so the effect runs once on mount and cleans up on unmount (no render loop).
 */
export function MobileTopBarSlotTarget({ className }: { className?: string }) {
  const ctx = useContext(MobileTopBarSlotContext);
  const ref = useRef<HTMLDivElement>(null);
  const setSlot = ctx?.setSlot;
  useEffect(() => {
    if (!setSlot) return;
    setSlot(ref.current);
    return () => setSlot(null);
  }, [setSlot]);
  return (
    <div ref={ref} className={className} data-testid="mobile-topbar-slot" />
  );
}
