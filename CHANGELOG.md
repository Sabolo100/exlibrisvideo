# Changelog

All notable changes of Ex Libris Video. Versions follow semantic versioning; the version lives in
`package.json` and is shown in the site footer and the app settings next to a short build id (content hash
of the sources, see `next.config.ts`). `GET /api/health` reports both.

## 1.13.0 – 2026-10-19

### Changed
- **A new, slower promo video** (v1.2.0, 2 min 1 s, 720p, 10.4 MB) replaces the 78-second one. Same content and order,
  but the pace is calmer so the text can be read: the phone part (bottom menu, search, filters, "books of one
  recording") now runs about 20 s instead of 12, the three steps and every feature got more time, and the recordings
  play at close to real speed instead of being sped up. The caption under the player says "in two minutes" (it said
  "78 seconds").
- **The demo library in the video was re-curated.** The real-spine view showed several photos that stood crooked in
  their drawn book, showed two books at once or were blurred; those 27 books were taken out (the library has 56 books
  instead of 83) and two swapped spine photos were put right, so the shelf now shows only upright spine photos. (The
  last book of a shelf row leaning against the end is the app's own design.)
- The old v1.1.0 video and its poster are removed from `public/promo/` (new file names carry the new version).

## 1.12.0 – 2026-10-19

### Changed
- **The promo video moved to the top of the landing page.** It now sits right under the brand name ("Ex Libris Video" /
  "by DarwinAI"), so a visitor sees it at once; the headline, the shelf illustration, the Google sign-in and the two ways
  to hand over the shelf follow below it. The heading above the player is gone (its title stays as the section's name for
  assistive tech; the `video.eyebrow` message is removed), the one-line summary is the caption under the player.
- **A new promo video** (v1.1.0, 78 s, 720p, 9.3 MB) replaces the 58-second one: redone from this phone app's new design
  (bottom menu and submenu, search, filters, "books of one recording"), with a larger demo library, the Google sign-in and
  the installable app as features. The caption says "78 seconds" (it said 58).
- The player still costs the first paint almost nothing: only the poster (66 KB, now with a high fetch priority – it is the
  largest thing on screen) is in the first paint; the video file is requested once the page has finished loading and the
  browser is idle, then it plays by itself, muted, as before.

## 1.11.0 – 2026-10-18

### Fixed
- **The app can be installed again.** Next 15.5 streams the page metadata into the `<body>` for ordinary browsers,
  and Chrome only takes the web app manifest from the `<head>` – so the site was not installable at all ("no
  manifest") and no phone ever offered to put it on the home screen. The manifest link and the home-screen tags are
  now written into the `<head>` by hand; checked with Chromium's own installability report: no errors.

### Added
- **"Put it on your home screen" card** on phones (2.5 s after the page): on Android one tap opens the browser's
  install dialog; on iPhone / iPad – where Safari has no install dialog – it shows the two steps (Share → Add to Home
  Screen). Never shown once the app runs installed; "Not now" hides it for two weeks.
- **Offline page**: the installed app shows "No internet connection" with a retry button instead of the browser's
  error screen when a page cannot be loaded (the service worker keeps a copy of `/offline`).
- Manifest: `display_override`, `prefer_related_applications: false` and a "My catalogues" shortcut on the icon's
  long-press menu.
- **Read / not read on the shelf** (phone app submenu): one chip that steps All → Read → Not read → All.

### Changed
- Shelf submenu (phone app): the order is one toggle chip, Author ⇄ Title (no "Order" label, no shelf order); the
  grouping (none / topic / author / status) is gone from the phone app – the read switch takes its place.
- The bottom menu's edge arrows sit at the middle of the bar in the + button's colour, in front of the tabs on a fade
  of the bar's background, so a tab sliding off the screen no longer shows through them.

## 1.10.0 – 2026-10-18

Phone app, after the owner's second round of comments (with screenshots of a new recording being processed).

### Added
- **Books of one recording**: at the right end of the view submenu, in every view, a drop-up list – "All books" by
  default, then every recording newest first with the number of books it brought into the catalogue. Picking one
  (typically the latest scan) shows only those books on the shelf, the cover wall, the authors … (`?scan=` in the
  link, removable chip "Recording: Oct 18 10:25"). A book found again in a later recording stays with the one it
  first came in with.
- **Shelf order in the shelf's submenu**: shelf order / author / title – the books can now be put in A–Z order by
  title on the shelf itself, not only on the cover wall.
- **Edge chevrons** on the bottom menu: a small arrow at the right end (and, once swiped, at the left end) shows that
  more views wait on that side.

### Changed
- **Processing screen order**: on top the whole library with its total book count, set apart as "The whole library"
  (it used to read like the count of the scan running now – starting at 60–90 and then hardly growing); right below
  it the processing running now; then the recordings newest first, so the one just recorded is no longer at the very
  bottom.
- **Two-way settings are one toggle chip** in the submenu (standing ⇄ lying, comfortable ⇄ compact, A–Z ⇄ most books,
  decades ⇄ centuries, table rows): it shows the current choice and switches to the other one when tapped, so the
  strip fits a narrow screen.

## 1.9.0 – 2026-10-15

Phone app catalogue, after the owner's comments on the mobile view.

### Added
- **Lying books** – a second shelf arrangement ("Fektetve"): the books lie on their sides in piles, two piles per
  plank on a phone, the spine turned so the title reads left to right. The planks are only as high as the tallest
  pile. Also offered on the website (more piles per plank there).
- **Re-shelving animation**: whenever a filter, the order or a shelf setting rearranges the books, they all leave
  the shelf in a blink with a puff of dust, then land again one by one, left to right. The cover wall does the same.
  Off with "reduce motion".
- **View submenu** in the phone app: the options of the open view sit in a small bottle-green strip glued on top of
  the bottom menu – shelf: arrangement, grouping, size, real spines; covers and table: order by shelf / author /
  title (the table also its row density); authors: A–Z / most books; timeline: centuries / decades.

### Changed
- **Bottom menu** of a catalogue in the phone app: every view (shelf, covers, authors, table, topics, timeline,
  statistics, frames, review) and "More" are in one strip you swipe sideways; it slides behind the big + button,
  which stays in the middle. "More" keeps filters, adding, settings, export and e-mail; its sort block is gone (the
  order is now chosen in the covers / table submenu).
- **Back button**: from any other view the phone's back button now returns to the shelf first (it used to leave
  the site for the page visited before Ex Libris), and it closes an open sheet (More, Filters, Add). The shelf tab
  goes back to the shelf's own history entry instead of piling up new ones; the same works on the website.
- **Authors** (phone app): no mini shelf any more – just the authors' names with every title listed, nothing to unfold.
- **Topics** (phone app): the chosen topic's books stand on one shelf frozen at the top of the screen (swipe it
  sideways); under it small topic chips, the most common ten first, the rest further down – instead of the large
  percentage tiles. A new topic empties the shelf at once and fills it again from the left, book by book.
- **Timeline** (phones): under the centuries the books lie in piles, two side by side, titles readable – far less
  empty room than the upright spines.

## 1.8.2 – 2026-10-14

### Fixed
- **The placeholder bookcase is as high as the real one – also with the compact density.** After v1.8.1 the ghost
  bookcase (the loading skeleton of `/<id>` and the shelf view's own placeholder) was always drawn at the
  "comfortable" size, but the reader's choice – "compact", kept only in this browser's localStorage – is applied
  once the page is alive. A reader with the compact size therefore saw an empty bookcase 80 px too high that then
  jumped lower while the books appeared. The inline boot script that already applies the saved theme before the first
  paint (`lib/boot-script.ts`, now unit-tested) also copies a compact choice onto `<html data-shelf-density>`; both
  ghosts are drawn in both densities and CSS shows the one that matches, so the ghost has exactly the height of the
  real bookcase from the very first paint. Existing readers get it at once: no cookie, nothing to migrate. The shelf
  view keeps the attribute in step when the reader switches the density, for the next catalogue's skeleton.

## 1.8.1 – 2026-10-14

### Fixed
- **No more 3-shelf flash after signing in.** After the Google sign-in (and on every load of a catalogue) the
  route-level loading skeleton of `/<id>` drew three tall walnut shelves of 38 ghost spines each; a small library
  then arrived as ONE short shelf and the wall of planks collapsed ("pops up, then ends up as one shelf"). The
  v1.6.1 fix had only reached the shelf view's own placeholder. The skeleton is now a ghost of the catalogue page
  laid out like the real one – header, toolbar, view options and ONE plank (the very same `ShelfGhost` the shelf
  view draws until it has measured its width); on a desktop screen it ends within 1 px of where the real shelf
  stands and is as tall as the real page, so neither the shelf nor the footer moves. A bigger library only
  grows downwards.
- A signed-in visitor – who almost always lands on their own library – also gets the ghost of the owner's
  "Tedd fel a könyveidet" block, so the page no longer jumps by its height when the real catalogue arrives (the
  phone app and visitors without an account have no such block, and get no such ghost).
- The skeleton **fades in only after ~160 ms** (`.exl-loading-fade`): a load that finishes quickly – on a hard
  navigation the real page streams in right behind the skeleton – never shows it at all.

## 1.8.0 – 2026-10-14

### Added
- **The brand name once more, large, at the top of the landing page.** "Ex Libris Video" with the bookplate mark
  and "by DarwinAI" (a link to www.darwinai.hu) opens the page like the title card of a book: the mark is stamped
  in, "Ex Libris" rises letter by letter out of a blur, "Video" is written in gold with a glint that runs across it
  now and then, the rules grow out from the credit line. Pure CSS (`.wm-*` in `globals.css`), runs on first
  paint, off with "reduce motion".
- **The promo video under the recording block** ("Egy perc alatt – Így lesz a polcodból katalógus"). Self-hosted
  (`public/promo/`, 720p H.264/AAC, 6.7 MB, `+faststart`; the file names carry the version and are cached
  for a year), no third party, no cookies. It does not slow the page: the first paint holds only a lazy 66 KB
  poster; the file is requested ~800 px before the player scrolls into view and plays at once, muted, when about
  half of it is visible; it pauses when scrolled away or the tab is hidden. "Hang be" turns the sound on, plus
  pause / full screen / a progress line; at the end it stops and offers "Újra". With "reduce motion", the data
  saver or a browser that refuses autoplay the poster waits for a tap. English pages note that the video's text is
  Hungarian.
- **/my: three numbered options.** "1. lehetőség – Ezen az eszközön", "2. – Megnyitás azonosító alapján",
  "3. – Elvesztetted a linket?" are now three twin bookplate cards side by side (stacked on small screens),
  under a centred header and the sign-in card. Heads and bodies line up (subgrid); a long list of catalogues
  scrolls inside its card instead of stretching the row.

### Changed
- **The phone card and the upload card are twins joined by "vagy".** The "record with your phone" (QR code)
  and "upload here" blocks share one look (bookplate card, dashed zone, gold icon, heading, text, action,
  note) – built from the same classes (`upload/zone-chrome.tsx`) – side by side on wide screens with a "vagy /
  or" medallion between them, one under the other with a horizontal "vagy" below `lg`. The sentence "Or upload
  here…" is gone (the divider says it). On a touch screen below `lg` the phone card and the "vagy" are hidden:
  that device already has the camera, and the upload card offers "record" and "pick". While files are listed
  the phone card shrinks to its own height instead of stretching. The zone's layout follows its container
  width, not the window.
- **The sign-in card is centred** on the website (text and the "Javasolt" tag on the middle of the top edge);
  the phone app keeps its left-aligned card.
- The upload card no longer keeps an empty strip under its zone when there is no alert to show.

## 1.7.1 – 2026-10-13

### Added
- **"by DarwinAI" credit.** Ex Libris Video is a project of [DarwinAI](https://www.darwinai.hu): the site header
  wordmark and the top bar of the phone app's home screen carry a small "by DarwinAI" line, and the footer says
  "Az Ex Libris Video a DarwinAI projektje" / "Ex Libris Video is a project of DarwinAI" with a link to
  www.darwinai.hu.

## 1.7.0 – 2026-10-10

### Added
- **Sign in after filming as a guest.** A visitor who films or uploads without signing in gets a link
  catalogue as before; signing in with Google afterwards turns that catalogue – the books of the recording
  – into the new account's library (same id and link, nothing copied). The sign-in link carries the
  catalogue (`claim`); the server adopts it only with the owner cookie as proof, and only for an account that
  has no library yet. The catalogue page (web and phone app, also while it is processing) shows a "Lépj be, hogy
  a könyveid megmaradjanak" card with the sign-in button; the "Belépés" buttons of the home page and the
  header carry the catalogue this device made most recently.
- **"Sign in first?" pop-up.** A guest who starts one of the add actions – film a shelf, upload, book from a
  photo, book by hand (web add block, phone home, phone library "+" and menu) – is told once per browser tab
  what an account gives, and can sign in or carry on without.

### Changed
- **Film right on the website where there is a camera in hand.** On devices with a touch screen (iPad – which
  is a "tablet", not a phone, so it gets the website – and phones on the website) the recording tile of the
  library's add block now starts the in-app camera ("Felvétel indítása"); the clip is uploaded through the
  upload dialog, and "upload an existing video or photos" is the second choice. Mouse-only devices keep the
  single "Feltöltés" button. The tile is titled "Videó vagy fotó" (it no longer says "upload" only).
- The upload zone (landing page, upload dialog) offers "record" / "pick from the gallery" for any touch
  screen (`any-pointer: coarse`) instead of only when the primary pointer is coarse – an iPad with a trackpad
  attached has a camera too.

### Known limit
- An account that already has a library keeps it and the guest catalogue stays a separate link catalogue
  (merging two libraries – files, duplicates – is not built).

## 1.6.1 – 2026-10-10

### Fixed
- Library page: on reload a wall of two or three shelf planks flashed for a moment before the real shelf
  (one plank for a small library) appeared. The placeholder shown until the page is alive is now a ghost
  of the real shelf (same number of planks, same spine sizes and bookends, at most two planks), so a small
  library no longer collapses from a tall placeholder.

## 1.6.0 – 2026-10-10

### Changed
- Library page, owner: the "Hozzáadás" drop-down in the header is replaced by a wide, low block under the
  header that shows all three ways of adding books at once, each with its own start button – upload a
  video or photos (recommended: filled green tile, gilt button), a single book from a photo, a single book
  by hand. Visible straight after the first sign-in, no menu to open. Stacks on phones, three columns from
  tablet width; works in the dark theme.
- Empty / failed catalogue: the owner's duplicate "upload a new video" / "add by hand" buttons are gone
  (the block above covers them); the filming tips stay.

## 1.5.0 – 2026-10-10

### Changed
- Landing page in one column, top to bottom: headline (wide), one long shelf being filmed, Google sign-in
  (centred), then the recording – "open it on your phone and film right away" with a QR code next to the
  uploader for files already on this computer.
- New "quick peek" section: what a finished library looks like (header, views, tags, two full shelves).

## 1.4.0 – 2026-10-10

### Changed
- Phone app, own library: a "+" button in the middle of the bottom bar (record a shelf, video / photos from
  the gallery, book from a photo, book by hand) – there was no way back to these from the catalogue.
- E-mail export only in the export menu; a signed-in owner's library no longer shows the "save your link"
  banner or the "shall we let you know" e-mail card.
- Tags are asked after the upload, on the recording's card (while it is processed), not before it.
- Landing page: headline beside the shelf, then sign-in (recommended) and the link-only uploader side by side.
- Empty library: subtitle "Still empty" instead of "Processing…".

### Fixed
- Phone app: the document could scroll a few pixels, sliding the top bar under the browser's address bar.

### Added
- Installable app (PWA): service worker `/sw.js` (cache name carries version + build id), the install prompt
  is caught at start-up, an install button in the app's top bar.

## 1.3.0 – 2026-10-10

### Added
- **New book from a photo** (owner; add menu, phone app "More" sheet, empty library): photograph the ISBN
  barcode, the front cover or the spine of one book. Barcodes are read on the phone (BarcodeDetector) or on
  the server (own EAN-13 reader, AI reading the digits as a fallback) and looked up in Google Books / Open
  Library (Hungarian name order for Hungarian books); spine and cover photos are read by the AI. The owner
  checks the fields, tags the book and adds it – the cover or spine photo becomes the book's picture – or,
  when the library already has it, counts one more copy. Photo books are enriched (topics, description,
  cover) like recognised ones. Unused photos are purged after a day.
- Privacy notice: Google sign-in data, single-book photos, the session cookies.

## 1.2.0 – 2026-10-10

### Added
- **Tags for recordings**: before uploading (web uploader, phone app right after recording) the owner can
  tag the recording – whose shelf, which room, a genre; earlier tags are offered as one-tap chips and a short
  hint explains what tags are for. Every book found in the recording gets its tags (new and already known
  books, named unread spines too). Tags can be changed later per recording in the frames view; removed tags
  leave its books unless another recording of the book still has them.
- **Filter by tag** (filters panel, active filter chips, `?tag=` in the URL); tags on the book card filter
  with one tap; Excel and CSV exports have a Tags column.

## 1.1.0 – 2026-10-10

### Added
- **Sign in with Google** (OAuth 2.0 + PKCE, OpenID Connect). A signed-in user has exactly one library: it
  is created at the first sign-in, the home page opens it, and every new recording or book is added to it.
  Owner rights come from the sign-in session on any device. Link-only catalogues (secret owner link) keep
  working as plan B. Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; without them the sign-in is hidden.
- **Duplicate questions across recordings**: a new recording that finds a book already in the catalogue
  somewhere else (not the same shelf filmed again) asks the owner in the review – same book, another copy,
  or a different book. Re-filmed shelves are still merged silently.
- **Copies**: books have a number of copies (book card stepper, `×N` in the facts, exports: Excel, CSV,
  JSON).
- Versioning: `CHANGELOG.md`, version + build id in the footer, app settings, `/api/health` and the worker
  start log.

## 1.0.0 – 2026-09-17

First public version: shelf video → catalogue (spine recognition, merge, enrichment, covers), collection
views (shelf, covers, table, authors, topics, timeline, stats, frames, review), owner editing via secret
link, exports, e-mail, phone app mode with in-app camera, unread spine review.
