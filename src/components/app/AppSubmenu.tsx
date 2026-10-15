'use client';

/**
 * The phone app's view submenu: a small, differently tinted strip glued on top of the bottom menu.
 * The catalogue screen owns the slot (<AppSubmenuProvider> + <AppSubmenuSlot>); a view puts its own
 * options there with <AppSubmenu> (a portal), so grouping / sorting / layout choices sit right above
 * the thumb instead of on top of the content. Outside the app shell <AppSubmenu> renders nothing and
 * `useAppSubmenu()` reports `false`, so views keep their web option bars there.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/components/ui';

interface SubmenuContextValue {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
  /** number of mounted <AppSubmenu> portals (the bottom bar shows the strip only while one is mounted) */
  count: number;
  register: () => () => void;
}

const SubmenuContext = createContext<SubmenuContextValue | null>(null);

export function AppSubmenuProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);
  const register = useCallback(() => {
    setCount((c) => c + 1);
    return () => setCount((c) => c - 1);
  }, []);
  const value = useMemo(() => ({ slot, setSlot, count, register }), [slot, count, register]);
  return <SubmenuContext.Provider value={value}>{children}</SubmenuContext.Provider>;
}

/** true inside the app catalogue screen: the view's options belong in <AppSubmenu>. */
export function useAppSubmenu(): boolean {
  return useContext(SubmenuContext) !== null;
}

/** true while some view has put options into the submenu. */
export function useAppSubmenuActive(): boolean {
  return (useContext(SubmenuContext)?.count ?? 0) > 0;
}

/** Where the submenu strip renders (inside the bottom bar). */
export function AppSubmenuSlot({ label, className }: { label: string; className?: string }) {
  const ctx = useContext(SubmenuContext);
  const active = (ctx?.count ?? 0) > 0;
  return (
    <div
      role="group"
      aria-label={label}
      hidden={!active}
      ref={ctx?.setSlot}
      className={cn(
        'app-chrome app-scroll app-submenu flex h-11 items-center gap-1.5 overflow-x-auto px-3 whitespace-nowrap [&>*]:shrink-0',
        className,
      )}
    />
  );
}

/** A view's options, rendered into the submenu strip. */
export function AppSubmenu({ children }: { children: ReactNode }) {
  const ctx = useContext(SubmenuContext);
  const register = ctx?.register;
  useEffect(() => register?.(), [register]);
  if (!ctx?.slot) return null;
  return createPortal(children, ctx.slot);
}

/** A labelled run of chips inside the submenu ("Csoport: Nincs · Téma · …"). */
export function SubmenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {label ? <span className="pr-0.5 pl-1 text-[0.6875rem] font-semibold tracking-wide text-[var(--submenu-muted)] uppercase">{label}</span> : null}
      {children}
    </div>
  );
}

/** A thin divider between submenu groups. */
export function SubmenuDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--submenu-line)]" />;
}

export function SubmenuChip({
  active,
  onClick,
  icon,
  children,
  disabled,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  /** accessible name when the chip shows only an icon */
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-full px-3 text-[0.8125rem] font-medium transition-colors duration-150 disabled:opacity-40 [&_svg]:size-4',
        active
          ? 'bg-[var(--submenu-active)] text-[var(--submenu-active-ink)] shadow-[0_1px_2px_rgb(0_0_0/0.18)]'
          : 'text-[var(--submenu-ink)] active:bg-[var(--submenu-press)]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
