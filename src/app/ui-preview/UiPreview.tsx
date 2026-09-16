'use client';

/**
 * Living style guide (dev only). Section captions are developer-facing English; every component
 * renders its own user-facing strings through i18n.
 */
import {
  Bell,
  BookOpen,
  Download,
  FileSpreadsheet,
  FileText,
  Heart,
  Library,
  Link2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookCover,
  BookSpine,
  ConfidenceMeter,
  CountryFlag,
  LanguageLabel,
  ReadingStatusBadge,
  SAMPLE_BOOKS,
  Shelf,
  TopicChip,
  type SpineSize,
} from '@/components/books';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Chip,
  CopyField,
  Dialog,
  Drawer,
  DropdownMenu,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  LanguageSwitch,
  Popover,
  ProgressBar,
  ProgressRing,
  QrCode,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonText,
  Spinner,
  StarRating,
  Stat,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeToggle,
  Tooltip,
  VisuallyHidden,
  downloadQrPng,
  useToast,
} from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { authorInitial, compareInitials, sortBooks, uniqueAuthors } from '@/lib/book-utils';
import type { BookDTO, ReadingStatus } from '@/lib/types';

/** Fake "photographed" spine as an SVG data URI (the real app serves JPEG crops from /api/media). */
function fakeSpinePhoto(color: string, title: string, author: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="600" viewBox="0 0 90 600">
<defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0"/></filter>
<linearGradient id="l" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
<rect width="90" height="600" fill="${color}"/><rect width="90" height="600" fill="url(#l)"/><rect width="90" height="600" filter="url(#n)"/>
<rect x="0" y="40" width="90" height="6" fill="#e9d7a5" opacity=".7"/><rect x="0" y="552" width="90" height="6" fill="#e9d7a5" opacity=".7"/>
<g transform="translate(52 300) rotate(-90)"><text text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#f4ead2" font-weight="700">${title}</text></g>
<g transform="translate(76 300) rotate(-90)"><text text-anchor="middle" font-family="Arial,sans-serif" font-size="15" letter-spacing="2" fill="#f4ead2" opacity=".8">${author.toUpperCase()}</text></g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function usePreviewBooks(): BookDTO[] {
  return useMemo(
    () =>
      SAMPLE_BOOKS.map((b, i) => {
        if (i === 1) return { ...b, spineImage: fakeSpinePhoto('#3b4a3f', 'Harmonia Caelestis', 'Esterházy') };
        if (i === 3) return { ...b, spineImage: fakeSpinePhoto('#23452f', 'A Pál utcai fiúk', 'Molnár') };
        if (i === 8) return { ...b, spineImage: fakeSpinePhoto('#1b2a3a', 'A gyertyák csonkig égnek', 'Márai') };
        if (i === 11) return { ...b, spineImage: fakeSpinePhoto('#7c2a24', 'Egri csillagok', 'Gárdonyi') };
        // broken photo → falls back to the drawn spine
        if (i === 5) return { ...b, spineImage: '/api/media/does-not-exist.jpg' };
        return b;
      }),
    [],
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line/70 py-10 first-of-type:border-t-0">
      <div className="mb-6">
        <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[9rem_1fr] sm:items-center">
      <div className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const SWATCHES = [
  ['bg', 'bg-bg'],
  ['surface', 'bg-surface'],
  ['surface-2', 'bg-surface-2'],
  ['ink', 'bg-ink'],
  ['muted', 'bg-muted'],
  ['line', 'bg-line'],
  ['primary', 'bg-primary'],
  ['accent', 'bg-accent'],
  ['accent-soft', 'bg-accent-soft'],
  ['burgundy', 'bg-burgundy'],
  ['danger', 'bg-danger'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['wood-light', 'bg-wood-light'],
  ['wood', 'bg-wood'],
  ['wood-dark', 'bg-wood-dark'],
] as const;

export function UiPreview() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const books = usePreviewBooks();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerIndex, setDrawerIndex] = useState(0);
  const [status, setStatus] = useState<ReadingStatus>('reading');
  const [rating, setRating] = useState<number | null>(4);
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [query, setQuery] = useState('Esterházy');
  const [email, setEmail] = useState('nem-email');
  const [notes, setNotes] = useState('Kölcsönadtam Bencének, szeptember végéig visszahozza.');
  const [chips, setChips] = useState<string[]>(['poetry']);
  const [progress, setProgress] = useState(12);
  const [photo, setPhoto] = useState(true);
  const [pulledId, setPulledId] = useState<string | null>(books[6]?.id ?? null);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [sort, setSort] = useState('shelf');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setProgress((p) => (p >= 100 ? 0 : p + 7)), 1200);
    return () => clearInterval(timer);
  }, []);

  const byInitial = useMemo(() => {
    const map = new Map<string, BookDTO[]>();
    for (const b of sortBooks(books, 'author', locale)) {
      const k = authorInitial(b);
      map.set(k, [...(map.get(k) ?? []), b]);
    }
    return [...map.entries()].sort((a, b) => compareInitials(a[0], b[0], locale));
  }, [books, locale]);

  const drawerBook = books[drawerIndex];
  const statuses: ReadingStatus[] = ['unknown', 'read', 'reading', 'to_read', 'abandoned'];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <header className="flex flex-col gap-4 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Ex Libris Video</p>
          <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">UI kit</h1>
          <p className="mt-2 max-w-xl text-muted">
            Living style guide – every shared component in both themes. Import from{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.85em]">@/components/ui</code> and{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.85em]">@/components/books</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitch size="md" />
          <ThemeToggle variant="segmented" />
        </div>
      </header>

      <nav aria-label="Sections" className="sticky top-14 z-20 -mx-4 mb-2 overflow-x-auto border-y border-line/70 bg-bg/90 px-4 py-2 backdrop-blur sm:top-16 sm:-mx-6 sm:px-6">
        <ul className="flex gap-4 text-sm whitespace-nowrap text-muted">
          {['tokens', 'buttons', 'labels', 'forms', 'overlays', 'feedback', 'layout', 'shelves', 'covers', 'dark'].map((s) => (
            <li key={s}>
              <a className="hover:text-ink" href={`#${s}`}>
                {s}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="tokens" title="Tokens & type" description="Semantic colours from globals.css (they switch with the theme). Fraunces for display, Inter for UI.">
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-12 rounded-lg border border-line shadow-soft ${cls}`} />
              <span className="text-[0.6875rem] text-muted">{name}</span>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <p className="font-display text-5xl leading-none font-semibold">Az ajtó</p>
            <p className="font-display text-3xl italic">Utas és holdvilág</p>
            <p className="font-display text-xl">Árvíztűrő tükörfúrógép – ő ű Ő Ű</p>
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-base">Inter 16 – Egy videó a polcodról – és kész a könyvtárad katalógusa.</p>
            <p className="text-muted">Muted 14 – A forrásvideót a feldolgozás után töröljük.</p>
            <p className="text-xs tracking-[0.08em] text-muted uppercase">Overline 12</p>
            <p className="paper rounded-lg border border-line p-3">.paper grain surface</p>
          </div>
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <Row label="Variants">
          <Button variant="primary" leftIcon={<Upload />}>
            Feltöltés
          </Button>
          <Button variant="secondary">{t('common.action.cancel')}</Button>
          <Button variant="ghost" leftIcon={<Pencil />}>
            {t('common.action.edit')}
          </Button>
          <Button variant="danger" leftIcon={<Trash2 />}>
            {t('common.action.delete')}
          </Button>
          <Button variant="gold" rightIcon={<BookOpen />}>
            Feldolgozás indítása
          </Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm" variant="primary">
            Small
          </Button>
          <Button size="md" variant="primary">
            Medium
          </Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
          <Button size="lg" variant="gold" leftIcon={<Plus />}>
            {t('common.nav.new')}
          </Button>
        </Row>
        <Row label="States">
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1600);
            }}
          >
            {loading ? t('common.state.saving') : t('common.action.save')}
          </Button>
          <Button disabled>Disabled</Button>
          <Button href="/my" variant="secondary" leftIcon={<Library />}>
            Link → /my
          </Button>
          <Button href="mailto:hello@exlibrisvideo.hu" variant="ghost" leftIcon={<Mail />}>
            mailto
          </Button>
          <Button fullWidth variant="secondary" className="sm:hidden">
            Full width
          </Button>
        </Row>
        <Row label="Icon buttons">
          <IconButton aria-label={t('common.action.share')} icon={<Share2 />} tooltip />
          <IconButton aria-label={t('common.action.edit')} icon={<Pencil />} variant="secondary" tooltip />
          <IconButton aria-label="Kedvenc" icon={<Heart />} variant="primary" round tooltip tooltipSide="bottom" />
          <IconButton aria-label={t('common.action.delete')} icon={<Trash2 />} variant="danger" tooltip />
          <IconButton aria-label={t('common.action.download')} icon={<Download />} variant="gold" size="lg" />
          <IconButton aria-label={t('common.state.loading')} icon={<Bell />} loading size="sm" variant="secondary" />
          <IconButton aria-label="xs" icon={<Settings />} size="xs" />
        </Row>
      </Section>

      <Section id="labels" title="Badges, chips & book labels">
        <Row label="Badge">
          <Badge>Neutral</Badge>
          <Badge tone="green" dot>
            Kész
          </Badge>
          <Badge tone="gold">Új</Badge>
          <Badge tone="red">3 ellenőrzendő</Badge>
          <Badge tone="blue" size="sm">
            Feldolgozás
          </Badge>
        </Row>
        <Row label="Chip">
          <Chip selected={chips.includes('fav')} onSelectedChange={() => setChips((c) => (c.includes('fav') ? c.filter((x) => x !== 'fav') : [...c, 'fav']))} icon={<Heart />} count={12}>
            Kedvencek
          </Chip>
          <Chip onRemove={() => toast({ title: 'Szűrő eltávolítva', tone: 'info' })}>Esterházy Péter</Chip>
          <Chip size="sm" count={4}>
            Static
          </Chip>
          <Chip disabled onSelectedChange={() => {}}>
            Disabled
          </Chip>
        </Row>
        <Row label="TopicChip">
          {['poetry', 'hungarian_literature', 'scifi', 'history', 'children', 'crime_thriller'].map((key) => (
            <TopicChip
              key={key}
              topic={key}
              count={key.length}
              selected={chips.includes(key)}
              onSelectedChange={(sel) => setChips((c) => (sel ? [...c, key] : c.filter((x) => x !== key)))}
            />
          ))}
          <TopicChip topic="nature" onRemove={() => {}} size="sm" />
        </Row>
        <Row label="Reading status">
          {statuses.map((s) => (
            <ReadingStatusBadge key={s} status={s} />
          ))}
          <ReadingStatusBadge status="read" iconOnly size="sm" />
        </Row>
        <Row label="Confidence">
          <ConfidenceMeter value={0.95} showLabel />
          <ConfidenceMeter value={0.66} showLabel />
          <ConfidenceMeter value={0.31} showLabel size="sm" />
        </Row>
        <Row label="Country / lang">
          <CountryFlag code="HU" showName />
          <CountryFlag code="it" />
          <CountryFlag code="GB" showName />
          <LanguageLabel code="hu" />
          <LanguageLabel code="de" variant="badge" icon />
          <LanguageLabel code="sv" showCode />
        </Row>
        <Row label="Kbd">
          <span className="text-sm text-muted">
            <Kbd>Enter</Kbd> elfogad · <Kbd>Del</Kbd> töröl · <Kbd>←</Kbd> <Kbd>→</Kbd> lapoz
          </span>
          <VisuallyHidden>Only for screen readers</VisuallyHidden>
        </Row>
      </Section>

      <Section id="forms" title="Form controls">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Field label="Keresés" hideLabel>
              <Input
                type="search"
                placeholder="Cím, szerző, sorozat…"
                leftIcon={<Search />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery('')}
              />
            </Field>
            <Field label="E-mail cím" hint="Ide küldjük el a katalógust Excelben." error={email.includes('@') ? undefined : 'Érvényes e-mail címet adj meg.'} required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail />} />
            </Field>
            <Field label="Kollekció neve" optional labelAside="0 / 80">
              <Input placeholder="Nappali, nagy polc" size="lg" />
            </Field>
            <Field label="Jegyzet" hint="Csak te látod.">
              <Textarea autoResize value={notes} onChange={(e) => setNotes(e.target.value)} minRows={2} maxRows={6} />
            </Field>
            <Field label="Rendezés">
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                leftIcon={<SlidersHorizontal />}
                options={[
                  { value: 'shelf', label: 'Polc sorrendje' },
                  { value: 'author', label: 'Szerző' },
                  { value: 'title', label: 'Cím' },
                  { value: 'year', label: 'Kiadás éve' },
                ]}
              />
            </Field>
            <Field label="Nyelv" disabled>
              <Select placeholder={t('common.select.placeholder')} defaultValue="" options={[{ value: 'hu', label: 'Magyar' }]} size="sm" />
            </Field>
          </div>
          <div className="flex flex-col gap-5">
            <Checkbox checked={checked} onCheckedChange={setChecked} label="Küldjétek el e-mailben is" description="Excel és PDF melléklettel." />
            <Checkbox indeterminate label="Mind kijelölése (részleges)" size="sm" />
            <Checkbox disabled label="Letiltva" />
            <Switch checked={switchOn} onCheckedChange={setSwitchOn} label="Valódi gerincek" description="A videóból kivágott gerincfotók mutatása." />
            <Switch checked={!switchOn} onCheckedChange={(v) => setSwitchOn(!v)} label="Kompakt" size="sm" labelPosition="left" />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('common.status.label')}</span>
              <SegmentedControl<ReadingStatus>
                aria-label={t('common.status.label')}
                value={status}
                onChange={setStatus}
                fullWidth
                options={statuses.slice(1).map((s) => ({ value: s, label: t(`common.status.${s}`) }))}
              />
              <SegmentedControl
                aria-label="Sűrűség"
                size="sm"
                value={density}
                onChange={setDensity}
                options={[
                  { value: 'comfortable', label: 'Kényelmes' },
                  { value: 'compact', label: 'Tömör' },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <StarRating value={rating} onChange={setRating} size="lg" />
              <StarRating value={3.5} showValue />
              <StarRating value={null} size="sm" />
            </div>
            <CopyField label="Megosztható link" showLabel value="https://www.exlibrisvideo.hu/334345435" leftIcon={<Link2 />} onCopied={() => toast({ title: t('common.action.copied'), tone: 'success' })} />
            <CopyField label="Tulajdonosi link" value="https://www.exlibrisvideo.hu/334345435?k=Zm9vYmFyYmF6" compact size="sm" />
          </div>
        </div>
      </Section>

      <Section id="overlays" title="Overlays" description="Dialog and Drawer trap focus, close on Esc and overlay click; the Drawer is a bottom sheet under 768 px (drag the handle down).">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" leftIcon={<Settings />} onClick={() => setDialogOpen(true)}>
            Dialog
          </Button>
          <Button variant="danger" onClick={() => setDangerOpen(true)}>
            Danger dialog
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Drawer
          </Button>
          <Popover
            aria-label="Szűrők"
            trigger={
              <Button variant="secondary" leftIcon={<SlidersHorizontal />}>
                Popover
              </Button>
            }
          >
            {(close) => (
              <div className="flex w-72 flex-col gap-3">
                <p className="font-display text-base font-semibold">Témák</p>
                <div className="flex flex-wrap gap-2">
                  {['poetry', 'history', 'scifi', 'children'].map((k) => (
                    <TopicChip key={k} topic={k} size="sm" selected={chips.includes(k)} onSelectedChange={(sel) => setChips((c) => (sel ? [...c, k] : c.filter((x) => x !== k)))} />
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="primary" onClick={close}>
                    {t('common.action.confirm')}
                  </Button>
                </div>
              </div>
            )}
          </Popover>
          <DropdownMenu
            aria-label="Exportálás"
            trigger={
              <Button variant="secondary" leftIcon={<Download />}>
                DropdownMenu
              </Button>
            }
            items={[
              { type: 'label', label: 'Letöltés' },
              { label: 'Excel (.xlsx)', icon: <FileSpreadsheet />, onSelect: () => toast({ title: 'Excel', tone: 'info' }) },
              { label: 'PDF katalógus', icon: <FileText />, description: 'Nyomtatható', onSelect: () => toast({ title: 'PDF', tone: 'info' }) },
              { label: 'Kollekcióim', icon: <Library />, href: '/my' },
              { type: 'separator' },
              { type: 'checkbox', label: 'Borítókkal', checked: switchOn, onCheckedChange: setSwitchOn },
              { label: 'Küldés e-mailben', icon: <Mail />, shortcut: '⌘E', onSelect: () => toast({ title: 'E-mail', tone: 'success' }) },
              { label: 'Letiltott', disabled: true },
              { type: 'separator' },
              { label: t('common.action.delete'), icon: <Trash2 />, tone: 'danger', onSelect: () => setDangerOpen(true) },
            ]}
          />
          <DropdownMenu
            trigger={<IconButton aria-label={t('common.aria.moreActions')} icon={<MoreHorizontal />} variant="secondary" />}
            items={[
              { label: t('common.action.edit'), icon: <Pencil /> },
              { label: t('common.action.share'), icon: <Share2 /> },
            ]}
          />
          <Tooltip content="Tooltip: a könyv a polcon a 12. helyen áll">
            <Button variant="ghost">Tooltip (hover / focus)</Button>
          </Tooltip>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => toast({ title: 'Mentve', description: 'A könyv adatai frissültek.', tone: 'success' })}>Toast success</Button>
          <Button onClick={() => toast({ title: 'Nem sikerült menteni', description: 'Ellenőrizd a kapcsolatot, majd próbáld újra.', tone: 'error', action: { label: t('common.action.retry'), onClick: () => {} } })}>
            Toast error
          </Button>
          <Button onClick={() => toast({ title: '3 új könyv került a polcra', tone: 'info' })}>Toast info</Button>
        </div>

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Kollekció beállításai"
          description="A cím és a láthatóság bármikor módosítható."
          icon={<Settings />}
          footer={
            <>
              <Button onClick={() => setDialogOpen(false)}>{t('common.action.cancel')}</Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                {t('common.action.save')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Cím">
              <Input defaultValue="Nappali, nagy polc" data-autofocus />
            </Field>
            <Field label="Láthatóság" hint="PIN-kóddal csak az láthatja, akinek megadod.">
              <Select defaultValue="link" options={[{ value: 'link', label: 'Bárki, akinek megvan a link' }, { value: 'pin', label: 'PIN-kóddal védett' }]} />
            </Field>
            <DropdownMenu trigger={<Button size="sm">Nested menu</Button>} items={[{ label: 'Egy' }, { label: 'Kettő' }]} />
          </div>
        </Dialog>

        <Dialog
          open={dangerOpen}
          onClose={() => setDangerOpen(false)}
          tone="danger"
          size="sm"
          icon={<Trash2 />}
          title="Törlöd a kollekciót?"
          description="A 34 könyv és minden feltöltött fájl véglegesen törlődik."
          footer={
            <>
              <Button onClick={() => setDangerOpen(false)}>{t('common.action.cancel')}</Button>
              <Button variant="danger" onClick={() => setDangerOpen(false)}>
                {t('common.action.delete')}
              </Button>
            </>
          }
        />

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={drawerBook.title}
          description={drawerBook.author ?? t('common.book.unknownAuthor')}
          headerActions={
            <>
              <IconButton aria-label={t('common.action.back')} icon={<span aria-hidden="true">‹</span>} size="sm" onClick={() => setDrawerIndex((i) => (i - 1 + books.length) % books.length)} />
              <IconButton aria-label={t('common.action.next')} icon={<span aria-hidden="true">›</span>} size="sm" onClick={() => setDrawerIndex((i) => (i + 1) % books.length)} />
            </>
          }
          footer={
            <>
              <Button variant="ghost" tone="danger" leftIcon={<Trash2 />} className="mr-auto">
                {t('common.action.delete')}
              </Button>
              <Button variant="primary" onClick={() => setDrawerOpen(false)}>
                {t('common.action.save')}
              </Button>
            </>
          }
        >
          <div className="flex gap-4">
            <BookSpine book={drawerBook} size="lg" photo />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <BookCover book={drawerBook} className="max-w-[9rem]" />
              <div className="flex flex-wrap gap-1.5">
                {[drawerBook.category, ...drawerBook.topics].filter(Boolean).map((k) => (
                  <TopicChip key={k as string} topic={k as string} size="sm" />
                ))}
              </div>
              <ConfidenceMeter value={drawerBook.confidence} showLabel />
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-4">
            <SegmentedControl<ReadingStatus> aria-label={t('common.status.label')} value={status} onChange={setStatus} fullWidth size="sm" options={statuses.slice(1).map((s) => ({ value: s, label: t(`common.status.${s}`) }))} />
            <StarRating value={rating} onChange={setRating} />
            <Field label="Jegyzet">
              <Textarea autoResize value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <SkeletonText lines={6} />
          </div>
        </Drawer>
      </Section>

      <Section id="feedback" title="Feedback & data">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <ProgressBar value={progress} showLabel label="Videó feldolgozása" showValue detail={`${Math.round(progress / 2)} / 48 képkocka`} />
            <ProgressBar value={64} tone="gold" size="sm" />
            <ProgressBar indeterminate label="Előkészítés" showLabel size="sm" />
            <ProgressBar value={100} tone="success" size="xs" />
            <div className="flex items-center gap-5">
              <ProgressRing value={progress} showValue size={72} />
              <ProgressRing value={38} tone="gold" size={56}>
                <BookOpen className="size-5 text-accent" />
              </ProgressRing>
              <ProgressRing value={null} size={40} />
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" className="text-accent" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Könyv" value="1 284" icon={<BookOpen />} framed hint="+12 ma" />
            <Stat label="Szerző" value="612" icon={<Library />} tone="green" framed />
            <Stat label="Polchossz" value="32,1 m" size="sm" />
            <Stat label="Oldal" value="≈ 410 ezer" size="sm" tone="neutral" />
          </div>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Card variant="plain" className="p-5">
            <div className="flex items-end gap-1">
              {[70, 90, 60, 100, 80, 75, 95].map((h, i) => (
                <Skeleton key={i} shape="spine" width={14 + (i % 3) * 4} height={h} />
              ))}
            </div>
            <SkeletonText lines={3} className="mt-4" />
          </Card>
          <Card variant="inset">
            <EmptyState size="sm" title="Nincs találat" description="Próbálj más keresőszót vagy töröld a szűrőket." action={<Button size="sm">Szűrők törlése</Button>} />
          </Card>
          <Card variant="raised">
            <EmptyState size="sm" icon={<Upload />} title="Még nincs videó" description="Töltsd fel az első polcvideódat." />
          </Card>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <QrCode value="https://www.exlibrisvideo.hu/334345435" size={148} />
          <QrCode value="https://www.exlibrisvideo.hu/334345435" size={88} framed={false} />
          <Button leftIcon={<Download />} onClick={() => downloadQrPng('https://www.exlibrisvideo.hu/334345435', 'exlibris-334345435.png')}>
            {t('common.qr.download')}
          </Button>
        </div>
      </Section>

      <Section id="layout" title="Cards & tabs">
        <div className="grid gap-6 md:grid-cols-3">
          <Card variant="bookplate">
            <CardHeader title="Ex libris" description="Bookplate card with the inner gold rule." icon={<BookOpen />} />
            <CardBody className="text-sm text-muted">Use for the owner banner and share panel.</CardBody>
            <CardFooter>
              <Button size="sm" variant="primary">
                {t('common.action.share')}
              </Button>
            </CardFooter>
          </Card>
          <Card interactive>
            <CardHeader
              title="Nappali polc"
              description="34 könyv · 2026. szept. 12."
              actions={<IconButton aria-label={t('common.aria.moreActions')} icon={<MoreHorizontal />} size="sm" />}
            />
            <CardBody>
              <div className="flex items-end gap-px">
                {books.slice(0, 14).map((b) => (
                  <BookSpine key={b.id} book={b} size="xs" decorative />
                ))}
              </div>
            </CardBody>
          </Card>
          <Card variant="inset" className="p-4">
            <Tabs defaultValue="shelf">
              <TabsList aria-label="Nézet">
                <TabsTrigger value="shelf" icon={<Library />}>
                  Polc
                </TabsTrigger>
                <TabsTrigger value="covers" count={34}>
                  Borítók
                </TabsTrigger>
                <TabsTrigger value="review" count={2}>
                  Ellenőrzés
                </TabsTrigger>
              </TabsList>
              <TabsContent value="shelf" className="pt-4 text-sm text-muted">
                Virtuális könyvespolc.
              </TabsContent>
              <TabsContent value="covers" className="pt-4 text-sm text-muted">
                Borítófal.
              </TabsContent>
              <TabsContent value="review" className="pt-4 text-sm text-muted">
                Két könyv vár ellenőrzésre.
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="a" variant="pill" className="mt-6">
              <TabsList aria-label="Pill tabs">
                <TabsTrigger value="a">Évtized</TabsTrigger>
                <TabsTrigger value="b">Évszázad</TabsTrigger>
              </TabsList>
            </Tabs>
          </Card>
        </div>
      </Section>

      <Section id="shelves" title="BookSpine & Shelf" description="Click a spine to pull it out. Photo mode uses book.spineImage (4 fake photos + 1 broken URL that falls back).">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <Switch checked={photo} onCheckedChange={setPhoto} label="Valódi gerincek (photo)" />
          <span className="text-sm text-muted">Pulled: {books.find((b) => b.id === pulledId)?.title ?? '–'}</span>
        </div>
        <div className="flex flex-col gap-8">
          <Shelf
            books={books}
            size="md"
            photo={photo}
            bookends
            label="Nappali · nagy polc"
            count={books.length}
            pulledId={pulledId}
            onBookClick={(b) => setPulledId((id) => (id === b.id ? null : b.id))}
            renderBook={(book, spine) => (
              <Tooltip content={`${book.author ?? t('common.book.unknownAuthor')} – ${book.title}`} describeChild={false}>
                {spine as React.ReactElement}
              </Tooltip>
            )}
          />
          <div className="grid items-start gap-8 lg:grid-cols-2">
            {(['lg', 'sm'] as SpineSize[]).map((size) => (
              <Shelf key={size} books={books.slice(0, size === 'lg' ? 9 : 22)} size={size} photo={photo} label={`size="${size}"`} onBookClick={(b) => setPulledId(b.id)} pulledId={pulledId} />
            ))}
          </div>
          <Shelf books={books} size="xs" label='size="xs"' bookends />
          <div className="grid items-start gap-6 md:grid-cols-3">
            {byInitial.slice(0, 6).map(([initial, list]) => (
              <Shelf key={initial} books={list} size="sm" label={initial} count={list.length} onBookClick={(b) => setPulledId(b.id)} pulledId={pulledId} />
            ))}
          </div>
          <Shelf books={[]} size="sm" label="Üres" />
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Standalone spines (no shelf), uniqueAuthors top 5</p>
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex items-end gap-0.5">
                {books.slice(12, 20).map((b) => (
                  <BookSpine key={b.id} book={b} size="md" interactive />
                ))}
              </div>
              <ul className="text-sm text-muted">
                {uniqueAuthors(books, locale)
                  .slice(0, 5)
                  .map((a) => (
                    <li key={a.author}>
                      {a.author} · {a.count}
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <Section id="covers" title="BookCover" description="Generated typographic covers (three compositions picked per book), a real Open Library image, and a broken image URL that falls back.">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-6">
          {books.map((b) => (
            <figure key={b.id} className="flex flex-col gap-2">
              <BookCover book={b} />
              <figcaption className="text-xs leading-snug">
                <span className="line-clamp-2 font-medium text-ink">{b.title}</span>
                <span className="text-muted">{b.author ?? t('common.book.unknownAuthor')}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section id="dark" title="Dark island" description='A nested data-theme="dark" subtree (tokens re-bind locally). Use the theme toggle above to view the whole page dark.'>
        <div data-theme="dark" className="rounded-card border border-line bg-bg p-5 text-ink sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" leftIcon={<Upload />}>
              Feltöltés
            </Button>
            <Button variant="secondary">{t('common.action.cancel')}</Button>
            <Button variant="gold">Arany</Button>
            <Button variant="danger">{t('common.action.delete')}</Button>
            <Badge tone="green" dot>
              Kész
            </Badge>
            <Badge tone="gold">Új</Badge>
            <Badge tone="blue">Olvasom</Badge>
            <TopicChip topic="poetry" selected />
            <TopicChip topic="history" />
            <ReadingStatusBadge status="to_read" />
            <StarRating value={4} />
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card variant="bookplate">
              <CardHeader title="Lámpafényes könyvtár" description="Dark mode surface & tokens." icon={<BookOpen />} />
              <CardBody className="flex flex-col gap-4">
                <Field label="E-mail" error="Érvényes e-mail címet adj meg.">
                  <Input defaultValue="rossz@" />
                </Field>
                <ProgressBar value={58} showValue label="Feldolgozás" showLabel />
                <Switch checked onCheckedChange={() => {}} label="Valódi gerincek" />
              </CardBody>
            </Card>
            <div className="grid grid-cols-3 gap-4">
              {books.slice(14, 20).map((b) => (
                <BookCover key={b.id} book={b} />
              ))}
            </div>
          </div>
          <Shelf books={books.slice(0, 20)} size="md" label="Éjszakai polc" className="mt-6" bookends />
        </div>
      </Section>
    </div>
  );
}
