'use client';

import { BookCheck, BookmarkPlus, BookOpen, BookX, CircleDashed, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { useUiTranslator } from '@/components/ui/hooks';
import type { MessageKey } from '@/i18n';
import type { ReadingStatus } from '@/lib/types';

/** Icon, badge tone and i18n key per reading status – reuse for segmented controls and filters. */
export const READING_STATUS_META: Record<ReadingStatus, { icon: LucideIcon; tone: BadgeTone; labelKey: MessageKey }> = {
  unknown: { icon: CircleDashed, tone: 'neutral', labelKey: 'common.status.unknown' },
  read: { icon: BookCheck, tone: 'green', labelKey: 'common.status.read' },
  reading: { icon: BookOpen, tone: 'blue', labelKey: 'common.status.reading' },
  to_read: { icon: BookmarkPlus, tone: 'gold', labelKey: 'common.status.to_read' },
  abandoned: { icon: BookX, tone: 'red', labelKey: 'common.status.abandoned' },
};

export interface ReadingStatusBadgeProps {
  status: ReadingStatus;
  size?: 'sm' | 'md';
  /** render nothing for "unknown" */
  hideUnknown?: boolean;
  /** icon only (label becomes the tooltip/aria-label) */
  iconOnly?: boolean;
  className?: string;
}

export function ReadingStatusBadge({ status, size = 'md', hideUnknown = false, iconOnly = false, className }: ReadingStatusBadgeProps) {
  const { t } = useUiTranslator();
  const meta = READING_STATUS_META[status] ?? READING_STATUS_META.unknown;
  if (hideUnknown && status === 'unknown') return null;
  const Icon = meta.icon;
  const label = t(meta.labelKey);
  if (iconOnly) {
    return (
      <Badge tone={meta.tone} size={size} className={className} title={label} aria-label={label} role="img" icon={<Icon aria-hidden="true" />} />
    );
  }
  return (
    <Badge tone={meta.tone} size={size} className={className} icon={<Icon aria-hidden="true" />}>
      {label}
    </Badge>
  );
}
