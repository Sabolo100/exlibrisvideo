# Ex Libris Video – UI kit

Read this before building a page. Everything visual that is shared lives here; do **not** hand-roll a
second button, dialog or chip. Live examples of every component (both themes, mobile) are at
**`/ui-preview`** (dev only).

```ts
import { Button, Dialog, useToast } from '@/components/ui';          // primitives
import { BookSpine, Shelf, BookCover, TopicChip } from '@/components/books'; // book visuals
import { applyFilters, sortBooks, spineColor } from '@/lib/book-utils';      // pure helpers
```

## Conventions

- **Tokens, not colours.** Use the semantic utilities from `globals.css`: `bg-bg`, `bg-surface`,
  `bg-surface-2`, `text-ink`, `text-muted`, `border-line`, `bg-primary text-primary-ink`,
  `text-accent`, `bg-accent-soft`, `text-danger`, `text-success`, `bg-wood` … plus `shadow-soft`,
  `shadow-lift`, `rounded-card`, `font-display` (Fraunces) and `font-sans` (Inter). They switch
  automatically in dark mode (`[data-theme="dark"]`; the `dark:` variant also works for a nested
  dark subtree).
- **`className` is for layout** (margin, width, grid placement). Looks come from props
  (`variant`, `size`, `tone`). There is no tailwind-merge: `cn()` only joins strings, so a plain
  utility that fights a built-in one (`hidden` vs the button's `inline-flex`) may lose. Use
  variant utilities, which always win: `className="max-sm:hidden"` / `"md:hidden"`, or wrap the
  component in a `<span className="hidden sm:inline-flex">`.
- **`ref` is a normal prop** (React 19) on every DOM-backed component.
- **Text:** components render their own strings (close buttons, aria labels, "Másolás") through
  `common.*` i18n keys. Everything you pass in (`title`, `label`, `aria-label`) must come from
  `useI18n().t(...)`. Components also work outside `<I18nProvider>` (Hungarian fallback), so
  they are safe in tests. (`common.*` keys in the examples below exist; keys of other areas such
  as `collection.*` are illustrative – use the ones defined in your own area file.)
- **Client components.** Interactive parts are `'use client'`. `Card`, `Badge`, `Kbd`, `Stat`,
  `Skeleton`, `EmptyState`, `VisuallyHidden` and `Button`/`IconButton` render fine from server
  components too (no hooks) – but pass no functions to them from a server component.
- **Accessibility is built in:** focus rings (`:focus-visible` gold outline), Esc closes the
  top-most layer only, Dialog/Drawer trap focus and restore it, overlays lock page scroll, motion
  respects `prefers-reduced-motion` (`<MotionConfig reducedMotion="user">` in `Providers`).
- **Z-index scale:** header 40 · dialog/drawer 60 · popover 65 · menu 66 · tooltip 70 · toasts 80.
- **Global providers** are mounted once in `app/layout.tsx` via `site/Providers.tsx`
  (`ToastProvider`, theme sync, motion config). Never mount another `ToastProvider`.

---

## Actions

### Button
Variants `primary | secondary (default) | ghost | danger | gold`, sizes `sm | md (default) | lg`.
`href` renders `next/link` (plain `<a>` for `http(s):`, `mailto:`, `download`, `target=_blank`).
`loading` shows a spinner, disables and sets `aria-busy`. `tone="danger"` gives the quiet
`secondary` / `ghost` variants red text (a "Törlés" next to a primary "Mentés"); `fullWidth`.

```tsx
<Button variant="primary" leftIcon={<Upload />} loading={saving} onClick={save}>
  {t('common.action.save')}
</Button>
<Button variant="ghost" tone="danger" leftIcon={<Trash2 />} onClick={askDelete}>{t('common.action.delete')}</Button>
<Button href="/my" variant="ghost">{t('common.nav.my')}</Button>
<label htmlFor="file" className={buttonClasses({ variant: 'gold', size: 'lg' })}>…</label>
```

### IconButton
Icon-only; `aria-label` is **required**. `tooltip` shows the label on hover/focus.
Sizes `xs | sm | md | lg`, `round`, `loading`, same variants as Button (default `ghost`), `href`.

```tsx
<IconButton aria-label={t('common.action.share')} icon={<Share2 />} tooltip onClick={share} />
```

## Surfaces & labels

### Card (+ CardHeader / CardBody / CardFooter)
Variants `raised (default) | plain | inset | bookplate` (inner gold rule – owner banner, share
panel). `interactive` adds a hover lift; `as="section"` changes the element.

```tsx
<Card variant="bookplate">
  <CardHeader title="Megosztás" description="…" icon={<Share2 />} actions={<IconButton … />} />
  <CardBody>…</CardBody>
  <CardFooter><Button variant="primary">{t('common.action.save')}</Button></CardFooter>
</Card>
```
`Card.Header`, `Card.Body`, `Card.Footer` are aliases.

### Badge
Tones `neutral | green | gold | red | blue`, sizes `sm | md`, optional `icon`, `dot`.
`TONE_CLASSES[tone]` exports the tone classes for custom elements.

```tsx
<Badge tone="red" dot>{tp('review.pending', count)}</Badge>
```

### Chip
Filter / tag pill. Toggle with `selected` + `onSelectedChange` (renders `aria-pressed`), optional
`icon`, `count`, `onRemove` (separate × button), `hue` (0–360 tint), sizes `sm | md`.

```tsx
<Chip icon={<Heart />} count={12} selected={filters.favorites}
      onSelectedChange={(v) => setFilters({ favorites: v })}>{t('collection.filter.favorites')}</Chip>
<Chip onRemove={() => removeAuthor(a)}>{a}</Chip>
```

### Kbd

```tsx
<Kbd>Enter</Kbd> <Kbd size="sm">←</Kbd>
```

### VisuallyHidden
Screen-reader-only text; `focusable` makes it appear on focus (skip links).

```tsx
<VisuallyHidden>{t('common.aria.progress')}</VisuallyHidden>
```

### Stat
Big number + label (+ `hint`, `icon`, `tone neutral | green | gold`, `size sm | md | lg`, `framed`).
Format the value yourself with `n()`.

```tsx
<Stat label={t('data.stats.books')} value={n(books.length)} icon={<BookOpen />} framed />
```

### EmptyState
Default illustration is an empty shelf with a leaning book; pass `icon` to use a lucide icon.

```tsx
<EmptyState title={t('collection.empty.noResults')} description="…"
            action={<Button onClick={resetFilters}>{t('collection.filter.reset')}</Button>} />
```

## Form controls

### Field
Label + control + `hint` + `error`, wired automatically (`id`, `aria-describedby`,
`aria-invalid`, `required`) for `Input`, `Textarea`, `Select` placed inside. Also `required`
(red *), `optional` ("(nem kötelező)"), `disabled`, `hideLabel`, `labelAside` (counter/link).

```tsx
<Field label={t('upload.email.label')} hint={t('upload.email.hint')} error={emailError} optional>
  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
</Field>
```
For custom controls use `useFieldControlProps(props)` or `useField()`.

### Input
Sizes `sm | md | lg`; `leftIcon`, `rightElement`, `onClear` (× button while non-empty),
`wrapperClassName`. `CONTROL_BASE` / `CONTROL_SIZES` export the shared control look.

```tsx
<Input type="search" leftIcon={<Search />} value={q} onChange={(e) => setQ(e.target.value)}
       onClear={() => setQ('')} placeholder={t('collection.search.placeholder')} />
```

### Textarea
`autoResize` with `minRows` / `maxRows`.

```tsx
<Textarea autoResize minRows={2} maxRows={8} value={notes} onChange={(e) => setNotes(e.target.value)} />
```

### Select (native)
`options` (`{ value, label, disabled? }[]`) or `<option>` children; `placeholder` adds a disabled
empty first option; `leftIcon`; sizes.

```tsx
<Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
        options={SORTS.map((s) => ({ value: s, label: t(`collection.sort.${s}`) }))} />
```

### Checkbox
Native checkbox with custom box; `label`, `description`, `indeterminate`, `onCheckedChange`,
sizes `sm | md`.

```tsx
<Checkbox checked={all} indeterminate={some} onCheckedChange={toggleAll} label={t('data.table.selectAll')} />
```

### Switch
`role="switch"`; `checked` + `onCheckedChange` required; `label`, `description`,
`labelPosition="left"` for settings rows; sizes `sm | md`.

```tsx
<Switch checked={photo} onCheckedChange={setPhoto} label={t('visual.shelf.realSpines')} />
```

### SegmentedControl
One-of-many (radiogroup, arrow keys). Generic over the value type. `aria-label` required;
options `{ value, label, icon?, disabled?, title?, ariaLabel?, lang? }`; `size`, `fullWidth`,
`iconOnly`. With `fullWidth` the segments share the width equally and long labels truncate
(full label in `title`) instead of widening the page – four long Hungarian labels do not fit a
phone, so there use `size="sm"` with short labels / icons, or a `Select`.

```tsx
<SegmentedControl<ReadingStatus> aria-label={t('common.status.label')} value={status} onChange={setStatus}
  options={READING_STATUSES.map((s) => ({ value: s, label: t(`common.status.${s}`) }))} fullWidth />
```

### StarRating
Read-only by default (fractions allowed, `showValue`). With `onChange` it becomes a keyboard
radiogroup (arrows, Home/End, 1–5, 0/Delete clears; clicking the current value clears when
`allowClear`). Sizes `sm | md | lg`.

```tsx
<StarRating value={book.rating} onChange={(r) => updateBook(book.id, { rating: r })} />
<StarRating value={4.5} size="sm" showValue />
```

### CopyField
Read-only value + copy button ("Másolás" → "Másolva!"), works on plain HTTP too
(`copyToClipboard` fallback). `label` is required (visually hidden unless `showLabel`);
`displayValue`, `compact` (icon button), `leftIcon`, `onCopied`, sizes.

```tsx
<CopyField label={t('collection.share.link')} value={collection.publicUrl} leftIcon={<Link2 />}
           onCopied={() => toast({ title: t('common.action.copied'), tone: 'success' })} />
```

## Overlays

### Dialog
Modal: portal, focus trap (focuses `initialFocusRef`, then `[data-autofocus]`, then the first
focusable), Esc, overlay click, scroll lock, focus restore. Bottom-aligned on phones.
Props: `open`, `onClose`, `title` (required, `hideTitle` keeps it for screen readers),
`description`, `footer`, `size sm | md | lg | xl`, `icon`, `tone="danger"`,
`closeOnOverlayClick`, `closeOnEsc`, `showCloseButton`, `bodyClassName`.

```tsx
<Dialog open={open} onClose={() => setOpen(false)} title={t('collection.settings.title')}
  footer={<>
    <Button onClick={() => setOpen(false)}>{t('common.action.cancel')}</Button>
    <Button variant="primary" loading={saving} onClick={save}>{t('common.action.save')}</Button>
  </>}>
  <Field label="…"><Input data-autofocus /></Field>
</Dialog>
```

### Drawer
Right side panel on ≥ 768 px, bottom sheet with a drag handle on mobile (drag down to dismiss).
Same a11y as Dialog. `headerActions` (e.g. prev/next), `footer` (sticky), `size sm | md | lg`.

```tsx
<Drawer open={Boolean(openBookId)} onClose={() => openBook(null)} title={book.title}
        description={book.author} headerActions={<IconButton aria-label={t('common.action.next')} icon={<ChevronRight />} size="sm" onClick={next} />}>
  …
</Drawer>
```

### Popover
Non-modal panel anchored to a `trigger` element (Button/IconButton). Esc / outside click / focus
leaving closes; focus returns to the trigger. Children may be a render function receiving `close`.
`side`, `align`, `offset`, `matchTriggerWidth`, `autoFocus`, controlled `open`/`onOpenChange`.

```tsx
<Popover aria-label={t('collection.filter.topics')} trigger={<Button leftIcon={<SlidersHorizontal />}>…</Button>}>
  {(close) => <div className="w-72">… <Button onClick={close}>OK</Button></div>}
</Popover>
```

### DropdownMenu
WAI-ARIA menu button: arrows, Home/End, type-ahead, Enter/Space, Esc/Tab closes. Items:
action (`onSelect`, `href`, `download`, `target`, `tone: 'danger'`, `keepOpen`, `shortcut`,
`description`, `icon`), `{ type: 'checkbox', checked, onCheckedChange }` (keeps the menu open),
`{ type: 'radio', checked, onSelect }`, `{ type: 'separator' }`, `{ type: 'label', label }`.

```tsx
<DropdownMenu aria-label={t('exporting.menu')} trigger={<Button leftIcon={<Download />}>{t('common.action.download')}</Button>}
  items={[
    { label: 'Excel (.xlsx)', icon: <FileSpreadsheet />, href: exportUrl('xlsx'), download: true },
    { type: 'separator' },
    { label: t('common.action.delete'), icon: <Trash2 />, tone: 'danger', onSelect: askDelete },
  ]} />
```

### Tooltip
Hover (mouse/pen) and keyboard focus; never on touch – don't put essential info only here.
Child must be a single focusable element. `describeChild={false}` when the text equals the
child's aria-label.

```tsx
<Tooltip content={t('visual.shelf.position', { n: 12 })}><Button variant="ghost">…</Button></Tooltip>
```

### Portal
Renders into `document.body` after hydration (used by all overlays).

```tsx
<Portal><div className="fixed inset-x-0 bottom-0">…</div></Portal>
```

## Navigation

### Tabs (Tabs / TabsList / TabsTrigger / TabsContent)
Automatic activation, arrows/Home/End. `variant underline | pill`, controlled `value` +
`onValueChange` or `defaultValue`. `TabsTrigger` takes `icon`, `count`; `TabsContent`
`keepMounted`.

```tsx
<Tabs value={view} onValueChange={(v) => setView(v as ViewKey)}>
  <TabsList aria-label={t('collection.view.label')}>
    <TabsTrigger value="shelf" icon={<Library />}>{t('collection.view.shelf')}</TabsTrigger>
    <TabsTrigger value="review" count={pending}>{t('collection.view.review')}</TabsTrigger>
  </TabsList>
  <TabsContent value="shelf">…</TabsContent>
</Tabs>
```

## Feedback

### ProgressBar
Determinate (`value` 0–100, spring width) or indeterminate (`indeterminate` or `value` null).
`tone primary | gold | success | danger`, `size xs | sm | md | lg`, `label` (accessible name;
visible with `showLabel`), `showValue`, `detail` (right side text).

```tsx
<ProgressBar value={video.progress} showLabel label={video.originalFilename} showValue
             detail={t('processing.frames', { done: video.framesAnalyzed, total: video.framesTotal })} />
```

### ProgressRing
Circular; `value` null spins. `size` px, `thickness`, `tone`, `showValue`, or custom `children`.

```tsx
<ProgressRing value={readPct} size={96} tone="gold" showValue label={t('data.stats.readShare')} />
```

### Spinner
`size xs | sm | md | lg | xl`, current text colour; `label` (sr text, defaults to "Betöltés…"),
`decorative` inside busy buttons.

```tsx
<Spinner size="lg" className="text-accent" />
```

### Skeleton / SkeletonText
`shape rect | text | circle | spine`, `width`, `height`. Decorative (`aria-hidden`).

```tsx
<Skeleton shape="spine" width={22} height={120} />
<SkeletonText lines={3} />
```

### ToastProvider + useToast
Already mounted globally. `toast({ title, description?, tone?: 'success' | 'error' | 'info',
duration?, action?: { label, onClick }, id? })` returns the id; shortcuts `success`, `error`,
`info`; `dismiss(id?)`. Errors stay 8 s, others 5 s; hover/focus pauses.

```tsx
const { toast } = useToast();
toast({ title: t('common.state.saved'), tone: 'success' });
toast({ title: t('errors.internal'), tone: 'error', action: { label: t('common.action.retry'), onClick: retry } });
```

## Media

### QrCode, qrSvgString, downloadQrPng
Inline SVG QR (always dark-on-paper so it scans in dark mode). `value`, `size` (px, default 160),
`framed` (default true), `label`, `margin`, `dark`, `light`, `errorCorrectionLevel`.
`qrSvgString(value, opts)` gives the SVG markup (server or client);
`downloadQrPng(value, filename, { size })` saves a PNG (returns `false` on failure).

```tsx
<QrCode value={collection.publicUrl} size={160} />
<Button onClick={() => downloadQrPng(collection.publicUrl, `exlibris-${collection.id}.png`)}>{t('common.qr.download')}</Button>
```

## App chrome

### ThemeToggle
`variant menu (icon + light/dark/system menu) | segmented`, `size sm | md`. Writes
`localStorage.exl_theme` + `<html data-theme>`, follows the OS in system mode, syncs tabs.
`useTheme()` → `{ preference, resolved, setPreference }` for custom UI.

```tsx
<ThemeToggle />                               {/* header */}
<ThemeToggle variant="segmented" size="sm" />  {/* settings / mobile menu */}
```

### LanguageSwitch
HU | EN segmented control → `useI18n().setLocale` (cookie + `router.refresh()`).
`labels short | long`, `size`, `fullWidth`. Needs `<I18nProvider>`.

```tsx
<LanguageSwitch labels="long" size="md" />
```

## Hooks & helpers (advanced)
`cn`, `useMediaQuery('(min-width: 768px)')`, `useMounted()`, `useControllableState`,
`useFocusTrap`, `useScrollLock`, `useLayer` + `useEscape` (layer-aware Esc), `useFloating` +
`computeFloatingPosition` (flip/shift positioning), `getTabbables`, `copyToClipboard`.

```tsx
const desktop = useMediaQuery('(min-width: 768px)');
```

---

# Site chrome – `@/components/site/*`

Already used by `app/layout.tsx`; you normally don't render these.

- `SiteHeader` – sticky translucent header: logo, nav (new catalogue `/#upload`, my collections
  `/my`, sample library when `NEXT_PUBLIC_DEMO_COLLECTION_ID` is set), LanguageSwitch,
  ThemeToggle, mobile menu. Give the upload section `id="upload"` on the landing page.
- `SiteFooter` – ornament, tagline, `/privacy`, `/terms`, contact e-mail, year.
- `Providers` – ToastProvider, theme sync, MotionConfig.
- `Logo` / `LogoMark` (bookplate SVG) and `Ornament` (fleuron rule, from `SiteFooter`) can be
  reused for hero sections, e-mail-like pages and empty states:

```tsx
import { LogoMark } from '@/components/site/Logo';
import { Ornament } from '@/components/site/SiteFooter';
<LogoMark className="h-12 w-auto" /> <Ornament className="mx-auto" />
```

---

# Book visuals – `@/components/books`

### BookSpine – the signature element
Cloth / label / paperback / leather binding picked deterministically per book, colour from
`spineColor(book)`, bands, foil title on dark spines, text bottom-to-top, auto-fit (author
shortened to the family name or dropped before the title shrinks, long titles on two lines,
ellipsis). Width/height from `spineDimensions(book)`.
Props: `book`, `size xs | sm | md | lg` (default: surrounding Shelf's size, else `md`),
`photo` (use `book.spineImage` crop, falls back to the drawn spine on error), `interactive`
(automatic with `onClick`; `role="button"`, Enter/Space, spring lift), `pulled`,
`onClick(book, event)`, `decorative` (hide from AT), `className`, `style`, `children` (overlays).
Accessible name: `spineLabel(book)` = "Author – Title".

```tsx
<BookSpine book={book} size="md" photo={realSpines} pulled={openBookId === book.id}
           onClick={(b) => openBook(b.id)} />
<BookSpine book={book} size="xs" decorative />   {/* mini spines in author cards */}
```
Geometry for virtualisation/layout: `spineBox(book, size)` → `{ width, height }` px,
`SPINE_SIZES`, `shelfRowHeight(size)`, `SHELF_GEOMETRY`.

### Shelf
Walnut bookcase: back panel, top board with optional brass `label` plate (+ `count`), side walls,
one plank per wrapped row (spines bottom-aligned, wrap responsively), `bookends`.
Render `books` (with `onBookClick`, `pulledId`, `photo`, `size`) or pass custom `children`.
`renderBook(book, spine, index)` wraps each default spine (tooltips, badges).
`emptyLabel`, `aria-label`.

```tsx
<Shelf books={group.books} size="md" label={topicLabel(group.key, locale)} count={group.books.length}
       photo={realSpines} pulledId={openBookId} onBookClick={(b) => openBook(b.id)} bookends />
```

### BookCover
2:3 cover that scales with its width. Shows `book.coverImage` (graceful fallback on error) or a
generated typographic cover (spine colour, Fraunces title, author small caps, gold frame, topic
icon – three compositions). `generatedOnly`, `showTopicIcon`, `priority`, `decorative`,
`children` overlays.

```tsx
<BookCover book={book} className="w-40" />
```

### TopicChip
Taxonomy key → hue-tinted Chip with emoji icon and localized label; accepts all Chip props.

```tsx
<TopicChip topic="poetry" count={8} selected={filters.topics.includes('poetry')}
           onSelectedChange={(on) => toggleTopic('poetry', on)} />
```

### ReadingStatusBadge
Badge with icon + `common.status.*` label. `hideUnknown`, `iconOnly`, `size`.
`READING_STATUS_META[status]` → `{ icon, tone, labelKey }` for segmented controls and filters.

```tsx
<ReadingStatusBadge status={book.readingStatus} hideUnknown />
```

### ConfidenceMeter
Five signal bars (`role="meter"`), ≥ 0.8 high / ≥ 0.6 medium / low. `showLabel` → "Magas (92%)".
`confidenceLevel(value)` exported.

```tsx
<ConfidenceMeter value={book.confidence} showLabel size="sm" />
```

### CountryFlag
Emoji flag with localized name as accessible name/title; `showName`. Renders nothing for invalid
codes.

```tsx
<CountryFlag code={book.authorCountry} showName />
```

### LanguageLabel
"hu" → "Magyar" / "Hungarian". `variant text | badge`, `icon`, `showCode`.

```tsx
<LanguageLabel code={book.originalLanguage} variant="badge" icon />
```

### Sample data
`SAMPLE_BOOKS` (34 realistic Hungarian home-library books) and `makeSampleBook({ title, … })`
(complete `BookDTO` with defaults) – for previews and tests.

---

# `@/lib/book-utils` (pure, no DOM – server, client, tests)

| Function | Use |
|---|---|
| `foldText(s)`, `foldForSearch(s)` | lower-case, accents folded (ő→o), punctuation removed for search |
| `bookMatchesQuery(book, q)` | accent-insensitive AND search over title, subtitle, author, series, publisher, original title, spine reading, ISBN |
| `applyFilters(books, filters)` | `BookFilters` from `collection/context` (OR within a filter, AND across) |
| `countActiveFilters(filters)` | badge count for the filter button |
| `sortBooks(books, sort, locale)` | `SortKey`, `Intl.Collator` hu/en, missing values last |
| `collator(locale)` | cached collator for your own sorts |
| `authorInitial(book)`, `initialOf(s)`, `compareInitials(a, b, locale)` | A–Z rail: Hungarian digraphs (Cs, Dzs, Gy, Ny, Sz, Zs…), Á→A, `#` last |
| `authorSortName(book)`, `authorFamilyName(book)`, `splitAuthors(author)`, `titleSortName(book)` | display-ready sort names |
| `uniqueAuthors(books, locale)` | `{ author, count, books }[]` |
| `topicCounts(books)`, `bookTopicKeys(book)` | topic tiles, charts, filter counts |
| `decadeOf`, `centuryOf`, `centuryNumber` | timeline buckets |
| `isPendingReview(book)`, `isLent(book)` | flags |
| `spineColor(book)`, `readableTextColor(bg)`, `isDarkColor`, `shadeColor`, `mixColors`, `contrastRatio`, `SPINE_PALETTE` | colours |
| `spineDimensions(book)` | `{ heightRatio 0.78–1, widthRatio 0.7–1.35 }` |
| `countryFlagEmoji(code)`, `countryName(code, locale)`, `languageName(code, locale)` | Intl.DisplayNames with fallbacks |
| `shuffle(items, seed)`, `pickRandom(items, seed?)`, `seededRandom(seed)`, `hashString`, `hash01` | deterministic randomness ("Mit olvassak ma?") |

```ts
const visible = sortBooks(applyFilters(books, filters), sort, locale);
const rail = [...new Set(visible.map((b) => authorInitial(b)))].sort((a, b) => compareInitials(a, b, locale));
```
