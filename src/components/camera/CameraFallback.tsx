'use client';

/**
 * Full-screen explanation when the in-app camera cannot run (plain http, old browser, denied permission, no
 * camera, camera busy). Never a dead end: the phone's own camera app is always offered through
 * <input type="file" accept="video/*" capture="environment">, clips recorded before the failure can still be used,
 * and "Mégse" closes the recorder.
 */
import { Camera, CameraOff, Check, CircleAlert, RotateCcw, ShieldAlert, Video, VideoOff, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { copyPickedFiles } from '@/lib/client/stable-files';
import { canRetry, type CameraProblem, type Platform } from './camera';
import { CameraButton } from './CameraControls';

const ICONS: Record<CameraProblem, LucideIcon> = {
  insecure: ShieldAlert,
  unsupported: VideoOff,
  denied: CameraOff,
  not_found: VideoOff,
  in_use: Camera,
  unknown: CircleAlert,
};

export interface CameraFallbackProps {
  problem: CameraProblem;
  /** which permission hint to show for `denied` */
  platform: Platform;
  /** iOS browser named in the Settings path (Safari, Chrome …) */
  iosApp?: string;
  /** clips recorded before the camera failed */
  clipCount?: number;
  onRetry: () => void;
  /** files returned by the phone's camera app */
  onNativeFiles: (files: File[]) => void;
  onCancel: () => void;
  onUseClips?: () => void;
}

export function CameraFallback({
  problem,
  platform,
  iosApp = 'Safari',
  clipCount = 0,
  onRetry,
  onNativeFiles,
  onCancel,
  onUseClips,
}: CameraFallbackProps) {
  const { t, tp } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const Icon = ICONS[problem];
  const retryable = canRetry(problem);
  const hasClips = clipCount > 0 && Boolean(onUseClips);

  // the camera UI the user was focused on is gone: move focus here so screen readers read the explanation
  useEffect(() => {
    const section = sectionRef.current;
    if (section && !section.contains(document.activeElement)) section.focus({ preventScroll: true });
  }, [problem]);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-problem={problem}
      className="absolute inset-0 z-20 flex flex-col bg-[radial-gradient(120%_65%_at_50%_0%,#2d2218_0%,#0d0a07_58%,#000_100%)] text-white outline-none"
    >
      <div className="flex shrink-0 items-center pt-[max(env(safe-area-inset-top),0.875rem)] pr-[max(env(safe-area-inset-right),1rem)] pl-[max(env(safe-area-inset-left),1rem)]">
        <CameraButton label={t('camera.action.close')} icon={<X />} onClick={onCancel} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-6">
        <div className="exl-cam-rise my-auto flex flex-col items-center py-6 text-center">
          <span className="relative flex size-[4.5rem] items-center justify-center rounded-full bg-white/[0.06] text-[#f2d48a] ring-1 ring-white/10 [&_svg]:size-8">
            <span aria-hidden="true" className="absolute -inset-3 rounded-full bg-[#f2d48a]/[0.05] blur-md" />
            <Icon aria-hidden="true" strokeWidth={1.75} />
          </span>
          <h2 id={titleId} className="mt-5 max-w-[20rem] font-display text-[1.625rem] leading-[1.15] font-semibold text-balance">
            {t(`camera.fallback.${problem}.title`)}
          </h2>
          <p id={bodyId} className="mt-3 max-w-[22rem] text-[0.9875rem] leading-relaxed text-pretty text-white/75">
            {t(`camera.fallback.${problem}.body`)}
          </p>
          {problem === 'denied' ? (
            <div className="mt-6 w-full max-w-[22rem] rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left ring-1 ring-white/10">
              <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[#f2d48a] uppercase">{t('camera.fallback.howTo')}</p>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-pretty text-white/90">
                {t(`camera.fallback.hint.${platform}`, { app: iosApp })}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md shrink-0 flex-col gap-2.5 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        {hasClips ? (
          <Button variant="primary" size="lg" fullWidth leftIcon={<Check />} onClick={onUseClips}>
            {tp('camera.fallback.useClips', clipCount)}
          </Button>
        ) : null}
        {retryable ? (
          <Button variant={hasClips ? 'secondary' : 'primary'} size="lg" fullWidth leftIcon={<RotateCcw />} onClick={onRetry}>
            {t('camera.fallback.retry')}
          </Button>
        ) : null}
        <Button
          variant={retryable || hasClips ? 'secondary' : 'primary'}
          size="lg"
          fullWidth
          leftIcon={<Video />}
          onClick={() => inputRef.current?.click()}
        >
          {t('camera.fallback.native')}
        </Button>
        <Button variant="ghost" size="lg" fullWidth onClick={onCancel}>
          {t('camera.fallback.cancel')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const input = e.currentTarget;
            const files = Array.from(input.files ?? []);
            if (files.length === 0) return;
            // open the files right now: Chrome on Android drops access to picked files after a moment
            void copyPickedFiles(files).then((ready) => {
              input.value = '';
              onNativeFiles(ready);
            });
          }}
        />
      </div>
    </section>
  );
}
