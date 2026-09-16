import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react';
import { cn } from './cn';

export type CardVariant = 'plain' | 'raised' | 'inset' | 'bookplate';

const VARIANTS: Record<CardVariant, string> = {
  plain: 'border border-line bg-surface',
  raised: 'border border-line bg-surface shadow-soft',
  inset: 'border border-line/70 bg-surface-2',
  bookplate:
    'border border-line bg-surface shadow-soft before:pointer-events-none before:absolute before:inset-[5px] ' +
    'before:rounded-[calc(var(--radius-card)-5px)] before:border before:border-accent/45',
};

export type CardProps = ComponentPropsWithRef<'div'> & {
  variant?: CardVariant;
  /** hover lift + pointer (use for clickable cards; put the link/button inside) */
  interactive?: boolean;
  /** element to render, e.g. "section" or "article" */
  as?: ElementType;
};

/**
 * Surface container. Compose with CardHeader / CardBody / CardFooter (or Card.Header …).
 * "bookplate" adds the inner gold rule of an ex libris label.
 */
function CardRoot({ variant = 'raised', interactive = false, as: Tag = 'div', className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'relative rounded-card text-ink',
        VARIANTS[variant],
        interactive &&
          'transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-within:shadow-lift',
        className,
      )}
      {...rest}
    />
  );
}

export type CardHeaderProps = Omit<ComponentPropsWithRef<'div'>, 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  /** right-aligned actions (buttons, menu) */
  actions?: ReactNode;
  icon?: ReactNode;
};

export function CardHeader({ title, description, actions, icon, className, children, ...rest }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6', className)} {...rest}>
      {icon ? (
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? <h3 className="font-display text-lg leading-tight font-semibold text-ink">{title}</h3> : null}
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('px-5 py-3 sm:px-6', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-line/70 px-5 py-3 sm:px-6', className)}
      {...rest}
    />
  );
}

type CardComponent = typeof CardRoot & {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
};

export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody, Footer: CardFooter }) as CardComponent;
