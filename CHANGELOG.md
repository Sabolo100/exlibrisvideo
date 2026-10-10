# Changelog

All notable changes of Ex Libris Video. Versions follow semantic versioning; the version lives in
`package.json` and is shown in the site footer and the app settings next to a short build id (content hash
of the sources, see `next.config.ts`). `GET /api/health` reports both.

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
