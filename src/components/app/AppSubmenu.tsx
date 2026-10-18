'use client';

/**
 * The phone app's view submenu: a small, differently tinted strip glued on top of the bottom menu.
 * The catalogue screen owns the slot (<AppSubmenuProvider> + <AppSubmenuSlot>); a view puts its own
 * options there with <AppSubmenu> (a portal), so grouping / sorting / layout choices sit right above
 * the thumb instead of on top of the content. Outside the app shell <AppSubmenu> renders nothing and
 * `useAppSubmenu()` reports `false`, so views keep their web option bars there.
 */
import { ArrowLeftRight } from 'lucide-react';
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

/**
 * Where the submenu strip renders (inside the bottom bar): the view's options scroll sideways, `trailing`
 * (the scan picker) stays pinned at the right end and keeps the strip shown even without view options.
 */
export function AppSubmenuSlot({ label, className, trailing }: { label: string; className?: string; trailing?: ReactNode }) {
  const ctx = useContext(SubmenuContext);
  const active = (ctx?.count ?? 0) > 0 || Boolean(trailing);
  return (
    <div role="group" aria-label={label} hidden={!active} className={cn('app-chrome app-submenu relative flex h-11 items-center', className)}>
      <div
        ref={ctx?.setSlot}
        className="app-scroll flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-3 whitespace-nowrap [&>*]:shrink-0"
      />
      {trailing ? <div className="flex h-full shrink-0 items-center border-l border-[var(--submenu-line)] pr-2 pl-1.5">{trailing}</div> : null}
    </div>
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

/**
 * A two-way setting as ONE chip: it shows the current choice and switches to the other one when tapped
 * (standing ⇄ lying, A–Z ⇄ most books …) – half the width of two chips.
 */
export function SubmenuToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  /** exactly two choices: [value, text, icon?] */
  options: readonly [readonly [T, string, ReactNode?], readonly [T, string, ReactNode?]];
  onChange: (next: T) => void;
  /** what the setting is ("Arrangement") – for screen readers and the tooltip */
  label: string;
}) {
  const current = options[0][0] === value ? options[0] : options[1];
  const other = current === options[0] ? options[1] : options[0];
  return (
    <button
      type="button"
      onClick={() => onChange(other[0])}
      aria-label={`${label}: ${current[1]}`}
      title={`${label}: ${current[1]} ⇄ ${other[1]}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--submenu-active)] pr-2 pl-3 text-[0.8125rem] font-medium text-[var(--submenu-active-ink)] shadow-[0_1px_2px_rgb(0_0_0/0.18)] transition-transform duration-150 active:scale-95 [&_svg]:size-4"
    >
      {current[2]}
      {current[1]}
      <ArrowLeftRight aria-hidden="true" className="!size-3.5 opacity-55" />
    </button>
  );
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
