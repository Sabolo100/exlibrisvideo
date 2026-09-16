import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium leading-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ease-out ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ' +
  '[&_svg]:shrink-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_hsl(var(--shadow-color)/0.25)] hover:bg-primary-hover',
  secondary:
    'border border-line bg-surface text-ink shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08)] hover:border-[color-mix(in_oklab,var(--line),var(--ink)_18%)] hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2 active:bg-[color-mix(in_oklab,var(--surface-2),var(--ink)_6%)]',
  danger:
    'bg-danger text-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_hsl(var(--shadow-color)/0.25)] hover:brightness-110',
  gold:
    'border border-[#9c7424] bg-[linear-gradient(180deg,#ecd08e_0%,#d3a855_48%,#b98b3a_100%)] text-[#2a1c08] ' +
    'shadow-[inset_0_1px_0_rgb(255_250_230/0.65),inset_0_-1px_0_rgb(90_60_10/0.25),0_1px_3px_hsl(var(--shadow-color)/0.3)] ' +
    'hover:brightness-105 dark:border-[#c89b4c]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-[0.8125rem] [&_svg]:size-4',
  md: 'h-10 rounded-[0.625rem] px-4 text-[0.9375rem] [&_svg]:size-[1.125rem]',
  lg: 'h-12 rounded-xl px-6 text-base [&_svg]:size-5',
};

/** `tone="danger"` for the quiet variants: red text, red-tinted hover (e.g. "Törlés" in a drawer footer). */
const DANGER_TONE: Partial<Record<ButtonVariant, string>> = {
  secondary:
    'border border-line bg-surface text-danger shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08)] hover:border-[color-mix(in_oklab,var(--danger)_40%,var(--line))] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))]',
  ghost:
    'text-danger hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] active:bg-[color-mix(in_oklab,var(--danger)_16%,transparent)]',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** "danger" recolours the secondary / ghost variants (ignored for filled variants) */
  tone?: 'default' | 'danger';
  fullWidth?: boolean;
}

/**
 * The button look as a class string – use it to style non-button elements consistently,
 * e.g. a `<label htmlFor="file">` acting as an upload button.
 */
export function buttonClasses({ variant = 'secondary', size = 'md', tone = 'default', fullWidth = false }: ButtonStyleOptions = {}): string {
  const look = (tone === 'danger' && DANGER_TONE[variant]) || VARIANTS[variant];
  return cn(BASE, look, SIZES[size], fullWidth && 'w-full');
}

interface CommonProps extends ButtonStyleOptions {
  /** shows a spinner (replacing leftIcon), sets aria-busy and disables the button */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export type ButtonAsButtonProps = CommonProps &
  Omit<ComponentPropsWithRef<'button'>, keyof CommonProps> & { href?: undefined };

export type ButtonAsLinkProps = CommonProps &
  Omit<ComponentPropsWithRef<'a'>, keyof CommonProps | 'href'> & {
    href: string;
    /** force a plain <a> (automatic for http(s):, mailto:, tel:, download and target=_blank) */
    external?: boolean;
    /** next/link prefetch */
    prefetch?: boolean;
    replace?: boolean;
    scroll?: boolean;
    disabled?: boolean;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) && !href.startsWith('/');
}

/**
 * Primary action element. Renders a `<button type="button">`, or a next/link `<Link>` when
 * `href` is given (plain `<a>` for external/mailto/download links). `ref` is a normal prop.
 */
export function Button(props: ButtonProps) {
  const { variant = 'secondary', size = 'md', tone, fullWidth, loading = false, leftIcon, rightIcon, className, children } = props;
  const classes = cn(buttonClasses({ variant, size, tone, fullWidth }), className);
  const content = (
    <>
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} decorative /> : leftIcon}
      {children !== undefined && children !== null && children !== false ? <span className="truncate">{children}</span> : null}
      {rightIcon}
    </>
  );

  if (props.href !== undefined) {
    const {
      href,
      external,
      prefetch,
      replace,
      scroll,
      disabled,
      variant: _v,
      size: _s,
      tone: _t,
      fullWidth: _f,
      loading: _l,
      leftIcon: _li,
      rightIcon: _ri,
      className: _c,
      children: _ch,
      ...anchorProps
    } = props;
    const inert = disabled || loading;
    const common = {
      ...anchorProps,
      className: classes,
      'aria-disabled': inert || undefined,
      'aria-busy': loading || undefined,
      tabIndex: inert ? -1 : anchorProps.tabIndex,
    };
    if (inert || external || isExternalHref(href) || anchorProps.download !== undefined || anchorProps.target === '_blank') {
      return (
        <a
          href={inert ? undefined : href}
          rel={anchorProps.target === '_blank' ? (anchorProps.rel ?? 'noopener noreferrer') : anchorProps.rel}
          {...common}
        >
          {content}
        </a>
      );
    }
    return (
      <Link href={href} prefetch={prefetch} replace={replace} scroll={scroll} {...common}>
        {content}
      </Link>
    );
  }

  const {
    variant: _v,
    size: _s,
    tone: _t,
    fullWidth: _f,
    loading: _l,
    leftIcon: _li,
    rightIcon: _ri,
    className: _c,
    children: _ch,
    href: _h,
    type = 'button',
    disabled,
    ...buttonProps
  } = props;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...buttonProps}
    >
      {content}
    </button>
  );
}
