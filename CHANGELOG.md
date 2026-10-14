# Changelog

All notable changes of Ex Libris Video. Versions follow semantic versioning; the version lives in
`package.json` and is shown in the site footer and the app settings next to a short build id (content hash
of the sources, see `next.config.ts`). `GET /api/health` reports both.

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
