'use client';

/**
 * Camera-app controls drawn over the live preview. They are deliberately not UI-kit buttons: they sit on
 * arbitrary video, so they need translucent "glass" backgrounds, white icons and larger hit areas.
 */
import { Film } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { formatClock } from './camera';

export const REC_RED = '#ff3b30';
export const AMBER = '#ffb020';
/** light foil gold – the brand accent, brightened for a black background */
export const FOIL = '#f2d48a';

const TAP = 'touch-manipulation [-webkit-tap-highlight-color:transparent]';

export interface CameraButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
  /** accessible name (icon-only button) */
  label: string;
  icon: ReactNode;
  /** lit state (torch on) */
  active?: boolean;
}

/** Round translucent icon button (close, torch, switch camera). */
export function CameraButton({ label, icon, active = false, className, type = 'button', ...rest }: CameraButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      {...rest}
      className={cn(
        'relative flex size-11 shrink-0 items-center justify-center rounded-full outline-offset-4 ring-1 transition-[transform,background-color,color,opacity] duration-150 active:scale-90 disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100 [&_svg]:size-[22px]',
        TAP,
        active
          ? 'bg-[#f2d48a] text-black ring-transparent shadow-[0_0_18px_rgb(242_212_138/0.55)]'
          : 'bg-black/40 text-white ring-white/15 shadow-[0_2px_10px_rgb(0_0_0/0.25)] backdrop-blur-md hover:bg-black/55',
        className,
      )}
    >
      {icon}
    </button>
  );
}

export interface ShutterButtonProps {
  recording: boolean;
  disabled?: boolean;
  /** elapsed share of the clip limit, 0..1 (progress ring while recording) */
  progress: number;
  /** last seconds before the limit */
  warning: boolean;
  label: string;
  onClick: () => void;
}

const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;

/** White ring + red disc that morphs into a rounded square while recording. */
export function ShutterButton({ recording, disabled = false, progress, warning, label, onClick }: ShutterButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-recording={recording || undefined}
      className={cn(
        'group relative flex size-20 shrink-0 items-center justify-center rounded-full outline-offset-4 disabled:opacity-40',
        TAP,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 rounded-full border-4 shadow-[0_2px_16px_rgb(0_0_0/0.35)] transition-[border-color,transform] duration-200 group-active:scale-[0.96] motion-reduce:group-active:scale-100',
          recording ? 'border-white/30' : 'border-white',
        )}
      />
      {recording && progress > 0.004 ? (
        <svg aria-hidden="true" viewBox="0 0 80 80" className="pointer-events-none absolute inset-0 size-full -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={RING_R}
            fill="none"
            stroke={warning ? AMBER : '#ffffff'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            className="transition-[stroke-dashoffset,stroke] duration-200 ease-linear"
          />
        </svg>
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          'relative block transition-[width,height,border-radius,transform] duration-300 ease-[cubic-bezier(0.3,1.35,0.45,1)] group-active:scale-[0.86] motion-reduce:group-active:scale-100',
          'bg-[#ff3b30] shadow-[inset_0_-3px_8px_rgb(0_0_0/0.18),inset_0_2px_3px_rgb(255_255_255/0.18)]',
          recording ? 'size-[30px] rounded-[9px]' : 'size-[64px] rounded-[32px]',
        )}
      />
    </button>
  );
}

/** Recording clock: pulsing red dot + mm:ss, amber in the last seconds (hidden from screen readers). */
export function TimerPill({ elapsedSec, warning }: { elapsedSec: number; warning: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-warning={warning || undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full pr-3.5 pl-3 text-[0.9375rem] leading-none font-semibold tracking-[0.03em] tabular-nums shadow-[0_2px_12px_rgb(0_0_0/0.28)] backdrop-blur-md transition-colors duration-300',
        warning ? 'bg-[#ffb020] text-black' : 'bg-black/50 text-white',
      )}
    >
      <span className={cn('size-2.5 rounded-full motion-safe:animate-pulse', warning ? 'bg-[#b0001a]' : 'bg-[#ff3b30]')} />
      {formatClock(elapsedSec)}
    </div>
  );
}

export interface ClipTrayButtonProps {
  count: number;
  thumbnail: string | null;
  /** changes with every new clip (thumbnail pop animation) */
  thumbnailKey: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

/** Thumbnail of the latest clip with a count badge; opens the review sheet. */
export function ClipTrayButton({ count, thumbnail, thumbnailKey, label, disabled = false, onClick }: ClipTrayButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative block size-[3.25rem] shrink-0 rounded-[0.875rem] outline-offset-4 transition-[transform,opacity] duration-150 active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100',
        TAP,
      )}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[0.875rem] bg-white/10 shadow-[0_2px_14px_rgb(0_0_0/0.4)] ring-2 ring-white/90">
        <AnimatePresence initial={false}>
          {thumbnail ? (
            <motion.img
              key={thumbnailKey}
              src={thumbnail}
              alt=""
              draggable={false}
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <span key="placeholder" className="absolute inset-0 flex items-center justify-center text-white/70">
              <Film className="size-6" aria-hidden="true" />
            </span>
          )}
        </AnimatePresence>
      </span>
      <span
        aria-hidden="true"
        className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f2d48a] px-1.5 text-[0.6875rem] leading-none font-bold text-black tabular-nums shadow-[0_1px_4px_rgb(0_0_0/0.4)]"
      >
        {count}
      </span>
    </button>
  );
}
