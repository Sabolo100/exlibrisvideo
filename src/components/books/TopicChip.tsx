'use client';

import { Chip, type ChipProps } from '@/components/ui/Chip';
import { useUiTranslator } from '@/components/ui/hooks';
import { topicDef, topicLabel } from '@/lib/taxonomy';

export type TopicChipProps = Omit<ChipProps, 'children' | 'hue' | 'icon'> & {
  /** taxonomy key, e.g. "poetry" (unknown keys render the raw key without tint) */
  topic: string;
  showIcon?: boolean;
};

/** Taxonomy topic as a hue-tinted chip with its icon and localized label. Toggleable / removable like Chip. */
export function TopicChip({ topic, showIcon = true, ...chipProps }: TopicChipProps) {
  const { locale } = useUiTranslator();
  const def = topicDef(topic);
  return (
    <Chip
      {...chipProps}
      hue={def?.hue}
      icon={showIcon && def ? <span className="text-[1.05em] leading-none">{def.icon}</span> : undefined}
      data-topic={topic}
    >
      {topicLabel(topic, locale)}
    </Chip>
  );
}
