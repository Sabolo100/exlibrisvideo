'use client';

/**
 * The promo video, right under the brand name at the top of the landing page – and at the very top of the phone
 * app's home screen (AppHome). It must never slow the first paint down, yet start as soon as the page is ready:
 *
 *  - the first paint only holds the poster image (a small JPEG with a high fetch priority – it is the biggest thing
 *    on screen) – no video bytes at all (`preload="none"`, no `src`);
 *  - once the page has finished loading and the browser is idle, and the player is within ~800 px of the viewport,
 *    the file is requested (`src` + `preload="auto"`, 10.4 MB, `+faststart` so playback begins after the first chunk);
 *  - when about half of it is on screen it plays – muted, because browsers only autoplay silent video – and it
 *    pauses again when scrolled away or the tab is hidden;
 *  - it does NOT autoplay – and does not even request the file – with "reduce motion", the data saver or a slow
 *    connection (2G / 3G) on, nor when the browser refuses (iOS low-power mode): then the poster with a play button
 *    waits for a tap;
 *  - at the end it stops (no endless loop in an idle tab) and offers "watch again".
 * The file is served from this site (public/promo), no third party, no cookies, no tracking.
 */
import { Maximize, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { cn } from '@/components/ui/cn';

/** 1280×720 H.264/AAC, 2 min 1 s, re-encoded from promo/out (see CHANGELOG 1.13.0); the version is part of the name (immutable cache) */
export const PROMO_VIDEO_SRC = '/promo/exlibris-promo-hu-v1.2.0-720p.mp4';
export const PROMO_POSTER_SRC = '/promo/exlibris-promo-poster-v1.2.0.jpg';

/** start loading this far before the player scrolls into view */
const PREFETCH_MARGIN = '800px 0px';
/** "in view" begins when this much of the player is visible and ends when less than {@link LEAVE_RATIO} is */
const ENTER_RATIO = 0.45;
const LEAVE_RATIO = 0.15;

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function autoplayAllowed(): boolean {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return false;
  // a 10 MB video does not belong on a slow mobile connection (phones are the main audience): wait for a tap there
  return !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '');
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };

/**
 * Runs `run` once the page has finished loading and the browser has a quiet moment – the 9 MB file must not compete
 * with the fonts, scripts and images of the first paint. Returns the cancel function.
 */
