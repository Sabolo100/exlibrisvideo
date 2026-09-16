'use client';

/** "Open by catalogue number" sheet. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Drawer, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n/client';

const ID_RE = /^[1-9]\d{8}$/;

export function AppOpenSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const id = value.replace(/\D/g, '');
    if (!ID_RE.test(id)) {
      setError(t('app.open.invalid'));
      return;
    }
    onClose();
    router.push(`/${id}`);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('app.open.title')}
      size="sm"
      footer={
        <Button variant="primary" size="lg" className="w-full" onClick={submit}>
          {t('app.open.submit')}
        </Button>
      }
    >
      <Field label={t('app.open.label')} hint={t('app.open.hint')} error={error}>
        <Input
          value={value}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          maxLength={11}
          placeholder="334345435"
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="text-center font-mono text-xl tracking-[0.2em]"
        />
      </Field>
    </Drawer>
  );
}
