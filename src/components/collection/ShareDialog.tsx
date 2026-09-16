'use client';

/** Share dialog: public link (copy, native share, e-mail), QR code (+ PNG download), owner edit link. */
import { Download, KeyRound, Link2, Mail, Share2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, CopyField, Dialog, QrCode, downloadQrPng, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { useCollection } from './context';
import { isAbortError } from './errors';
import { collectionTitle } from './labels';
import { useCollectionShell } from './shell-context';

export function ownerLinkFor(publicUrl: string, token: string): string {
  const url = new URL(publicUrl);
  url.searchParams.set('k', token);
  return url.toString();
}

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { collection, isOwner } = useCollection();
  const { ownerToken } = useCollectionShell();
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const title = collectionTitle(collection, t);
  const url = collection.publicUrl;
  const shareText = t('collection.share.nativeText', { title });
  const mailto = `mailto:?subject=${encodeURIComponent(t('collection.share.emailSubject', { title }))}&body=${encodeURIComponent(
    t('collection.share.emailBody', { url }),
  )}`;

  const nativeShare = async () => {
    try {
      await navigator.share({ title, text: shareText, url });
    } catch (err) {
      if (isAbortError(err)) return;
      toast({ title: t('common.state.error'), tone: 'error' });
    }
  };

  const downloadQr = async () => {
    setDownloading(true);
    try {
      const ok = await downloadQrPng(url, `exlibris-${collection.id}-qr.png`, { size: 1024 });
      toast(ok ? { title: t('collection.share.qrDownloaded'), tone: 'success' } : { title: t('collection.share.qrFailed'), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Share2 />}
      title={t('collection.share.title')}
      description={collection.visibility === 'pin' ? `${t('collection.share.description')} ${t('collection.share.descriptionPin')}` : t('collection.share.description')}
    >
      <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <CopyField label={t('collection.share.link')} showLabel value={url} leftIcon={<Link2 />} />
          <div className="flex flex-wrap gap-2">
            {canNativeShare ? (
              <Button variant="primary" leftIcon={<Share2 className="size-4" />} onClick={() => void nativeShare()}>
                {t('collection.share.native')}
              </Button>
            ) : null}
            <Button href={mailto} external leftIcon={<Mail className="size-4" />}>
              {t('collection.share.email')}
            </Button>
          </div>

          {isOwner && ownerToken ? (
            <div className="rounded-xl border border-accent/40 bg-accent-soft/50 p-3.5">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
                <KeyRound aria-hidden="true" className="size-4 text-accent" />
                {t('collection.share.ownerTitle')}
              </p>
              <p className="mb-2.5 flex gap-2 text-[0.8125rem] text-muted">
                <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-danger" />
                {t('collection.share.ownerHint')}
              </p>
              <CopyField label={t('collection.share.ownerLink')} value={ownerLinkFor(url, ownerToken)} size="sm" />
            </div>
          ) : null}
        </div>

        <figure className="flex flex-col items-center gap-2 sm:w-52">
          <QrCode value={url} size={176} label={t('collection.share.qrTitle')} />
          <figcaption className="max-w-52 text-center text-xs text-muted">{t('collection.share.qrHint')}</figcaption>
          <Button size="sm" variant="ghost" leftIcon={<Download className="size-4" />} loading={downloading} onClick={() => void downloadQr()}>
            {t('common.qr.download')}
          </Button>
        </figure>
      </div>
    </Dialog>
  );
}
