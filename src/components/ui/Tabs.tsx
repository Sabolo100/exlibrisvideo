'use client';

import { motion } from 'motion/react';
import {
  createContext,
  useContext,
  useId,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { useControllableState } from './hooks';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
  variant: 'underline' | 'pill';
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used inside <Tabs>');
  return ctx;
}

const safe = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface TabsProps {
  /** controlled value */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: 'underline' | 'pill';
  className?: string;
  children: ReactNode;
}

/**
 * Accessible tabs (automatic activation, arrow keys / Home / End).
 *   <Tabs defaultValue="a"><TabsList aria-label="…"><TabsTrigger value="a">A</TabsTrigger></TabsList>
 *   <TabsContent value="a">…</TabsContent></Tabs>
 */
export function Tabs({ value, defaultValue = '', onValueChange, variant = 'underline', className, children }: TabsProps) {
  const [current, setCurrent] = useControllableState(value, defaultValue, onValueChange);
  const baseId = useId();
  return (
    <TabsContext.Provider value={{ value: current, setValue: setCurrent, baseId, variant }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export type TabsListProps = ComponentPropsWithRef<'div'> & { 'aria-label'?: string };

export function TabsList({ className, children, onKeyDown, ...rest }: TabsListProps) {
  const { variant } = useTabs();
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  };
  return (
    <div
      role="tablist"
      onKeyDown={handleKey}
      className={cn(
        'relative flex max-w-full items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        variant === 'underline' ? 'gap-1 border-b border-line' : 'gap-1 rounded-xl bg-surface-2 p-1',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type TabsTriggerProps = Omit<ComponentPropsWithRef<'button'>, 'value'> & {
  value: string;
  icon?: ReactNode;
  /** small count badge */
  count?: number | string;
};

export function TabsTrigger({ value, icon, count, className, children, disabled, onClick, ...rest }: TabsTriggerProps) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  const id = `${ctx.baseId}-tab-${safe(value)}`;
  const panelId = `${ctx.baseId}-panel-${safe(value)}`;
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx.setValue(value);
      }}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center gap-2 font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4',
        ctx.variant === 'underline' ? 'h-10 px-3 text-sm' : 'h-8 rounded-lg px-3 text-sm',
        selected ? 'text-ink' : 'text-muted hover:text-ink',
        className,
      )}
      {...rest}
    >
      {selected ? (
        ctx.variant === 'underline' ? (
          <motion.span
            layoutId={`${ctx.baseId}-indicator`}
            aria-hidden="true"
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
          />
        ) : (
          <motion.span
            layoutId={`${ctx.baseId}-indicator`}
            aria-hidden="true"
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className="absolute inset-0 rounded-lg bg-surface shadow-[0_1px_2px_hsl(var(--shadow-color)/0.14)]"
          />
        )
      ) : null}
      {icon ? <span className="relative inline-flex">{icon}</span> : null}
      <span className="relative">{children}</span>
      {count !== undefined ? (
        <span
          className={cn(
            'relative rounded-full px-1.5 text-[0.6875rem] leading-[1.125rem] font-semibold tabular-nums',
            selected ? 'bg-accent-soft text-[#7a561b] dark:text-accent' : 'bg-surface-2 text-muted',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export type TabsContentProps = Omit<ComponentPropsWithRef<'div'>, 'value'> & {
  value: string;
  /** keep inactive panels mounted (hidden) to preserve their state */
  keepMounted?: boolean;
};

export function TabsContent({ value, keepMounted = false, className, children, ...rest }: TabsContentProps) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  if (!selected && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${safe(value)}`}
      aria-labelledby={`${ctx.baseId}-tab-${safe(value)}`}
      hidden={!selected}
      tabIndex={0}
      className={cn('outline-offset-4', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
