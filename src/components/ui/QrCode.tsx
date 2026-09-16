'use client';

import QRCode from 'qrcode';
import { useMemo } from 'react';
import { cn } from './cn';
import { useUiTranslator } from './hooks';

export interface QrSvgOptions {
  /** quiet zone in modules (default 2) */
  margin?: number;
  /** module colour (default warm ink) */
  dark?: string;
  /** background colour (default paper) */
  light?: string;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

const INK = '#1e1914';
const PAPER = '#fffaf1';

/**
 * QR code as an SVG string (one path, crisp at any size). Synchronous, works on server and client.
 * Throws when the value is too long to encode.
 */
export function qrSvgString(value: string, { margin = 2, dark = INK, light = PAPER, errorCorrectionLevel = 'M' }: QrSvgOptions = {}): string {
  const qr = QRCode.create(value, { errorCorrectionLevel });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const total = size + margin * 2;
  let path = '';
  for (let y = 0; y < size; y++) {
    let runStart = -1;
    for (let x = 0; x <= size; x++) {
      const on = x < size && data[y * size + x];
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        path += `M${runStart + margin} ${y + margin}h${x - runStart}v1h-${x - runStart}z`;
        runStart = -1;
      }
    }
  }
  const bg = light === 'transparent' ? '' : `<rect width="${total}" height="${total}" fill="${light}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">${bg}<path fill="${dark}" d="${path}"/></svg>`;
}

/**
 * Downloads the QR code as a PNG (default 1024 px) – e.g. to print and stick on the shelf.
 * Returns false when running outside the browser or encoding failed.
 */
export async function downloadQrPng(value: string, filename = 'exlibris-qr.png', { size = 1024, ...opts }: QrSvgOptions & { size?: number } = {}): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    const dataUrl = await QRCode.toDataURL(value, {
      errorCorrectionLevel: opts.errorCorrectionLevel ?? 'M',
      margin: opts.margin ?? 2,
      width: size,
      color: { dark: opts.dark ?? INK, light: opts.light ?? PAPER },
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (err) {
    console.info('[ui] QR download failed', { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export interface QrCodeProps extends QrSvgOptions {
  value: string;
  /** rendered size in px (default 160) */
  size?: number;
  /** accessible name (default "QR-kód ehhez: <value>") */
  label?: string;
  /** paper frame with a thin gold rule (default true) */
  framed?: boolean;
  className?: string;
}

/** QR code rendered inline as SVG. Always dark-on-paper so phones can scan it in dark mode too. */
export function QrCode({ value, size = 160, label, framed = true, className, ...opts }: QrCodeProps) {
  const { t } = useUiTranslator();
  const svg = useMemo(() => {
    try {
      return qrSvgString(value, opts);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, opts.margin, opts.dark, opts.light, opts.errorCorrectionLevel]);

  const name = label ?? t('common.aria.qrCode', { value });

  return (
    <div
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        framed && 'rounded-xl border border-[#e2d5c0] bg-[#fffaf1] p-2 shadow-soft ring-1 ring-accent/30 ring-inset',
        className,
      )}
    >
      {svg ? (
        <span
          aria-hidden="true"
          className="block [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{ width: size, height: size }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex items-center justify-center text-xs text-[#6d6152]"
          style={{ width: size, height: size }}
        >
          QR
        </span>
      )}
    </div>
  );
}
