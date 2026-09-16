# Ex Libris Video — build specification

> A user films their bookshelf (slow pan over the spines), uploads the video(s), and gets a
> catalogue of their books (author – title) at a short link like `https://www.exlibrisvideo.hu/334345435`
> with many beautiful views, editing, exports (Excel, CSV, PDF, JSON, Goodreads CSV) and an
> optional e-mail with the Excel attached. Hungarian + English UI.

This file is the **contract** for everyone working on the codebase. Read it fully before coding.

---

## 1. Stack & runtime

| Concern | Choice |
|---|---|
| Web | Next.js **15.5** App Router, React 19, TypeScript strict, Tailwind CSS 4 (`src/app/globals.css` tokens) |
| DB | PostgreSQL 16, Drizzle ORM (`src/db/schema.ts`), SQL migrations in `./drizzle` (drizzle-kit) |
| Worker | Same repo, `npm run worker` (tsx `src/worker/index.ts`), Postgres job queue (`jobs` table, `FOR UPDATE SKIP LOCKED`) |
| Video | `ffprobe` / `ffmpeg` binaries (in the Docker image), `sharp` for image ops |
| AI | Provider abstraction `src/lib/ai/*`: **anthropic** (`claude-opus-5`, vision + text, default when `ANTHROPIC_API_KEY` set), **deepseek** (`deepseek-flash` via OpenAI-compatible HTTP, accepts images; use `thinking: {type:"disabled"}` + `response_format: {type:"json_object"}`), **mock** (fixtures; used when no key or `AI_MOCK=true`) |
| Enrichment | Open Library search + covers (no key), Google Books (optional key) |
| Export | `exceljs` (xlsx), hand-written CSV (UTF-8 BOM, `;` for hu / `,` for en), `pdfkit` with embedded Noto fonts from `@fontsource/noto-serif` / `noto-sans` (need ő ű glyphs) |
| E-mail | `nodemailer` SMTP, or Resend HTTP API via `fetch`, or `console` (dev). `EMAIL_PROVIDER` |
| Icons / motion | `lucide-react`, `motion` (`import { motion } from 'motion/react'`) |
| Tests | `vitest` (`*.test.ts` next to the module) |
| Deploy | Docker image (node:22-bookworm-slim + ffmpeg), Coolify on Hetzner: Postgres resource + `web` app + `worker` app sharing a **Directory** bind mount at `/app/storage` |

**Installed dependencies are final.** Do not add npm packages. If you believe one is indispensable, stop and report it instead.

Environment: see `src/lib/env.ts` (single source of truth) and `.env.example`. Always read config through `env()`.

---

## 2. Concepts & lifecycle

```
Landing (/) ──create──► collection (draft) ──upload 1..N videos/photos (chunked)──► processing
      │                                                                              │ worker: per source
      │                                                                              ▼
      │                  probe → frames → vision → merge → crops   (per video, progress 0..100)
      │                                                                              │ all sources done
      │                                                                              ▼
      │                               enrich_collection (classify topics, canonical names, years, covers)
      │                                                                              ▼
      └──────────── /<id> shows live progress, then the catalogue ◄── status ready ── finalize (+ e-mail)
```

* **Collection id**: random 9-digit string, first digit 1-9 (`100000000`–`999999999`), unique. It is the public URL path.
* **Owner token**: 32 bytes random base64url, only its sha256 (`ownerTokenHash`) is stored. The owner link is `/<id>?k=<token>`; opening it calls the claim endpoint which sets the httpOnly cookie `exl_own_<id>` and the page strips `k` from the URL. The creating browser also stores `{id, token, title, createdAt}` in `localStorage["exl_my_collections"]` (see `src/lib/client/my-collections.ts`).
* **Owner cookie value** = base64url(HMAC-SHA256(`APP_SECRET`, `"own:" + id + ":" + ownerTokenHash`)) — verified by recomputation (constant-time). The raw token never sits in a cookie.
* **Recovery claim link** `/<id>?r=<expUnixSeconds>.<sig>`, sig = base64url(HMAC-SHA256(`APP_SECRET`, `"rec:" + id + ":" + exp + ":" + ownerTokenHash`)); `POST /claim` accepts `{ token }` or `{ recovery }` and sets the owner cookie. The page handles `?r=` exactly like `?k=`.
* **Visibility**: `link` (anyone with the URL can view – default) or `pin` (viewer must enter a 4–8 digit PIN; success sets cookie `exl_pin_<id>` = base64url(HMAC-SHA256(`APP_SECRET`, `"pin:" + id + ":" + pinHash`))). Owners always have access. Changing the PIN invalidates PIN cookies automatically.
* **Owner-only data**: `notes`, `lentTo`, `lentAt`, `email` are returned as `null` to non-owners. Non-owners cannot mutate anything.
* **Cookies**: `Secure` flag must be derived from the request protocol (`x-forwarded-proto` header or URL protocol === 'https'), **never** from `NODE_ENV` (Coolify is reached over plain HTTP before SSL exists). `SameSite=Lax`, `Path=/`, 400-day max-age for owner cookies.
* Collection `status`: `draft` (created, no completed upload) → `processing` (≥1 source queued/processing or enrichment running) → `ready`; `error` only if every source failed.
* Adding more videos to a `ready` collection moves it back to `processing`; merge dedupes against existing books.

