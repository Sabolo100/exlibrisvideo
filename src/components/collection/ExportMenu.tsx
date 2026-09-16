'use client';

/** Export dropdown: file downloads for every format, plus "send by e-mail" for the owner. */
import { Braces, ChevronDown, Download, FileSpreadsheet, FileText, Mail, Sheet, BookMarked, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, DropdownMenu, type DropdownMenuItem } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import type { ExportFormat } from '@/lib/types';
import { useCollection } from './context';
import { EmailExportDialog } from './EmailExportDialog';
import { EXPORT_META, EXPORT_ORDER } from './view-meta';

const FORMAT_ICON: Record<ExportFormat, LucideIcon> = {
  xlsx: FileSpreadsheet,
  pdf: FileText,
  csv: Sheet,
  goodreads: BookMarked,
  json: Braces,
};

export function ExportMenu({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const { collection, isOwner } = useCollection();
  const [emailOpen, setEmailOpen] = useState(false);

  const items: DropdownMenuItem[] = [
    { type: 'label', label: t('collection.export.downloadLabel') },
    ...EXPORT_ORDER.map<DropdownMenuItem>((format) => {
      const Icon = FORMAT_ICON[format];
      return {
        key: format,
        label: t(EXPORT_META[format].labelKey),
        description: t(EXPORT_META[format].hintKey),
        icon: <Icon />,
        href: api.exportUrl(collection.id, format, locale),
        download: true,
      };
    }),
  ];
  if (isOwner) {
    items.push(
      { type: 'separator' },
      { type: 'label', label: t('collection.export.emailLabel') },
      {
        key: 'email',
        label: t('collection.export.email'),
        description: t('collection.export.emailHint'),
        icon: <Mail />,
        onSelect: () => setEmailOpen(true),
      },
    );
  }

  return (
    <>
      <DropdownMenu
        aria-label={t('collection.export.menu')}
        align="end"
        minWidth={288}
        items={items}
        trigger={
          <Button leftIcon={<Download className="size-4" />} rightIcon={compact ? undefined : <ChevronDown className="size-4 opacity-60" />}>
            <span className="max-sm:sr-only">{t('collection.action.export')}</span>
          </Button>
        }
      />
      {isOwner ? <EmailExportDialog open={emailOpen} onClose={() => setEmailOpen(false)} /> : null}
    </>
  );
}
