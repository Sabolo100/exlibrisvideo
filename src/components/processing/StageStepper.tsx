'use client';

import { Check, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { cn } from '@/components/ui/cn';
import type { PipelineStage, StepState } from './model';

export interface StageStepperProps {
  steps: { stage: PipelineStage; state: StepState }[];
  className?: string;
}

/** probe → frames → vision → merge → crops → enrich, as a compact dotted progress line. */
export function StageStepper({ steps, className }: StageStepperProps) {
  const { t } = useI18n();
  return (
    <ol aria-label={t('processing.stage.aria')} className={cn('flex w-full items-start', className)}>
      {steps.map(({ stage, state }, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={stage} className="relative flex min-w-0 flex-1 flex-col items-center">
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-[0.6875rem] left-[calc(50%+0.875rem)] h-0.5 w-[calc(100%-1.75rem)] rounded-full',
                  state === 'done' ? 'bg-success/70' : 'bg-line',
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-[1] flex size-6 items-center justify-center rounded-full border-2 text-[0.6875rem] font-semibold transition-colors [&_svg]:size-3.5',
                state === 'done' && 'border-success bg-success text-white dark:text-[#10231a]',
                state === 'active' && 'border-accent bg-accent-soft text-accent',
                state === 'pending' && 'border-line bg-surface text-muted',
                state === 'error' && 'border-danger bg-danger text-white dark:text-[#2a0f0c]',
              )}
            >
              {state === 'done' ? <Check strokeWidth={3} /> : state === 'error' ? <X strokeWidth={3} /> : i + 1}
              {state === 'active' ? (
                <span className="absolute inset-[-5px] animate-ping rounded-full border border-accent/50 [animation-duration:1.8s]" />
              ) : null}
            </span>
            <span
              className={cn(
                'mt-1.5 hidden max-w-full truncate px-0.5 text-center text-[0.6875rem] leading-tight sm:block',
                state === 'active' ? 'font-semibold text-ink' : state === 'error' ? 'font-semibold text-danger' : 'text-muted',
              )}
            >
              {t(`processing.stage.${stage}.short`)}
            </span>
            <span className="sr-only">
              {t(`processing.stage.${stage}.label`)}: {t(`processing.stage.state.${state}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