---

## 3. HTTP API (Route Handlers under `src/app/api`)

All JSON. Errors: HTTP status + `ApiError` body `{ error, code }` (`src/lib/types.ts`), codes: `invalid`, `not_found`, `forbidden`, `needs_pin`, `rate_limited`, `too_large`, `conflict`, `unsupported`, `internal`. Error `error` text is localized via `errors.<code>` keys (locale from `?lang`, cookie, Accept-Language — `localeFromRequest`).
Validate every body with zod. Owner-only endpoints return 403 `forbidden` without a valid owner cookie **or** an `Authorization: Bearer <ownerToken>` header.

| Method & path | Who | Body / query | Response |
|---|---|---|---|
| `POST /api/collections` | anyone (rate: `RATE_COLLECTIONS_PER_IP_DAY`) | `{ title?, email?, ownerName?, locale }` | `201 CreateCollectionResponse` + sets owner cookie |
| `GET /api/collections/:id` | viewer | – | `CollectionWithBooksDTO` (403 `needs_pin`) ; increments `view_count` at most once per 30 min per viewer cookie |
| `PATCH /api/collections/:id` | owner | `CollectionPatch` | `CollectionDTO` |
| `DELETE /api/collections/:id` | owner | – | `204`; deletes DB rows (cascade) + all files |
| `POST /api/collections/:id/claim` | anyone with token or recovery sig | `{ token } \| { recovery }` | `200 { ok: true }` + owner cookie; 403 on wrong/expired (constant-time compare; rate 20/10 min per IP) |
| `POST /api/collections/:id/unlock` | anyone | `{ pin }` | `200` + `exl_pin_<id>` cookie; rate-limited 10/10 min per IP+id |
| `GET /api/collections/:id/status` | viewer | – | `CollectionStatusDTO` (cheap; polled every 2 s) |
| `POST /api/collections/:id/uploads` | owner (rate `RATE_UPLOADS_PER_IP_HOUR`) | `{ filename, size, mimeType }` | `201 InitUploadResponse`; checks size ≤ `MAX_UPLOAD_MB`, mime `video/*` or `image/jpeg|png|webp`, sources ≤ `MAX_SOURCES_PER_COLLECTION` |
| `GET /api/uploads/:videoId` | owner | – | `{ bytesReceived, sizeBytes, uploadStatus }` (resume) |
| `PUT /api/uploads/:videoId?offset=<n>` | owner | raw bytes (`application/octet-stream`, ≤ `UPLOAD_CHUNK_MB`) | `{ bytesReceived }`. If `offset !== bytesReceived` → `409 conflict` with `details: { bytesReceived }` (client re-syncs). Append-only write, streamed to disk. |
| `POST /api/uploads/:videoId/complete` | owner | – | `{ video: VideoDTO }`; verifies size, sniffs magic bytes, sets `uploaded`, `status=queued`, enqueues `process_video`, collection → `processing` |
| `DELETE /api/uploads/:videoId` | owner | – | `204` removes a source (and its frames/detections; books whose only evidence was this source are deleted) |
| `POST /api/collections/:id/books` | owner | `BookPatch & { title: string }` | `201 BookDTO` (`source='manual'`) |
| `PATCH /api/books/:bookId` | owner | `BookPatch` | `BookDTO` (recompute `authorSort`/`titleSort` when author/title change) |
| `DELETE /api/books/:bookId` | owner | – | `204` |
| `POST /api/collections/:id/books/merge` | owner | `{ keepId, mergeIds: string[] }` | `BookDTO` (moves detections, sums `detectionCount`, keeps best spine) |
| `POST /api/collections/:id/unread-spines/:spineId` | owner | `{ title, author? }` | `201 BookDTO` – the book on an unread spine: reviewed, `source` of its video, spine photo + frame + an `owner` detection as evidence, shelf position halfway between the recognised neighbours in that frame; enrichment queued 1 min later; the unread spine is deleted |
| `DELETE /api/collections/:id/unread-spines/:spineId` | owner | – | `204` (not a book / already in the catalogue: row and photo deleted) |
| `GET /api/collections/:id/frames` | viewer | – | `{ frames: FrameDTO[], detections: {frameId, bookId, bbox}[] }` |
| `GET /api/collections/:id/export?format=xlsx\|csv\|json\|pdf\|goodreads&lang=hu\|en` | viewer | – | file download (`Content-Disposition: attachment; filename*=UTF-8''exlibris-<id>.<ext>`) |
| `POST /api/collections/:id/email` | owner (rate `RATE_EMAILS_PER_COLLECTION_DAY`) | `{ email?, formats?: ExportFormat[] }` (default `['xlsx','pdf']`) | `202 { queued: true }`; saves e-mail if given, enqueues `send_email` kind `export` |
| `POST /api/recover` | anyone (rate 3/hour per IP and per e-mail) | `{ email }` | always `202` (no enumeration). Enqueues `send_email` kind `recover_links`, which mails, for every collection with that e-mail, a **24-hour signed claim link** `/<id>?r=<exp>.<sig>` (see cookies below). No token rotation (so strangers cannot break the owner's links). |
| `GET /api/media/<relative path>` | viewer of the collection encoded in the path (2nd segment) | – | streams the file with correct `Content-Type`, `Cache-Control: private, max-age=86400`; path traversal safe via `abs()` |
| `GET /api/health` | anyone | – | `{ ok, db: boolean, version }` |
| `GET /api/admin/overview` | `Authorization: Basic admin:<ADMIN_PASSWORD>` | – | counts, recent collections, failed jobs, AI usage totals |

**Rate limiting**: `src/lib/rate-limit.ts` — fixed window counter in `rate_limits` table (`INSERT … ON CONFLICT DO UPDATE`), client IP from `x-forwarded-for` first hop, then `x-real-ip`.

---

## 4. Video → books pipeline (worker)

Implemented in `src/worker/*` + `src/lib/pipeline/*` + `src/lib/ai/*`.

### 4.1 probe
`ffprobe -v error -print_format json -show_format -show_streams`. Reject > `MAX_VIDEO_SECONDS`. Record duration, displayed width/height (**apply rotation**: `side_data_list[].rotation` or `tags.rotate` ±90 → swap w/h). Images skip to 4.3 as a single frame (auto-orient with `sharp().rotate()`).

### 4.2 frames (key-frame selection)
1. Extract candidates with ffmpeg at `FRAME_SAMPLE_FPS` (default 4) scaled so the long edge ≤ `FRAME_MAX_EDGE` (default 1920 — Claude Opus 5 reads up to 2576 px natively, spine text needs resolution): `ffmpeg -i in -vf "fps=4,scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'" -q:v 2 tmp/%05d.jpg` (ffmpeg auto-rotates).
2. Sharpness score per candidate: grayscale, downscale to 640 px long edge, Laplacian kernel convolution with `sharp`, variance of the result.
3. Group candidates into windows of `W = max(1, round(FRAME_SAMPLE_FPS * KEYFRAME_WINDOW_SEC))` consecutive frames (defaults 8 fps × 0.33 s → ~3 key frames/s); keep the sharpest of each window (discard motion blur). *Ground-truth finding: at a fixed 2 fps grid thin spines in fast pans (700–1000 px/s) appear in only one blurred frame; decoding ≥ 6 fps and keeping the sharpest per ~0.3 s fixes most of them.* When the camera pans fast inside a window (the column profiles of the sharpest candidates of its two halves are ≥ 12 % of the width apart), both are kept, so neighbouring key frames overlap enough for spine tracking (§4.3a).
4. Redundancy filter: 16×9 (or 9×16) grayscale "dHash"-like thumbnail; drop a kept frame whose mean absolute difference to the previously kept frame is below a small threshold (camera not moving) — **but** always keep at least one frame every 2 s.
5. If more than `MAX_FRAMES_PER_VIDEO` remain, sample uniformly (keep first & last). Store to `frames/…`, thumbnails 480 px, insert `frames` rows, `framesTotal`.
The ground-truth fixture (§8) tells how many frames each book is visible in; defaults were chosen so every book appears in ≥ 2 analysed frames at normal pan speed.

### 4.3a spine recognition (default: `SPINE_RECOGNITION=auto`)
`src/lib/pipeline/spines/*`. Reading whole frames made one physical book turn into several (every frame was read a little differently, authors slipped over from the neighbouring spine, model boxes were a spine off). Instead every spine is found geometrically, cut out and read on its own:
1. **Geometry per frame** (`bands.ts`, `boundaries.ts`): shelf bands = rows dense in near-vertical edges (slivers of other shelves cut by the frame edge are dropped); spine boundaries = long straight edges found by an angle sweep (±24°, per-boundary tilt).
2. **Camera motion** (`motion.ts`): normalised cross-correlation of the band's column colour profiles (robust to vertical shake and blur), refined into `x_k = s·x_{k-1} + d` with matching boundaries (s = walking closer); vertical shift from row profiles. Unreliable steps break the tracks.
3. **Tracking** (`tracking.ts`): bands chain frame to frame; boundaries join tracks in chain reference coordinates; a track counts when detected in ≥ 45 % of the frames showing its place. Neighbouring tracks = one physical spine; its views are the frames that detected both of its boundaries.
4. **Reading** (`recognize.ts`, `strips.ts`): the sharpest 1–2 views per spine are cut upright (rotated rectangle) and sent as a picture of the spine turned both ways (+ standing, for wide spines), ≤ `SPINE_BATCH_IMAGES` pictures per request. Provider method `readSpineImages` → `{ id, part, status: book|illegible|not_book, author, title, canonical_*, publisher, confidence }` per spine.
5. **Repairs**: illegible spines are read again from other frames; runs of illegible slices are read as one spine (close-ups, letter edges); a spine read as several books is cut at its gaps (`splitPositions`) and the pieces are read left to right; spines labelled "wide" hint at missed gaps; uncertain single readings (< 0.8) are read again independently — confirmed (+0.1), disputed (kept at 0.5 → review) or dropped (guess < 0.6 that the second reading could not see).
6. **Unread spines** (`pickUnreadSpines`, table `unread_spines`): spines that stay illegible, whose request failed, that only show an author, or whose guess was dropped are saved for the owner with their upright photo (`spines/<id>/unread/<uuid>.jpg`), frame + `bbox.rect`, the legible author / dropped guess and their shelf order. Not-book pictures, absorbed slices and slivers (< 35 % of the shelf's median spine, nothing legible) are skipped; a failed run of slices about one spine wide is saved once, as the joined picture. ≤ 60 per video; rebuilt when the video is analysed again, deleted with the source.
7. **Detections**: one row per (spine, frame that shows it) with the exact tilted rectangle in `bbox.rect` and the left→right `orderInFrame`, so the unchanged merge (§4.4) clusters them; neighbouring spines with the same reading (a false boundary) keep only the stronger one. Crops (§4.5) cut `bbox.rect` upright.
Falls back to §4.3 when the provider has no `readSpineImages` (mock) or no spine is found.

### 4.3 vision (spine reading, whole frames)
* Consecutive frames in batches of `VISION_BATCH_SIZE` (default 4) with **1 frame overlap** between batches, `VISION_CONCURRENCY` batches in parallel. Update `framesAnalyzed` / `progress` after each batch.
* Prompt (system, stable → cacheable): the frames are consecutive views of ONE shelf pan; list every book spine whose author or title is at least partly legible; one entry per (frame, spine) observation, **left→right order within the frame**; transcribe exactly as printed (keep Hungarian accents; the model may fix obvious OCR-like mistakes only when the book is recognisable, e.g. "Esterhazy Peter" → "Esterházy Péter"); `author` null when not printed; put publisher/series marks in `publisher`, never in the title; `confidence` 0..1 (legibility); `bbox` = axis-aligned box around that spine **in pixel coordinates of that frame** (the frame width/height are stated in the text block before each image); also `canonical_author` / `canonical_title` if the model knows the book with high confidence (else null). Never invent spines that are not visible.
* Output schema (zod, shared by providers) `SpineObservation[]`:
  `{ frame: number /*1-based within batch*/, order: number, author: string|null, title: string, canonical_author: string|null, canonical_title: string|null, publisher: string|null, confidence: number, bbox: {x0,y0,x1,y1}|null }`
* **anthropic**: `client.messages.parse` with `output_config: { format: zodOutputFormat(schema), effort: ANTHROPIC_VISION_EFFORT }`, `thinking: {type:'adaptive'}`, `max_tokens` 16000, beta fallbacks per claude-api guidance (`client.beta.messages…` with `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'` — if the parse helper cannot be combined with the beta surface, prefer plain `client.messages.parse` and handle `stop_reason === 'refusal'` by skipping the batch with a logged warning). Images as base64 JPEG content blocks, each preceded by a text block `Frame k — W×H px`. Check `stop_reason` before reading output. Record `usage` into `collections.usage`.
* **deepseek**: `POST {DEEPSEEK_BASE_URL}/chat/completions`, `model: DEEPSEEK_VISION_MODEL`, `response_format: {type:'json_object'}`, `thinking: {type:'disabled'}`, `max_tokens: 8000`, content parts `{type:'image_url', image_url:{url:'data:image/jpeg;base64,…'}}`; the JSON schema is described in the prompt; validate with zod, retry once on invalid JSON. DeepSeek downsamples heavily → bboxes are approximate (still clamp to frame).
* **mock**: returns observations from the fixture (§8) for known sample videos (matched by original filename or sha1 of first 4 MiB), otherwise a deterministic small demo list; bboxes synthesised as vertical strips.
* Each observation → `detections` row (frameId, raw fields, bbox clamped to frame).

### 4.4 merge (dedupe into books)
`src/lib/pipeline/merge.ts` — pure functions + unit tests.
1. Normalise: lower-case, fold accents (NFD, strip `\p{M}`; keep ő/ű→o/u), collapse whitespace, strip punctuation and leading articles for comparison only (`a`, `az`, `the`, `der`, `die`, `das`, `le`, `la`).
2. Cluster observations **within the video** in shelf order: two observations are the same book if title similarity ≥ 0.85 (normalised Levenshtein ratio or token-set ratio, whichever higher) AND authors compatible (either missing, or surname similarity ≥ 0.8); adjacency in shelf order is a strong prior (same `order` neighbourhood in overlapping frames).
3. Match clusters against **existing books of the collection** with the same rule (another video may show the same shelf again).
4. For each cluster pick display values: prefer `canonical_*` when ≥ 2 observations agree or confidence ≥ 0.8; else the most frequent spine reading weighted by confidence. `confidence` = max observation confidence, boosted +0.1 when seen in ≥ 2 frames (cap 1). `needsReview` = confidence < 0.6 or title < 3 chars or conflicting readings.
5. Optional LLM tidy pass (text provider) over the **new** books of this video only when there are suspicious near-duplicates (similarity 0.6–0.85): ask whether pairs are the same book; merge if yes.
6. `shelfPosition = video.sortOrder * 100000 + clusterIndex`. `firstTimeSec`, `bestFrameId`, `bestBbox` from the highest-confidence observation with a bbox. `authorSort` = family name first (Hungarian names are already family-first: detect by `language==='hu'` or Hungarian given-name list heuristic; Western names: last token first), folded lower-case.

### 4.5 crops
For each new/updated book with `bestBbox`: expand bbox 6 % each side, clamp, `sharp(frame).extract()`; if the spine is horizontal-text-vertical (h > w) keep as is; resize to max 900 px long edge, JPEG q82 → `spines/<cid>/<bookId>.jpg`. `spineColor` = dominant colour of the crop (sharp `stats().dominant`).

### 4.6 enrich_collection (after all sources of the collection finished)
1. **Classify** (text provider, batches of 40 books, JSON): for each book → `category` (one taxonomy key, `src/lib/taxonomy.ts`), `topics` (0–3 more keys), canonical `author` (full name) when confident, `originalTitle`, `language`, `originalLanguage`, `authorCountry`, `firstPublishedYear`, `descriptionHu`, `descriptionEn` (≤ 200 chars, factual, null if unknown — never invent). Keys outside the taxonomy → `other`.
2. **Covers** (`ENRICH_COVERS`): Open Library `https://openlibrary.org/search.json?title=…&author=…&limit=3&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,language` (User-Agent `ExLibrisVideo/1.0 (contact e-mail)`; ≤ 3 req/s) → `https://covers.openlibrary.org/b/id/<cover_i>-L.jpg`; fallback Google Books `https://www.googleapis.com/books/v1/volumes?q=intitle:…+inauthor:…&maxResults=3` (`imageLinks.thumbnail`, force https). Accept a match only if normalised title similarity ≥ 0.8 and author compatible. Download the image (≤ 2 MB, image/*) to `covers/…`. Never overwrite user-edited fields.
3. Set `enrichedAt`, then `finalize_collection`.

### 4.7 finalize_collection
Recompute collection `status` (`ready` if ≥1 source done), delete source files if `DELETE_SOURCE_AFTER_PROCESSING`, and if `email` is set and `emailSentAt` is null → enqueue `send_email` kind `collection_ready` (links + xlsx attachment).

### 4.8 Job queue & worker
`src/lib/jobs/queue.ts`: `enqueueJob(type, payload, { runAt?, maxAttempts?, dedupeKey? })`; worker loop picks with `UPDATE jobs SET status='running', locked_at=now(), locked_by=$worker, attempts=attempts+1 WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at<=now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`. Failure → `queued` with exponential back-off (30 s × 4^attempt) until `maxAttempts`, then `failed` (+ mark the video `error` with a friendly message). On start, reset `running` jobs locked > 30 min ago. `WORKER_CONCURRENCY` parallel jobs. Graceful SIGTERM. Hourly `cleanup` job: purge drafts older than `DRAFT_RETENTION_DAYS` with no sources, stale `uploading` sources > 24 h, `exports/` temp files > 1 day, old `rate_limits` rows. The worker runs migrations at start (advisory lock, `runMigrations()`); the web container also runs them at boot via `src/instrumentation.ts`.

---

## 5. Pages & UX

Global: `SiteHeader` (logo mark = stylised bookplate, nav: Új katalógus, Kollekcióim, Minta könyvtár; language switch HU/EN; theme toggle light/dark/system), `SiteFooter`. Mobile-first: most uploads come from phones. All text via i18n. Accessible (labels, focus, keyboard, `prefers-reduced-motion`).

### 5.1 `/` Landing + create
* Hero: headline, one-sentence promise, big "Töltsd fel a polcvideódat" drop zone (the uploader itself, not a link), animated mini bookshelf illustration (pure CSS/SVG spines sliding in).
* On first file drop: creates the collection (`POST /api/collections`), stores owner token locally, starts chunked uploads of all selected files (parallel 2, resumable, progress per file, cancel/remove), optional fields: collection title, name, **e-mail** ("küldjük el Excelben is"), then "Feldolgozás indítása" → navigates to `/<id>` (processing view). Uploads keep going on that page (the upload manager lives in a client store that survives client-side navigation; warn `beforeunload` while uploading).
* Sections: How it works (3 steps), **Filming tips** (good light, 20–40 cm from the shelf, slow steady pan ~ one book-width per ½ s, one shelf row per clip or a slow zig-zag, hold the phone so spines are upright, avoid glare; several short clips are fine), what you get (views preview), privacy note (source video deleted after processing), FAQ, demo collection link (`NEXT_PUBLIC_DEMO_COLLECTION_ID` env, optional).

### 5.2 `/<id>` Collection page
* Server component loads via `src/lib/collections/queries.ts`. 404 page for unknown ids (with "find by id" box). PIN gate for `pin` collections.
* `?k=` → client calls claim, stores token in my-collections, strips the param.
* **Processing state** (`status` draft/processing): live panel polling `/status` every 2 s: per source card (thumbnail icon, name, stage stepper probe→frames→vision→merge→crops, progress bar, frames analysed, books found so far), overall progress, "books appearing" ticker (poll collection every 5 s and animate newly found spines onto a shelf), owner can add more videos (same uploader component), e-mail capture if not given, share link + QR shown immediately ("this link will show your library").
* **Ready state**: header with title (inline-editable for owner), counts (books, authors, topics), owner banner (owner link copy + "save this link" hint, e-mail export button, settings), toolbar: search (accent-insensitive over title/author/series/publisher), filter chips (topic, reading status, needs review, favourites, lent out), sort (shelf order, author, title, year, recently added, rating), **view switcher** with URL `?view=`:
  1. `shelf` — **virtual bookshelf** (default): wooden shelves (CSS gradients + subtle grain), books as spines sized by title length / pageCount, coloured by `spineColor` (or deterministic palette by author hash), vertical title + author text, real spine photo shown on hover/focus as a texture option ("Valódi gerincek" toggle shows `spineImage` crops), hover pulls the book out (translate + shadow), click opens the book drawer; shelves wrap responsively; a small brass label per shelf when grouped (group by: none / topic / author initial).
  2. `covers` — cover wall: `coverImage` or generated typographic cover (colour from spineColor, title in Fraunces, author small caps, topic icon); masonry-ish grid; hover flip shows description.
  3. `table` — dense sortable table (columns configurable), inline edit for owner (title, author, status, rating), multi-select → delete / merge / set status / set topic; sticky header; CSV-like density toggle.
  4. `authors` — A–Z index rail, author cards with count, country flag emoji, mini spines of their books; click filters.
  5. `topics` — topic groups (taxonomy groups) with coloured tiles sized by count (treemap-ish CSS grid), each expands to its books.
  6. `timeline` — first-published year axis (century → decade buckets), books stacked as spines; "unknown year" tray.
  7. `stats` — dashboard: totals, top authors bar chart, category donut (SVG), languages & original languages, author countries, decades histogram, reading status progress ring, fun facts (oldest book, longest title, most common first word, estimated shelf length = books × 2.5 cm, estimated pages), "Mit olvassak ma?" random unread pick with a shuffle animation.
  8. `frames` — "how we saw it": frame thumbnails per source; clicking a frame shows it large with bbox overlays labelled by book; click an overlay opens the book. Great for trust & corrections.
  9. `review` (owner only, badge = books to review + unread spines) — two modes (segmented control, shown when unread spines exist): **uncertain books** – card-by-card review of `needsReview` books: spine crop large, editable author/title, buttons Accept (✓ reviewed), Fix & accept, Delete, Merge with… (search), keyboard shortcuts (Enter accept, Del delete, ←/→); **unreadable spines** – card per unread spine (`CollectionWithBooksDTO.unreadSpines`, owner only): readable spine strip, the frame with the spine boxed, author (prefilled when legible) / title form with the unconfirmed guess offered as a chip and a live "already in the catalogue" warning; Add (Enter), Discard (Del), Later (→). A catalogue whose only results are unread spines opens this review instead of the empty state.
* **Book drawer** (all views): spine photo, cover, title/author/original title, year, publisher, topics chips, description (locale), evidence (frame thumbnail at `firstTimeSec` + confidence meter), owner fields: reading status segmented control, 5-star rating, favourite heart, notes, lent to/at; edit / delete; prev/next navigation.
* **Share**: copy link, native share, QR code (qrcode → SVG), OG image (`src/app/[id]/opengraph-image.tsx` via `next/og`: shelf of first ~30 spine colours + title + count).
* **Export menu**: xlsx, csv, pdf (printable catalogue), json, Goodreads CSV; "send by e-mail" (owner). `print` stylesheet for the page as well.
* **Settings** (owner, dialog): title, description, owner name, e-mail, language of e-mails, visibility (link / PIN), delete collection (type the id to confirm).
* Owner can **add a book manually** and **add more videos** from the page.

### 5.3 other pages
* `/my` — collections stored in this browser (title, count, created; open, open-as-owner, remove from list), "open by id" field, **recover links by e-mail** form.
* `/privacy`, `/terms` — localized, plain, GDPR-friendly (data stored in the EU on Hetzner, source videos deleted after processing, AI providers used for recognition, deletion anytime, contact).
* `not-found.tsx`, `error.tsx`, loading skeletons.

---

## 6. Module map & ownership

Contract files (foundation — **do not change semantics**; additive changes only if coordinated): `src/db/schema.ts`, `src/lib/types.ts`, `src/lib/env.ts`, `src/lib/taxonomy.ts`, `src/lib/storage.ts`, `src/i18n/index.ts|server.ts|client.tsx|define.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/client/api.ts`, `src/lib/client/my-collections.ts`, the signature stubs listed below.

Signature stubs (files whose header says `STUB – owner: X`) exist so everybody typechecks from day one. The owning module **replaces the stub body** keeping the exported signatures (it may add exports and new files in its own directories).

| Owner | Owns (create anything inside) | Stubs to implement | i18n areas |
|---|---|---|---|
| **pipeline** | `src/worker/**`, `src/lib/jobs/**`, `src/lib/pipeline/{probe,frames,sharpness,vision-step,crops,finalize,cleanup,process-video}.ts` (+ tests) | `src/lib/jobs/queue.ts` | – |
| **merge-enrich** | `src/lib/pipeline/{text,merge,enrich,covers}.ts` (+ tests) | `text.ts`, `merge.ts`, `enrich.ts` | – |
| **ai** | `src/lib/ai/**`, `scripts/eval-recognition.ts` | `src/lib/ai/index.ts`, `src/lib/ai/usage.ts` (`types.ts` is complete) | – |
| **api** | `src/app/api/**`, `src/lib/collections/**`, `src/lib/security/**`, `src/lib/rate-limit.ts`, `src/lib/http.ts` | `access.ts`, `dto.ts`, `queries.ts` | `errors` |
| **export-email** | `src/lib/export/**`, `src/lib/email/**` | `export/index.ts`, `email/index.ts` | `exporting`, `email` |
| **ui-kit** | `src/components/ui/**`, `src/components/site/**`, `src/components/books/**` (BookSpine, BookCover, TopicChip, CountryFlag…), `src/lib/book-utils.ts` | `SiteHeader.tsx`, `SiteFooter.tsx` | `common` (additive) |
| **frontend-landing** | `src/app/page.tsx`, `src/components/landing/**`, `src/components/upload/**`, `src/components/processing/**`, `src/lib/client/upload-store.ts`, `src/app/my/**`, `src/app/privacy/**`, `src/app/terms/**`, `src/app/not-found.tsx`, `src/app/error.tsx` | `page.tsx`, `Uploader.tsx`, `ProcessingPanel.tsx` | `landing`, `upload`, `processing`, `legal`, `my` |
| **collection-shell** | `src/app/[id]/**`, `src/components/collection/**` (CollectionProvider, header, toolbar, filters, view switcher, share/QR, export menu, settings, PIN gate, owner banner) | – (implements the Provider for `context.ts`) | `collection` |
| **views-visual** | `src/components/views/{Shelf,Covers,Timeline,Frames}View.tsx`, `src/components/views/visual/**` | those 4 view files | `visual` |
| **views-data** | `src/components/views/{Table,Authors,Topics,Stats}View.tsx`, `src/components/views/data/**` | those 4 view files | `data` |
| **book-ux** | `src/components/book/**`, `src/components/views/ReviewView.tsx` | `BookDrawer.tsx`, `ReviewView.tsx` | `book` |
| **devops** | `Dockerfile`, `docker-compose.yml`, `COOLIFY.md`, `README.md`, `src/instrumentation.ts`, `scripts/*.ps1|*.sh` | – | – |

Cross-module call contracts: pipeline calls `mergeVideoDetections(videoId)` → then crops for the returned ids; after all sources of a collection are done it calls `enrichCollection(collectionId, onProgress)` then finalize. The vision step calls `getVisionProvider().readSpines()` and `recordUsage()`. The API calls `authorSortKey`/`titleSortKey` from `text.ts` when a title/author changes, `enqueueJob` for uploads/e-mails, `buildExport` for downloads. The worker calls `handleSendEmailJob` for `send_email` jobs.

i18n: each area file in `src/i18n/messages/<area>.ts` has exactly one owner (see the file header). Hungarian is the source language, English must be complete and natural. Keep keys flat (`"filter.topic"`).

---

## 7. Conventions

* TypeScript strict, no `any` unless justified in a comment. ESM. Path alias `@/` → `src/`.
* Server code must not import client components; client components (`'use client'`) must not import `@/db`, `@/lib/env`, `node:*`.
* Route handlers: `export const runtime = 'nodejs'`; `export const dynamic = 'force-dynamic'` where data is per request. Next 15: `params` is a Promise (`{ params }: { params: Promise<{ id: string }> }`).
* DB access only through `db()` from `@/db`. Use transactions for multi-row mutations.
* Every mutation route re-checks ownership server-side. Never trust client-provided collection ids for books — look the book up and compare its `collectionId`.
* No secrets in logs. `AIApi.txt` in the repo root is a local secret file: never read it from app code, never commit it.
* Logging: `console.info('[area] message', {…})` single line.
* Styling: Tailwind utilities with the semantic tokens; shared primitives from `src/components/ui/*` (Button, IconButton, Card, Badge, Chip, Input, Textarea, Select, Switch, SegmentedControl, Dialog, Drawer, Tabs, Tooltip, ProgressBar, Spinner, Skeleton, EmptyState, Toast via `useToast`, StarRating, CopyField, QrCode, LanguageSwitch, ThemeToggle, DropdownMenu). Do not hand-roll a second button style.
* Motion: subtle, 150–300 ms, spring for the shelf pull-out; respect reduced motion.
* Numbers/dates via the i18n `n()` / `d()` helpers.

---

## 7b. Local development environment (already set up)

* PostgreSQL 16 runs in Docker container `exlibris-pg` on `localhost:5432` (db `exlibris`, user/pass `postgres`); migration `drizzle/0000_init.sql` is applied. After changing `schema.ts` run `npm run db:generate` (only the foundation does this).
* `.env.local` (gitignored) contains `DATABASE_URL`, `STORAGE_DIR=./storage`, `DEEPSEEK_API_KEY` (a real key – vision works with `deepseek-flash`), `EMAIL_PROVIDER=console`. There is **no** Anthropic key locally: the anthropic provider must compile and follow the SDK docs but cannot be exercised live.
* Next.js loads `.env.local` automatically. The worker (tsx) must load it itself at startup: `for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)` **before** anything reads `env()`.
* `ffmpeg`/`ffprobe` are on PATH (Windows dev machine; production is Debian). Use `child_process.spawn` with argument arrays (no shell), never string-concatenated commands.
* Several engineers work in this directory at the same time: do not run `npm install`, `next build` or `next dev`, do not touch files you do not own, do not `git commit`. `npx tsc --noEmit` shows everybody's errors – fix only those in your files (`npx tsc --noEmit 2>&1 | grep "src/lib/export"`). `npx vitest run <path>` runs only your tests.

## 8. Sample footage & fixtures

* `Mintavideok/*.mp4` — 5 real phone clips (1920×1080 stored with 90° rotation → portrait 1080×1920, 6–11 s, one at 120 fps) panning over a Hungarian home library.
* `fixtures/sample-shelf/ground-truth.json` — verified list produced by independent human-level reading of every frame:
  `{ videos: [{ video: "20260912_212903", pan_direction, books: [{ author, title, canonical_author, canonical_title, legibility: "clear"|"partial"|"guess", best_frame /*2 fps index, 1-based*/, x_center /*0..1*/, spine_color, duplicate_of /*"<video>#<index>" or null*/, notes }] }], unique_book_count, hard_cases: [] }`
* Mock AI provider replays this fixture; `npm run eval:recognition` (scripts/eval-recognition.ts) runs the real pipeline on the sample videos with the configured provider and reports precision / recall / exact-title accuracy against it.
