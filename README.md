# Ex Libris Video

**Magyar** · [English](#english)

Vegyél fel egy lassú videót a könyvespolcodról, töltsd fel – és kapsz egy szép, böngészhető
katalógust a könyveidről egy rövid linken, például `https://www.exlibrisvideo.hu/334345435`.

---

## Mi ez?

Az Ex Libris Video egy kétnyelvű (magyar / angol) webalkalmazás. A telefonnal felvett
polcvideóból kiválogatja a legélesebb képkockákat, mesterséges intelligenciával elolvassa a
könyvgerinceket, összevonja az ismétlődéseket, kiegészíti az adatokat (téma, eredeti cím,
első kiadás éve, borító), és az eredményt sokféle nézetben, szerkeszthetően mutatja meg.
Nincs regisztráció: a katalógus tulajdonosa egy titkos tulajdonosi linkkel szerkeszt.

## Funkciók

- **Feltöltés telefonról**: több videó vagy fotó, darabolt (8 MB-os), folytatható feltöltés,
  élő feldolgozási állapot.
- **Gerincolvasás AI-jal**: Claude Opus 5 (legpontosabb) vagy DeepSeek (olcsóbb), kulcs
  nélkül bemutató (mock) mód.
- **Okos képkocka-válogatás**: élességmérés, mozdulatlan részek kiszűrése, költségplafon.
- **Összevonás és gazdagítás**: ismétlődések kiszűrése, témabesorolás rögzített
  taxonómiával, borítók az Open Library-ből / Google Booksból.
- **Kilenc nézet**: virtuális könyvespolc, borítófal, táblázat, szerzők, témák, idővonal,
  statisztikák, „így láttuk” képkockák, ellenőrzés.
- **Saját adatok**: olvasási állapot, értékelés, kedvencek, jegyzetek, kölcsönadás.
- **Exportok**: Excel, CSV, PDF, JSON, Goodreads CSV; e-mail Excel-melléklettel.
- **Megosztás**: link, QR-kód, előnézeti kép; opcionális PIN-védelem.
- **Elveszett tulajdonosi link visszakérése** e-mailben.
- Világos / sötét téma, mobilra tervezve, akadálymentes; a forrásvideó feldolgozás után törlődik.

## Architektúra

```mermaid
flowchart LR
  B[Böngésző] -->|HTTPS| WEB[web – Next.js 15<br/>oldalak + API]
  WEB <--> DB[(PostgreSQL 16<br/>adatok + feladatsor)]
  WK[worker – tsx<br/>ffmpeg · sharp] <--> DB
  WEB <--> ST[/közös tárhely<br/>STORAGE_DIR/]
  WK <--> ST
  WK --> AI[Claude / DeepSeek]
  WK --> OL[Open Library / Google Books]
  WK --> EM[Resend / SMTP]
```

- **web** (`npm run start`): Next.js App Router, API route handlerek (`src/app/api`), induláskor
  migrációk (`src/instrumentation.ts`).
- **worker** (`npm run worker`): Postgres alapú feladatsor (`FOR UPDATE SKIP LOCKED`);
  videó → képkockák → AI → összevonás → gerinckivágások → gazdagítás → e-mail.
- **Tárhely**: feltöltések, képkockák, gerincfotók, borítók – a web és a worker **ugyanazt** látja.

A részletes specifikáció: [SPEC.md](SPEC.md).

## Gyors indítás Windows-on (PowerShell)

Előfeltételek: **Node.js 22**, **Docker Desktop**, **Git**, és **ffmpeg** a PATH-on
(pl. `winget install Gyan.FFmpeg`, utána új terminál).

1. **Adatbázis** – a kettő közül az egyik (ugyanazt az 5432-es portot használják):

   ```powershell
   .\scripts\dev-db.ps1 start          # exlibris-pg konténer, exlibris-pgdata kötet
   # vagy
   docker compose up -d postgres
   ```

2. **Függőségek:**

   ```powershell
   npm install
   ```

3. **Beállítások** – ha még nincs `.env.local`:

   ```powershell
   if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
   notepad .env.local
   ```

   Helyi fejlesztéshez írd át ezeket (a `.env.example` a Docker-/Coolify-értékeket tartalmazza):

   ```dotenv
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/exlibris
   APP_URL=http://localhost:3000
   STORAGE_DIR=./storage
   EMAIL_PROVIDER=console
   DEEPSEEK_API_KEY=        # vagy ANTHROPIC_API_KEY=; üresen: mock mód
   ```

   A `.env.local` és az `AIApi.txt` titkos – soha ne kerüljön gitbe (a `.gitignore` kizárja).

4. **Migrációk:**

   ```powershell
   npm run db:migrate
   ```

5. **Indítás két terminálban:**

   ```powershell
   npm run dev          # 1. terminál – http://localhost:3000
   ```

   ```powershell
   npm run worker:dev   # 2. terminál – háttérfeldolgozás
   ```

6. **Gyorsteszt:** `.\scripts\smoke.ps1` (egészség-ellenőrzés + próbakatalógus létrehozása).

**A teljes stack Dockerben** (ugyanúgy, mint élesben): `docker compose up -d --build` →
http://localhost:3000. Ha a 3000-es vagy 5432-es port foglalt:
`$env:WEB_PORT=3300; $env:PG_PORT=5433; docker compose up -d --build`.
Leállítás: `docker compose down` (a `-v` az adatokat is törli).

A helyi adatbázis-konténer kezelése: `.\scripts\dev-db.ps1 start | stop | status | logs | psql`.

**Jó tudni fejlesztés közben:**

- **Több `next dev` egyszerre:** a `NEXT_DIST_DIR` változóval egy második példány külön
  build-mappát kaphat (`$env:NEXT_DIST_DIR='.next-preview'; npx next dev -p 3101`). Ilyenkor
  a Next.js **átírja a `tsconfig.json`-t** (az `include` listába felveszi a
  `.next-preview/types/**/*.ts` sort) és a `next-env.d.ts`-t. Leállítás után töröld ki ezt a
  sort a `tsconfig.json`-ból, és ne commitold – különben a `tsc` és a Docker-build egy nem
  létező mappára hivatkozik. (A `next-env.d.ts` gitignore-olt, azzal nincs teendő.)
- **Worker és `.env.local`:** a Next.js magától betölti a `.env.local`-t, a worker
  (`npm run worker:dev`) induláskor maga olvassa be. Módosítás után indítsd újra mindkettőt.
- **Git Bash + Docker:** Git Bash-ből a `/app/...` alakú argumentumokat (pl.
  `docker run -e STORAGE_DIR=/app/storage`) a shell Windows-útvonallá alakítja. Használj
  PowerShellt, vagy előbb: `export MSYS_NO_PATHCONV=1`.

## AI-szolgáltató választása

| Beállítás | Hatás |
|---|---|
| `ANTHROPIC_API_KEY=…` | Claude Opus 5 – a legpontosabb gerincolvasás (alapértelmezett, ha van kulcs) |
| `DEEPSEEK_API_KEY=…` | DeepSeek `deepseek-flash` – jóval olcsóbb |
| `AI_PROVIDER=auto` | Anthropic, ha van kulcs; különben DeepSeek; különben mock |
| `AI_PROVIDER=deepseek` / `anthropic` / `mock` | kényszerített szolgáltató |
| `AI_TEXT_PROVIDER` | külön szolgáltató a szöveges lépésekhez (összevonás, témák) |
| `AI_MOCK=true` | nincs valódi AI-hívás – a mintavideókhoz a `fixtures/` adatait adja vissza |
| `MAX_FRAMES_PER_VIDEO` | költségplafon: ennyi képkocka megy legfeljebb az AI-hoz videónként |

A felismerés pontosságának mérése a mintavideókon: `npm run eval:recognition`.
Költségbecslés: [COOLIFY.md – 11. fejezet](COOLIFY.md#11-i-ai-kulcsok-és-költségek).

## Tesztek

```powershell
npm test                              # összes vitest teszt
npx vitest run src/lib/pipeline       # csak egy terület
npm run typecheck                     # TypeScript-ellenőrzés
```

Egyes integrációs tesztekhez futnia kell a helyi Postgresnek (`.\scripts\dev-db.ps1 start`).

## Projektstruktúra

```text
src/app/                 Next.js oldalak; src/app/api/** – HTTP API
src/components/          UI-készlet, nyitóoldal, feltöltés, katalógus, nézetek, könyvlap
src/db/                  Drizzle-séma, kapcsolat, migrate.ts
src/i18n/                magyar / angol szövegek
src/lib/ai/              AI-szolgáltatók (anthropic, deepseek, mock)
src/lib/pipeline/        probe, képkockák, gerincolvasás, összevonás, kivágások, gazdagítás
src/lib/jobs/            Postgres feladatsor
src/lib/collections/     hozzáférés, DTO-k, lekérdezések, feltöltések
src/lib/export/, email/  exportok és e-mailek
src/worker/              a worker belépési pontja
src/instrumentation.ts   indulás: tárhely-ellenőrzés + migrációk
drizzle/                 SQL-migrációk
fixtures/sample-shelf/   ellenőrzött könyvlista a mintavideókhoz
scripts/                 eval-recognition.ts, dev-db.ps1, smoke.ps1
Dockerfile               web és worker image (worker: --target worker)
docker-compose.yml       helyi teljes stack (postgres + web + worker)
```

## Telepítés

Hetzner + Coolify, lépésről lépésre, magyarul: **[COOLIFY.md](COOLIFY.md)**.

---

<a id="english"></a>

# Ex Libris Video (English)

Film a slow pan over your bookshelf, upload it – and get a beautiful, browsable catalogue of
your books at a short link such as `https://www.exlibrisvideo.hu/334345435`.

## What is it?

Ex Libris Video is a bilingual (Hungarian / English) web app. It picks the sharpest frames of
a phone video of a bookshelf, reads the book spines with AI, merges duplicates, enriches the
data (topic, original title, first publication year, cover) and presents the result in many
editable views. No sign-up: the owner edits through a secret owner link.

## Features

- **Upload from a phone**: several videos or photos, chunked (8 MB) resumable uploads, live
  processing status.
- **AI spine reading**: Claude Opus 5 (most accurate) or DeepSeek (cheaper); a mock mode
  without any key.
- **Smart key-frame selection**: sharpness scoring, redundancy filter, cost cap.
- **Merge & enrich**: duplicate detection, classification into a fixed taxonomy, covers from
  Open Library / Google Books.
- **Nine views**: virtual bookshelf, cover wall, table, authors, topics, timeline, stats,
  "how we saw it" frames, review.
- **Personal data**: reading status, rating, favourites, notes, lending.
- **Exports**: Excel, CSV, PDF, JSON, Goodreads CSV; e-mail with the Excel attached.
- **Sharing**: link, QR code, preview image; optional PIN protection.
- **Recover lost owner links** by e-mail.
- Light / dark theme, mobile-first, accessible; the source video is deleted after processing.

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|HTTPS| WEB[web – Next.js 15<br/>pages + API]
  WEB <--> DB[(PostgreSQL 16<br/>data + job queue)]
  WK[worker – tsx<br/>ffmpeg · sharp] <--> DB
  WEB <--> ST[/shared storage<br/>STORAGE_DIR/]
  WK <--> ST
  WK --> AI[Claude / DeepSeek]
  WK --> OL[Open Library / Google Books]
  WK --> EM[Resend / SMTP]
```

- **web** (`npm run start`): Next.js App Router, API route handlers (`src/app/api`), runs
  migrations at boot (`src/instrumentation.ts`).
- **worker** (`npm run worker`): Postgres job queue (`FOR UPDATE SKIP LOCKED`);
  video → frames → AI → merge → spine crops → enrichment → e-mail.
- **Storage**: uploads, frames, spine photos, covers – web and worker see the **same** directory.

Full specification: [SPEC.md](SPEC.md).

## Local quick start on Windows (PowerShell)

Prerequisites: **Node.js 22**, **Docker Desktop**, **Git** and **ffmpeg** on PATH
(e.g. `winget install Gyan.FFmpeg`, then open a new terminal).

1. **Database** – one of the two (both use port 5432):

   ```powershell
   .\scripts\dev-db.ps1 start          # container exlibris-pg, volume exlibris-pgdata
   # or
   docker compose up -d postgres
   ```

2. **Dependencies:**

   ```powershell
   npm install
   ```

3. **Configuration** – if there is no `.env.local` yet:

   ```powershell
   if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
   notepad .env.local
   ```

   For local development change these (`.env.example` holds the Docker / Coolify values):

   ```dotenv
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/exlibris
   APP_URL=http://localhost:3000
   STORAGE_DIR=./storage
   EMAIL_PROVIDER=console
   DEEPSEEK_API_KEY=        # or ANTHROPIC_API_KEY=; empty: mock mode
   ```

   `.env.local` and `AIApi.txt` are secrets – never commit them (`.gitignore` excludes them).

4. **Migrations:**

   ```powershell
   npm run db:migrate
   ```

5. **Run in two terminals:**

   ```powershell
   npm run dev          # terminal 1 – http://localhost:3000
   ```

   ```powershell
   npm run worker:dev   # terminal 2 – background processing
   ```

6. **Smoke test:** `.\scripts\smoke.ps1` (health check + creates a test collection).

**Full stack in Docker** (same as production): `docker compose up -d --build` →
http://localhost:3000. If port 3000 or 5432 is taken:
`$env:WEB_PORT=3300; $env:PG_PORT=5433; docker compose up -d --build`.
Stop with `docker compose down` (`-v` also deletes the data).

Manage the local database container: `.\scripts\dev-db.ps1 start | stop | status | logs | psql`.

**Good to know while developing:**

- **Several `next dev` instances:** `NEXT_DIST_DIR` gives a second instance its own build
  directory (`$env:NEXT_DIST_DIR='.next-preview'; npx next dev -p 3101`). Next.js then
  **rewrites `tsconfig.json`** (adds `.next-preview/types/**/*.ts` to `include`) and
  `next-env.d.ts`. Afterwards remove that line from `tsconfig.json` and never commit it –
  otherwise `tsc` and the Docker build reference a directory that does not exist.
  (`next-env.d.ts` is gitignored, nothing to do there.)
- **Worker and `.env.local`:** Next.js loads `.env.local` automatically; the worker
  (`npm run worker:dev`) loads it itself at startup. Restart both after changing it.
- **Git Bash + Docker:** Git Bash converts `/app/...` arguments (e.g.
  `docker run -e STORAGE_DIR=/app/storage`) into Windows paths. Use PowerShell, or run
  `export MSYS_NO_PATHCONV=1` first.

## Choosing the AI provider

| Setting | Effect |
|---|---|
| `ANTHROPIC_API_KEY=…` | Claude Opus 5 – most accurate spine reading (default when a key is set) |
| `DEEPSEEK_API_KEY=…` | DeepSeek `deepseek-flash` – much cheaper |
| `AI_PROVIDER=auto` | Anthropic if its key is set, else DeepSeek, else mock |
| `AI_PROVIDER=deepseek` / `anthropic` / `mock` | force a provider |
| `AI_TEXT_PROVIDER` | separate provider for text steps (merge, topics) |
| `AI_MOCK=true` | no real AI calls – replays `fixtures/` for the sample videos |
| `MAX_FRAMES_PER_VIDEO` | cost cap: at most this many frames per video are sent to the AI |

Measure recognition quality on the sample videos: `npm run eval:recognition`.
Cost estimate: [COOLIFY.md – section 11](COOLIFY.md#11-i-ai-kulcsok-és-költségek) (Hungarian).

## Tests

```powershell
npm test                              # all vitest tests
npx vitest run src/lib/pipeline       # a single area
npm run typecheck                     # TypeScript check
```

Some integration tests need the local Postgres (`.\scripts\dev-db.ps1 start`).

## Project structure

```text
src/app/                 Next.js pages; src/app/api/** – HTTP API
src/components/          UI kit, landing, upload, collection shell, views, book drawer
src/db/                  Drizzle schema, pool, migrate.ts
src/i18n/                Hungarian / English messages
src/lib/ai/              AI providers (anthropic, deepseek, mock)
src/lib/pipeline/        probe, frames, spine reading, merge, crops, enrichment
src/lib/jobs/            Postgres job queue
src/lib/collections/     access, DTOs, queries, uploads
src/lib/export/, email/  exports and e-mail
src/worker/              worker entry point
src/instrumentation.ts   boot: storage check + migrations
drizzle/                 SQL migrations
fixtures/sample-shelf/   verified book list for the sample videos
scripts/                 eval-recognition.ts, dev-db.ps1, smoke.ps1
Dockerfile               web and worker image (worker: --target worker)
docker-compose.yml       local full stack (postgres + web + worker)
```

## Deployment

Hetzner + Coolify, step by step (in Hungarian): **[COOLIFY.md](COOLIFY.md)**.
