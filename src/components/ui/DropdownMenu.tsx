'use client';

import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import type { Align, Side } from './floating';
import { isTopLayer, useControllableState, useEscape, useFloating, useLayer, useOutsidePointerDown } from './hooks';
import { Portal } from './Portal';

interface ItemBase {
  /** stable React key (defaults to the index) */
  key?: string;
  label: ReactNode;
  /** text used for type-ahead when `label` is not a string */
  textValue?: string;
  icon?: ReactNode;
  description?: ReactNode;
  /** right-aligned hint, e.g. "⌘K" */
  shortcut?: string;
  disabled?: boolean;
}

export interface DropdownActionItem extends ItemBase {
  type?: 'item';
  onSelect?: () => void;
  /** renders a link (next/link for internal paths, <a> for external / download) */
  href?: string;
  download?: boolean | string;
  target?: string;
  tone?: 'default' | 'danger';
  /** keep the menu open after selecting (default false) */
  keepOpen?: boolean;
}

export interface DropdownCheckboxItem extends ItemBase {
  type: 'checkbox';
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface DropdownRadioItem extends ItemBase {
  type: 'radio';
  checked: boolean;
  onSelect: () => void;
}

export interface DropdownSeparator {
  type: 'separator';
  key?: string;
}

export interface DropdownLabel {
  type: 'label';
  key?: string;
  label: ReactNode;
}

export type DropdownMenuItem = DropdownActionItem | DropdownCheckboxItem | DropdownRadioItem | DropdownSeparator | DropdownLabel;

export interface DropdownMenuProps {
  /** Button / IconButton that opens the menu (click, Enter, Space, ArrowDown, ArrowUp) */
  trigger: ReactElement;
  items: DropdownMenuItem[];
  side?: Side;
  align?: Align;
  /** accessible name of the menu (defaults to the trigger's name via aria-labelledby when absent) */
  'aria-label'?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** min width in px (default 12rem) */
  minWidth?: number;
}

type Focusable = Exclude<DropdownMenuItem, DropdownSeparator | DropdownLabel>;

function isFocusable(item: DropdownMenuItem): item is Focusable {
  return item.type !== 'separator' && item.type !== 'label';
}

function textOf(item: Focusable): string {
  if (item.textValue) return item.textValue;
  return typeof item.label === 'string' ? item.label : '';
}

/**
 * Keyboard-navigable action menu (WAI-ARIA menu button pattern): arrows, Home/End, type-ahead,
 * Enter/Space to select, Esc/Tab to close; focus returns to the trigger.
 */
export function DropdownMenu({
  trigger,
  items,
  side = 'bottom',
  align = 'end',
  'aria-label': ariaLabel,
  open: openProp,
  onOpenChange,
  className,
  minWidth,
}: DropdownMenuProps) {
  const [open, setOpen] = useControllableState(openProp, false, onOpenChange);
  const [active, setActive] = useState(-1);
  const menuId = useId();
  const triggerId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const typeahead = useRef({ text: '', at: 0 });
  const initialFocus = useRef<'first' | 'last'>('first');
  const layer = useLayer(open);
  const pos = useFloating({ open, anchorRef, floatingRef: menuRef, side, align, offset: 6 });

  const enabledIndexes = items.map((it, i) => (isFocusable(it) && !it.disabled ? i : -1)).filter((i) => i >= 0);

  const focusTrigger = () => {
    const el = anchorRef.current?.querySelector<HTMLElement>('button, a, [tabindex]');
    el?.focus({ preventScroll: true });
  };

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      setActive(-1);
      if (restoreFocus) requestAnimationFrame(focusTrigger);
    },
    [setOpen],
  );

  useEscape(open, layer, () => close(true));
  useOutsidePointerDown(open, [anchorRef, menuRef], () => {
    if (isTopLayer(layer)) close(false);
  });

  // focus the first / last enabled item once the menu is mounted
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const idx = initialFocus.current === 'last' ? enabledIndexes[enabledIndexes.length - 1] : enabledIndexes[0];
      if (idx === undefined) {
        menuRef.current?.focus();
        return;
      }
      setActive(idx);
      itemRefs.current[idx]?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const focusIndex = (idx: number) => {
    setActive(idx);
    itemRefs.current[idx]?.focus({ preventScroll: true });
  };

  const openWith = (where: 'first' | 'last') => {
    initialFocus.current = where;
    setOpen(true);
  };

  const select = (item: Focusable) => {
    if (item.disabled) return;
    if (item.type === 'checkbox') {
      item.onCheckedChange(!item.checked);
      return; // checkbox items keep the menu open
    }
    item.onSelect?.();
    if (item.type === 'radio' || !item.keepOpen) close(true);
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pos = enabledIndexes.indexOf(active);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (enabledIndexes.length) focusIndex(enabledIndexes[(pos + 1) % enabledIndexes.length]);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (enabledIndexes.length)
          focusIndex(enabledIndexes[(pos - 1 + enabledIndexes.length) % enabledIndexes.length]);
        return;
      case 'Home':
        e.preventDefault();
        if (enabledIndexes.length) focusIndex(enabledIndexes[0]);
        return;
      case 'End':
        e.preventDefault();
        if (enabledIndexes.length) focusIndex(enabledIndexes[enabledIndexes.length - 1]);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        break;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      const now = Date.now();
      const ta = typeahead.current;
      ta.text = now - ta.at > 700 ? e.key.toLowerCase() : ta.text + e.key.toLowerCase();
      ta.at = now;
      const ordered = [...enabledIndexes.slice(pos + 1), ...enabledIndexes.slice(0, pos + 1)];
      const match = ordered.find((i) =>
        textOf(items[i] as Focusable)
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .startsWith(ta.text.normalize('NFD').replace(/\p{M}/gu, '')),
      );
      if (match !== undefined) focusIndex(match);
    }
  };

  const triggerEl = isValidElement<Record<string, unknown>>(trigger)
    ? cloneElement(trigger, {
        id: (trigger.props.id as string | undefined) ?? triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: (e: MouseEvent) => {
          (trigger.props.onClick as ((ev: MouseEvent) => void) | undefined)?.(e);
          if (e.defaultPrevented) return;
          if (open) close(false);
          else openWith('first');
        },
        onKeyDown: (e: KeyboardEvent) => {
          (trigger.props.onKeyDown as ((ev: KeyboardEvent) => void) | undefined)?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            openWith('first');
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            openWith('last');
          }
        },
      })
    : trigger;

  const labelledBy = ariaLabel ? undefined : ((isValidElement<Record<string, unknown>>(trigger) && (trigger.props.id as string)) || triggerId);

  itemRefs.current.length = items.length;

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        {triggerEl}
      </span>
      <Portal>
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={menuRef}
              id={menuId}
              role="menu"
              data-exl-floating=""
              aria-label={ariaLabel}
              aria-labelledby={labelledBy}
              aria-orientation="vertical"
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              initial={{ opacity: 0, y: pos.side === 'top' ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: pos.ready ? 1 : 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                top: pos.y,
                left: pos.x,
                minWidth: Math.max(minWidth ?? 192, pos.anchorWidth),
                maxHeight: pos.available > 0 ? pos.available : undefined,
              }}
              className={cn(
                'z-[66] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1 text-ink shadow-lift outline-none',
                className,
              )}
            >
              {items.map((item, i) => {
                const key = item.key ?? String(i);
                if (item.type === 'separator') {
                  return <div key={key} role="separator" className="-mx-1 my-1 h-px bg-line/80" />;
                }
                if (item.type === 'label') {
                  return (
                    <div
                      key={key}
                      role="presentation"
                      className="px-2.5 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase"
                    >
                      {item.label}
                    </div>
                  );
                }
                const isActive = active === i;
                const danger = item.type !== 'checkbox' && item.type !== 'radio' && item.tone === 'danger';
                const role = item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem';
                const checked = item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined;
                const classes = cn(
                  'flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none select-none',
                  '[&_svg]:size-4 [&_svg]:shrink-0',
                  isActive && (danger ? 'bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]' : 'bg-surface-2'),
                  danger ? 'text-danger' : 'text-ink',
                  item.disabled && 'cursor-not-allowed opacity-45',
                );
                const inner = (
                  <>
                    {checked !== undefined ? (
                      <span className="mt-0.5 inline-flex size-4 items-center justify-center text-primary">
                        {checked ? <Check aria-hidden="true" strokeWidth={2.5} /> : null}
                      </span>
                    ) : item.icon ? (
                      <span className={cn('mt-0.5 inline-flex', danger ? 'text-danger' : 'text-muted')} aria-hidden="true">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.description ? (
                        <span className="mt-0.5 block text-xs text-muted">{item.description}</span>
                      ) : null}
                    </span>
                    {item.shortcut ? <span className="mt-0.5 text-xs text-muted">{item.shortcut}</span> : null}
                  </>
                );
                const common = {
                  role,
                  'aria-checked': checked,
                  'aria-disabled': item.disabled || undefined,
                  tabIndex: -1,
                  className: classes,
                  onMouseMove: () => {
                    if (!item.disabled && active !== i) focusIndex(i);
                  },
                };
                if ((item.type === undefined || item.type === 'item') && item.href && !item.disabled) {
                  const external =
                    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(item.href) || item.download !== undefined || item.target === '_blank';
                  const onClick = () => {
                    item.onSelect?.();
                    close(false);
                  };
                  return external ? (
                    <a
                      key={key}
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      href={item.href}
                      download={item.download === true ? '' : item.download || undefined}
                      target={item.target}
                      rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
                      onClick={onClick}
                      {...common}
                    >
                      {inner}
                    </a>
                  ) : (
                    <Link
                      key={key}
                      ref={(el: HTMLAnchorElement | null) => {
                        itemRefs.current[i] = el;
                      }}
                      href={item.href}
                      onClick={onClick}
                      {...common}
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <div
                    key={key}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    onClick={() => select(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(item);
                      }
                    }}
                    {...common}
                  >
                    {inner}
                  </div>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Portal>
    </>
  );
}