function whenPageIdle(run: () => void): () => void {
  const w = window as IdleWindow;
  let cancelled = false;
  let idle: number | undefined;
  let timer: number | undefined;
  const fire = () => {
    if (!cancelled) run();
  };
  const go = () => {
    if (cancelled) return;
    if (w.requestIdleCallback) idle = w.requestIdleCallback(fire, { timeout: 1500 });
    else timer = window.setTimeout(fire, 300);
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', go);
    if (idle !== undefined) w.cancelIdleCallback?.(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

export function PromoVideo({ className }: { className?: string }) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [armed, setArmed] = useState(false); // the file is being requested
  const [inView, setInView] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [autoplay, setAutoplay] = useState<boolean | null>(null); // null until the browser has been asked
  const [userPlay, setUserPlay] = useState(false); // the viewer pressed play
  const [userPaused, setUserPaused] = useState(false); // the viewer pressed pause
  const [blocked, setBlocked] = useState(false); // the browser refused to play without a tap
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false); // a frame has been shown → the poster can go
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setAutoplay(autoplayAllowed());
    const v = videoRef.current as FullscreenVideo | null;
    setCanFullscreen(Boolean(document.fullscreenEnabled || v?.webkitEnterFullscreen));
    const onVisibility = () => setTabVisible(document.visibilityState !== 'hidden');
    const onFullscreen = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  // request the file shortly before the player comes into view (and once the page is idle); "in view" = about half of it (with hysteresis)
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') return;
    let cancelIdle: (() => void) | null = null;
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          near.disconnect();
          // nothing is requested when it would not play by itself anyway (data saver, reduced motion, slow connection) – the tap does it
          cancelIdle = whenPageIdle(() => {
            if (autoplayAllowed()) setArmed(true);
          });
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    const visible = new IntersectionObserver(
      (entries) => {
        const ratio = entries[entries.length - 1]?.intersectionRatio ?? 0;
        if (ratio >= ENTER_RATIO) setInView(true);
        else if (ratio < LEAVE_RATIO) setInView(false);
      },
      { threshold: [0, LEAVE_RATIO, ENTER_RATIO, 1] },
    );
    near.observe(box);
    visible.observe(box);
    return () => {
      near.disconnect();
      visible.disconnect();
      cancelIdle?.();
    };
  }, []);

  // play / pause by visibility – never against the viewer's own pause, and only on their tap when autoplay is off
  const wantsPlay = inView && tabVisible && !userPaused && !ended && !blocked && (autoplay === true || userPlay);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !armed) return;
    if (wantsPlay) {
      v.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') setBlocked(true);
      });
    } else {
      v.pause();
    }
  }, [armed, wantsPlay]);

  const play = useCallback(() => {
    setArmed(true);
    setInView(true);
    setUserPlay(true);
    setUserPaused(false);
    setBlocked(false);
    setEnded(false);
    const v = videoRef.current;
    // inside the tap itself when the file is already requested (Safari wants play() in the gesture); otherwise the effect plays it
    if (v && v.getAttribute('src')) {
      if (v.ended) v.currentTime = 0;
      v.play().catch(() => undefined);
    }
  }, []);

  const pause = useCallback(() => {
    setUserPaused(true);
    videoRef.current?.pause();
  }, []);

  const toggle = () => (playing ? pause() : play());

  const toggleMute = () => {
    const next = !muted;
    if (videoRef.current) videoRef.current.muted = next;
    setMuted(next);
  };

  const toggleFullscreen = () => {
    const box = boxRef.current;
    const v = videoRef.current as FullscreenVideo | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (box?.requestFullscreen) void box.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else v?.webkitEnterFullscreen?.();
  };

  const restart = () => {
    const v = videoRef.current;
    if (v) v.currentTime = 0;
    setProgress(0);
    play();
  };

  // the "poster with a play button" state: nothing plays and nothing will start by itself
  const waiting = !playing && !ended && (blocked || userPaused || autoplay === false);
  // the controls stay while paused or muted (the sound switch has to be found), otherwise they come on hover / focus / touch
  const barVisible = !playing || muted;
  const roundButton =
    'inline-flex size-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:outline-offset-1 [&_svg]:size-5';

  return (
    <figure className={cn('m-0', className)}>
      <div
        ref={boxRef}
        className={cn(
          'group/vid relative aspect-video w-full overflow-hidden bg-[#14100c]',
          fullscreen ? 'rounded-none' : 'rounded-[calc(var(--radius-card)-4px)]',
        )}
      >
        <video
          ref={videoRef}
          src={armed ? PROMO_VIDEO_SRC : undefined}
          preload={armed ? 'auto' : 'none'}
          muted
          playsInline
          aria-label={t('landing.video.aria')}
          className={cn('absolute inset-0 size-full cursor-pointer', fullscreen ? 'object-contain' : 'object-cover')}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onPlaying={() => setStarted(true)}
          onEnded={() => {
            setPlaying(false);
            setEnded(true);
            setProgress(1);
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress(v.currentTime / v.duration);
          }}
        />

        {/* poster until the first frame; a plain image (66 KB), fetched with a high priority – it is the largest thing in the first paint */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={PROMO_POSTER_SRC}
          alt=""
          width={1280}
          height={720}
          fetchPriority="high"
          decoding="async"
          draggable={false}
          className={cn(
            'pointer-events-none absolute inset-0 size-full transition-opacity duration-500',
            fullscreen ? 'object-contain' : 'object-cover',
            started ? 'opacity-0' : 'opacity-100',
          )}
        />

        {/* big play / replay */}
        {waiting || ended ? (
          <button
            type="button"
            onClick={ended ? restart : play}
            aria-label={ended ? t('landing.video.replay') : t('landing.video.play')}
            className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30"
          >
            <span className="flex size-[4.5rem] items-center justify-center rounded-full bg-accent text-[#2a1c08] shadow-lift ring-8 ring-white/20 transition-transform group-hover/vid:scale-105 [&_svg]:size-8">
              {ended ? <RotateCcw /> : <Play className="ml-0.5 fill-current" />}
            </span>
          </button>
        ) : null}

        <div
          className={cn(
            'absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/65 to-transparent px-3 pt-10 pb-3 transition-opacity duration-300',
            barVisible ? 'opacity-100' : 'opacity-0 group-focus-within/vid:opacity-100 group-hover/vid:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={ended ? restart : toggle}
            aria-label={ended ? t('landing.video.replay') : playing ? t('landing.video.pause') : t('landing.video.play')}
            className={roundButton}
          >
            {ended ? <RotateCcw /> : playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? t('landing.video.unmute') : t('landing.video.mute')}
            className={cn(
              roundButton,
              muted && 'w-auto gap-2 bg-accent px-4 text-sm font-semibold text-[#2a1c08] hover:bg-accent/90 [&_svg]:size-[1.125rem]',
            )}
          >
            {muted ? <VolumeX /> : <Volume2 />}
            {muted ? <span>{t('landing.video.unmute')}</span> : null}
          </button>
          {canFullscreen ? (
            <button type="button" onClick={toggleFullscreen} aria-label={t('landing.video.fullscreen')} className={roundButton}>
              <Maximize />
            </button>
          ) : null}
        </div>

        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
          <div className="h-full origin-left bg-accent transition-transform duration-300 ease-linear" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
      {t('landing.video.note') ? <figcaption className="mt-2 text-center text-xs text-muted">{t('landing.video.note')}</figcaption> : null}
    </figure>
  );
}
