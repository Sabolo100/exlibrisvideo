'use client';

import { Camera, CloudUpload, FolderOpen } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { copyPickedFiles } from '@/lib/client/stable-files';
import { CAPTURE_ACCEPT, PICK_ACCEPT } from './validate';

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
 * Drag & drop area with the file pickers. Touch devices get a prominent "record video" button
 * (camera capture) next to "choose existing"; mouse devices get "choose files" plus drag & drop.
 * Pointer detection is pure CSS (`pointer-coarse:` / `pointer-fine:`), so there is no hydration flash.
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

  // the compact zone lives in narrow sidebars and wide dialogs alike: its layout follows the container width
  return (
    <div className={cn('@container', className)}>
      <div
        role="group"
        aria-labelledby={headingId}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'relative flex flex-col items-center rounded-[calc(var(--radius-card)-4px)] border-2 border-dashed text-center transition-[border-color,background-color,box-shadow] duration-200',
          hero ? 'gap-3.5 px-4 py-6 sm:gap-4 sm:px-8 sm:py-9' : 'gap-3 px-4 py-5 @lg:flex-row @lg:text-left',
          dragging
            ? 'border-accent bg-accent-soft/70 shadow-[inset_0_0_0_4px_color-mix(in_oklab,var(--accent)_18%,transparent)]'
            : 'border-[color-mix(in_oklab,var(--line),var(--accent)_35%)] bg-surface-2/40',
          disabled && 'opacity-60',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/25',
            hero ? 'size-12 [&_svg]:size-6 sm:size-14 sm:[&_svg]:size-7' : 'size-11 [&_svg]:size-5',
            dragging && 'scale-110 transition-transform',
          )}
        >
          <CloudUpload />
        </span>

        <div className={cn('flex min-w-0 flex-col', hero ? 'items-center gap-1.5' : 'flex-1 gap-0.5 @lg:items-start')}>
          <Heading
            id={headingId}
            className={cn('font-display font-semibold text-ink text-balance', hero ? 'text-2xl sm:text-[1.75rem]' : 'text-lg leading-tight')}
          >
            {dragging ? t('upload.drop.active') : title}
          </Heading>
          {description || touchDescription ? (
            <p className={cn('max-w-md text-muted text-pretty', hero ? 'text-[0.9375rem]' : 'text-sm')}>
              {touchDescription ? (
                <>
                  <span className="pointer-coarse:hidden">{description}</span>
                  <span className="pointer-fine:hidden">{touchDescription}</span>
                </>
              ) : (
                description
              )}
            </p>
          ) : null}
        </div>

        <div className={cn('flex w-full flex-col gap-2.5', hero ? 'max-w-sm sm:max-w-none sm:flex-row sm:justify-center' : '@lg:w-auto @lg:shrink-0 @lg:flex-row')}>
          {/* touch devices: film right now */}
          <Button
            variant="primary"
            size={size}
            leftIcon={<Camera />}
            disabled={disabled}
            onClick={() => captureRef.current?.click()}
            className="pointer-fine:hidden"
          >
            {t('upload.action.record')}
          </Button>
          <Button
            variant="secondary"
            size={size}
            leftIcon={<FolderOpen />}
            disabled={disabled}
            onClick={() => pickRef.current?.click()}
            className="pointer-fine:hidden"
          >
            {t('upload.action.pickExisting')}
          </Button>
          {/* mouse devices: choose files (drag & drop also works) */}
          <Button
            variant={hero ? 'primary' : 'secondary'}
            size={size}
            leftIcon={<FolderOpen />}
            disabled={disabled}
            onClick={() => pickRef.current?.click()}
            className="pointer-coarse:hidden"
          >
            {t('upload.action.chooseFiles')}
          </Button>
        </div>

        {footnote ? <p className={cn('text-xs text-muted', hero ? 'max-w-md' : '@lg:hidden')}>{footnote}</p> : null}

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
