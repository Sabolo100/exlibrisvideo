'use client';

import { Download, Eye, EyeOff, KeyRound, Link2, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { IconButton } from '@/components/ui/IconButton';
import { downloadQrPng, QrCode } from '@/components/ui/QrCode';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { getOwnerToken } from '@/lib/client/my-collections';

export interface SharePanelProps {
  collectionId: string;
  publicUrl: string;
  className?: string;
}

/** The owner link with the token hidden (the copy button still copies the real link). */
function maskOwnerUrl(publicUrl: string): string {
  return `${publicUrl}?k=••••••••••••`;
}

/**
 * "This link will show your library": public link (copy, native share), QR code (+ PNG download),
 * the "save this link" hint and – when this browser knows the owner token – the owner link.
 */
export function SharePanel({ collectionId, publicUrl, className }: SharePanelProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [showOwner, setShowOwner] = useState(false);

  useEffect(() => {
    const read = () => setOwnerToken(getOwnerToken(collectionId));
    read();
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    window.addEventListener('exl-my-collections', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('exl-my-collections', read);
      window.removeEventListener('storage', read);
    };
  }, [collectionId]);

  const ownerUrl = ownerToken ? `${publicUrl}?k=${encodeURIComponent(ownerToken)}` : null;

  const share = async () => {
    try {
      await navigator.share({ title: t('processing.share.nativeTitle'), text: t('processing.share.nativeText'), url: publicUrl });
    } catch (err) {
      // AbortError = the user closed the share sheet; anything else: fall back to copying
      if (err instanceof Error && err.name === 'AbortError') return;
      toast({ title: t('common.copy.failed'), tone: 'error' });
    }
  };

  const downloadQr = async () => {
    const ok = await downloadQrPng(publicUrl, `exlibris-${collectionId}.png`, { size: 720 });
    if (!ok) toast({ title: t('processing.share.qrFailed'), tone: 'error' });
  };

  return (
    <Card variant="bookplate" as="section" aria-labelledby={`share-${collectionId}`} className={cn('p-5 sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-5">
          <Link2 />
        </span>
        <div className="min-w-0">
          <h2 id={`share-${collectionId}`} className="font-display text-lg leading-tight font-semibold text-ink text-balance">
            {t('processing.share.title')}
          </h2>
          <p className="mt-1 text-sm text-muted text-pretty">{t('processing.share.description')}</p>
        </div>
      </div>

      <CopyField
        className="mt-4"
        label={t('processing.share.linkLabel')}
        value={publicUrl}
        leftIcon={<Link2 />}
        onCopied={() => toast({ title: t('processing.share.copied'), tone: 'success' })}
      />

      <div className="mt-4 flex items-center gap-4">
        <QrCode value={publicUrl} size={112} label={t('processing.share.qrLabel')} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm leading-snug text-ink text-pretty">{t('processing.share.saveHint')}</p>
          <div className="flex flex-wrap gap-2">
            {canShare ? (
              <Button size="sm" variant="primary" leftIcon={<Share2 />} onClick={() => void share()}>
                {t('processing.share.native')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" leftIcon={<Download />} onClick={() => void downloadQr()}>
              {t('common.qr.download')}
            </Button>
          </div>
        </div>
      </div>

      {ownerUrl ? (
        <div className="mt-5 rounded-xl border border-accent/35 bg-accent-soft/50 p-3.5">
          <div className="flex items-start gap-2">
            <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{t('processing.share.owner.title')}</p>
              <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted text-pretty">{t('processing.share.owner.hint')}</p>
            </div>
            <IconButton
              size="sm"
              aria-label={showOwner ? t('processing.share.owner.hide') : t('processing.share.owner.show')}
              aria-pressed={showOwner}
              icon={showOwner ? <EyeOff /> : <Eye />}
              onClick={() => setShowOwner((v) => !v)}
            />
          </div>
          <CopyField
            className="mt-2.5"
            size="sm"
            label={t('processing.share.owner.label')}
            value={ownerUrl}
            displayValue={showOwner ? ownerUrl : maskOwnerUrl(publicUrl)}
            leftIcon={<KeyRound />}
            onCopied={() => toast({ title: t('processing.share.copied'), tone: 'success' })}
          />
        </div>
      ) : null}
    </Card>
  );
}
