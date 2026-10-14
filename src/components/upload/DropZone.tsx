'use client';

import { Camera, CloudUpload, FolderOpen } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { copyPickedFiles } from '@/lib/client/stable-files';
import { CAPTURE_ACCEPT, PICK_ACCEPT } from './validate';
import { heroZoneFrame, heroZoneIdle, heroZoneNote, heroZoneText, heroZoneTitle, HeroZoneIcon } from './zone-chrome';

export interface DropZoneProps {
  variant: 'hero' | 'compact';
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** heading shown inside the zone */
  title: ReactNode;
  /** one sentence under the heading (touch devices get `touchDescription` instead) */
  description?: ReactNode;
  touchDescription?: ReactNode;
  /** extra line under the buttons (formats, limits) */
  footnote?: ReactNode;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Drag & drop area with the file pickers. Devices with a touch screen get a prominent "record video" button
 * (camera capture) next to "choose existing"; mouse-only devices get "choose files" plus drag & drop.
 * The test is `any-pointer: coarse` (not the primary pointer): an iPad with a trackpad attached still has a
 * camera in hand. Pure CSS, so there is no hydration flash.
 */
export function DropZone({
  variant,
  onFiles,
  disabled = false,
  title,
  description,
  touchDescription,
  footnote,
  headingLevel = 'h2',
  className,
}: DropZoneProps) {
  const { t } = useI18n();
  const pickRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const headingId = useId();
  const hero = variant === 'hero';
  const Heading = headingLevel;

  const take = (list: FileList | null, input?: HTMLInputElement) => {
    if (disabled || !list || list.length === 0) return;
    // open the files right now (copyPickedFiles): Chrome on Android drops access to picked files after a moment
    void copyPickedFiles(Array.from(list)).then((ready) => {
      if (input) input.value = '';
      onFiles(ready);
    });
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e) || disabled) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e) || disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    take(e.dataTransfer.files);
  };

  const size = hero ? 'lg' : 'md';
  const dragActive = 'border-accent bg-accent-soft/70 shadow-[inset_0_0_0_4px_color-mix(in_oklab,var(--accent)_18%,transparent)]';

  // The zone lives in narrow sidebars, wide dialogs and half-page cards alike: its layout follows the width of its
  // container, not the window. The hero zone fills the height of its card (it sits next to the phone / QR card).
  return (
    <div className={cn('@container', hero && 'flex flex-1 flex-col', className)}>
      <div
        role="group"
        aria-labelledby={headingId}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          hero
            ? heroZoneFrame
            : 'relative flex flex-col items-center gap-3 rounded-[calc(var(--radius-card)-4px)] border-2 border-dashed px-4 py-5 text-center transition-[border-color,background-color,box-shadow] duration-200 @lg:flex-row @lg:text-left',
          dragging ? dragActive : heroZoneIdle,
          disabled && 'opacity-60',
        )}
      >
        {hero ? (
          <HeroZoneIcon active={dragging}>
            <CloudUpload />
          </HeroZoneIcon>
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/25 [&_svg]:size-5',
              dragging && 'scale-110 transition-transform',
            )}
          >
            <CloudUpload />
          </span>
        )}

        <div className={cn('flex min-w-0 flex-col', hero ? 'items-center gap-1.5' : 'flex-1 gap-0.5 @lg:items-start')}>
          <Heading id={headingId} className={hero ? heroZoneTitle : 'font-display text-lg leading-tight font-semibold text-balance text-ink'}>
            {dragging ? t('upload.drop.active') : title}
          </Heading>
          {description || touchDescription ? (
            <p className={hero ? heroZoneText : 'max-w-md text-sm text-pretty text-muted'}>
              {touchDescription ? (
                <>
                  <span className="any-pointer-coarse:hidden">{description}</span>
                  <span className="not-any-pointer-coarse:hidden">{touchDescription}</span>
                </>
              ) : (
                description
              )}
            </p>
          ) : null}
        </div>

        <div className={cn('flex flex-col gap-2.5', hero ? 'w-fit max-w-full @md:flex-row' : 'w-full @lg:w-auto @lg:shrink-0 @lg:flex-row')}>
          {/* touch devices: film right now */}
          <Button
            variant="primary"
            size={size}
            leftIcon={<Camera />}
            disabled={disabled}
            onClick={() => captureRef.current?.click()}
            className="not-any-pointer-coarse:hidden"
          >
            {t('upload.action.record')}
          </Button>
          <Button
            variant="secondary"
            size={size}
            leftIcon={<FolderOpen />}
            disabled={disabled}
            onClick={() => pickRef.current?.click()}
            className="not-any-pointer-coarse:hidden"
          >
            {t('upload.action.pickExisting')}
          </Button>
          {/* mouse-only devices: choose files (drag & drop also works) */}
          <Button
            variant={hero ? 'primary' : 'secondary'}
            size={size}
            leftIcon={<FolderOpen />}
            disabled={disabled}
            onClick={() => pickRef.current?.click()}
            className="any-pointer-coarse:hidden"
          >
            {t('upload.action.chooseFiles')}
          </Button>
        </div>

        {footnote ? <p className={hero ? heroZoneNote : 'text-xs text-muted @lg:hidden'}>{footnote}</p> : null}

        <input
          ref={captureRef}
          type="file"
          accept={CAPTURE_ACCEPT}
          capture="environment"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => take(e.currentTarget.files, e.currentTarget)}
        />
        <input
          ref={pickRef}
          type="file"
          accept={PICK_ACCEPT}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => take(e.currentTarget.files, e.currentTarget)}
        />
      </div>
    </div>
  );
}
