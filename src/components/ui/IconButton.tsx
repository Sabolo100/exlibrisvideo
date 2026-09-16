import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { ButtonVariant } from './Button';
import { cn } from './cn';
import { Spinner } from './Spinner';
import { Tooltip, type TooltipProps } from './Tooltip';

export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover shadow-[0_1px_2px_hsl(var(--shadow-color)/0.25)]',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2 shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08)]',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'text-danger hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]',
  gold:
    'border border-[#9c7424] bg-[linear-gradient(180deg,#ecd08e,#c49645)] text-[#2a1c08] shadow-[inset_0_1px_0_rgb(255_250_230/0.6)] hover:brightness-105',
};

const SIZES: Record<IconButtonSize, string> = {
  xs: 'size-7 rounded-md [&_svg]:size-3.5',
  sm: 'size-8 rounded-lg [&_svg]:size-4',
  md: 'size-10 rounded-[0.625rem] [&_svg]:size-5',
  lg: 'size-12 rounded-xl [&_svg]:size-6',
};

interface CommonProps {
  /** required: the accessible name (icons have no text) */
  'aria-label': string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: IconButtonSize;
  /** circular instead of rounded square */
  round?: boolean;
  loading?: boolean;
  /** show the aria-label as a tooltip (true) or custom tooltip content */
  tooltip?: boolean | ReactNode;
  tooltipSide?: TooltipProps['side'];
  className?: string;
}

export type IconButtonProps =
  | (CommonProps & Omit<ComponentPropsWithRef<'button'>, keyof CommonProps | 'children'> & { href?: undefined })
  | (CommonProps & Omit<ComponentPropsWithRef<'a'>, keyof CommonProps | 'children' | 'href'> & { href: string });

/** Square icon-only button. `aria-label` is required; `tooltip` repeats it visually. */
export function IconButton(props: IconButtonProps) {
  const {
    icon,
    variant = 'ghost',
    size = 'md',
    round = false,
    loading = false,
    tooltip,
    tooltipSide,
    className,
    'aria-label': ariaLabel,
  } = props;
  const classes = cn(
    'relative inline-flex shrink-0 select-none items-center justify-center transition-[background-color,color,box-shadow,transform,filter] duration-150',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    round && 'rounded-full',
    className,
  );
  const inner = loading ? <Spinner size="sm" decorative /> : icon;

  let element: ReactNode;
  if (props.href !== undefined) {
    const {
      icon: _i,
      variant: _v,
      size: _s,
      round: _r,
      loading: _l,
      tooltip: _t,
      tooltipSide: _ts,
      className: _c,
      href,
      ...rest
    } = props;
    const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || rest.download !== undefined || rest.target === '_blank';
    element = external ? (
      <a href={href} {...rest} aria-label={ariaLabel} className={classes}>
        {inner}
      </a>
    ) : (
      <Link href={href} {...rest} aria-label={ariaLabel} className={classes}>
        {inner}
      </Link>
    );
  } else {
    const {
      icon: _i,
      variant: _v,
      size: _s,
      round: _r,
      loading: _l,
      tooltip: _t,
      tooltipSide: _ts,
      className: _c,
      href: _h,
      type = 'button',
      disabled,
      ...rest
    } = props;
    element = (
      <button
        type={type}
        {...rest}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        aria-label={ariaLabel}
        className={classes}
      >
        {inner}
      </button>
    );
  }

  if (!tooltip) return element;
  return (
    <Tooltip content={tooltip === true ? ariaLabel : tooltip} side={tooltipSide} describeChild={tooltip !== true}>
      {element}
    </Tooltip>
  );
}
