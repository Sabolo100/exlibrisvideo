# Ex Libris Video – telepítés Hetzner szerverre, Coolify-jal

Ez a leírás lépésről lépésre végigvezet azon, hogyan kerül ki az alkalmazás a
`https://www.exlibrisvideo.hu` címre. Nem kell hozzá DevOps-tapasztalat: minden
parancs előtt félkövérrel ott áll, **hol** kell lefuttatni.

> A Coolify felülete verzióról verzióra kicsit változik. Az alábbi mező- és menünevek a
> Coolify v4 (angol nyelvű) felületéről valók; ha egy címke nálad kicsit másképp szerepel,
> a hozzá tartozó magyarázat alapján könnyen megtalálod.

## Tartalom

1. [Mit építünk fel?](#1-mit-építünk-fel)
2. [Előkészületek](#2-előkészületek)
3. [(a) A kód feltöltése privát GitHub-tárolóba](#3-a-a-kód-feltöltése-privát-github-tárolóba)
4. [(b) PostgreSQL 16 adatbázis](#4-b-postgresql-16-adatbázis)
5. [(c) A webalkalmazás](#5-c-a-webalkalmazás-exlibris-web)
6. [(d) Közös tárhely a web és a worker számára](#6-d-közös-tárhely-a-web-és-a-worker-számára)
7. [(e) A worker alkalmazás](#7-e-a-worker-alkalmazás-exlibris-worker)
8. [(f) DNS és HTTPS-tanúsítvány](#8-f-dns-és-https-tanúsítvány)
9. [(g) Első indítás – ellenőrzőlista](#9-g-első-indítás--ellenőrzőlista)
10. [(h) E-mail küldés](#10-h-e-mail-küldés)
11. [(i) AI-kulcsok és költségek](#11-i-ai-kulcsok-és-költségek)
12. [(j) Frissítés, visszaállás, mentés, naplók](#12-j-frissítés-visszaállás-mentés-naplók)
13. [Valódi látogatói IP, Cloudflare](#13-valódi-látogatói-ip-cloudflare)
14. [(k) Hibaelhárítás](#14-k-hibaelhárítás)

---

## 1. Mit építünk fel?

Egy Coolify-projekten belül **három erőforrás** lesz:

| Coolify-erőforrás | Mi ez? | Nyilvános cím |
|---|---|---|
| `exlibris-pg` | PostgreSQL 16 adatbázis | nincs (csak belső hálózat) |
| `exlibris-web` | a weboldal és az API (Next.js, 3000-es port) | `https://www.exlibrisvideo.hu` |
| `exlibris-worker` | háttérfeldolgozó: videó → képkockák → AI → könyvlista, e-mailek | nincs |

A web és a worker **ugyanabból a GitHub-tárolóból és ugyanabból a `Dockerfile`-ból** épül,
és **ugyanazt a tárhelymappát** látja a szerveren (`/data/exlibrisvideo/storage` →
a konténerben `/app/storage`). A feltöltött videókat a web írja ide, a worker innen olvassa,
és ide menti a képkockákat, gerincfotókat, borítókat – amelyeket aztán a web szolgál ki.

```mermaid
flowchart LR
  U[Látogató böngészője] -->|HTTPS| T[Traefik – Coolify proxy<br/>Let's Encrypt]
  T --> W[exlibris-web<br/>Next.js :3000]
  W <--> P[(exlibris-pg<br/>PostgreSQL 16)]
  K[exlibris-worker<br/>npm run worker] <--> P
  W <--> S[/data/exlibrisvideo/storage<br/>= /app/storage/]
  K <--> S
  K -->|képkockák| AI[Claude / DeepSeek]
  K -->|borítók| OL[Open Library / Google Books]
  K -->|e-mail| M[Resend / SMTP]
```

Az adatbázis-migrációk automatikusan lefutnak: a web induláskor, a worker induláskor
(egy adatbázis-zár gondoskodik róla, hogy a kettő ne akadjon össze).

## 2. Előkészületek

- **Hetzner szerver, rajta telepített Coolify** (v4). Ajánlott méret: legalább 4 vCPU és
  8 GB RAM (pl. CX32 / CPX31 vagy Arm alapú CAX21) – a videófeldolgozás (ffmpeg) és a
  `next build` is szereti a memóriát. Mindkét processzorarchitektúra (x86 és Arm) működik.
- **Tűzfal**: ha Hetzner Cloud Firewallt használsz, legyen nyitva a TCP 80 és 443
  (a tanúsítványkérés a 80-as porton történik).
- **A domain** (`exlibrisvideo.hu`) a .hu regisztrátorodnál, hozzáféréssel a DNS-beállításokhoz.
- **GitHub-fiók.**
- **Legalább egy AI-kulcs** (Anthropic és/vagy DeepSeek) – lásd a [11. fejezetet](#11-i-ai-kulcsok-és-költségek).
  Kulcs nélkül is elindul, de akkor csak bemutató („mock”) felismerés fut.
- Opcionális: **Resend-fiók** vagy SMTP-hozzáférés az e-mailekhez.

---

## 3. (a) A kód feltöltése privát GitHub-tárolóba

### 3.1 Titkok ellenőrzése – EZT NE HAGYD KI

A projekt gyökerében van két titkos fájl, amelyek **soha nem kerülhetnek fel** a GitHubra:
`AIApi.txt` (a gépeden `AIAPI.txt` néven is lehet) és `.env.local`. A `.gitignore` már
kizárja őket – ellenőrizd:

**Ez a saját gépeden fut: PowerShell, a projekt mappájában**

```powershell
git check-ignore -v AIApi.txt AIAPI.txt .env.local .env Mintavideok storage
```

Minden fájlhoz egy sornak kell tartoznia, amely megmutatja, melyik `.gitignore`-szabály
zárja ki. A kimenet ilyen (a sorszámok eltérhetnek):

```text
.gitignore:4:[Aa][Ii][Aa][Pp][Ii].txt	AIApi.txt
.gitignore:4:[Aa][Ii][Aa][Pp][Ii].txt	AIAPI.txt
.gitignore:7:.env.*	.env.local
.gitignore:6:.env	.env
.gitignore:11:Mintavideok/	Mintavideok
.gitignore:23:storage/	storage
```

Ha valamelyik fájlhoz **nem jön sor**, az nincs kizárva: írd be a pontos nevét a `.gitignore`
fájlba, és futtasd újra a parancsot. (Az `[Aa][Ii][Aa][Pp][Ii].txt` szabály a kulcsfájlt
bármilyen kis- és nagybetűs írásmóddal kizárja – Linuxon és Macen is, ahol a git
megkülönbözteti őket.)

### 3.2 Privát tároló létrehozása és feltöltés

1. A github.com-on: jobb felül **+** → **New repository** → név: `exlibrisvideo` →
   **Private** → **Create repository** (README-t, `.gitignore`-t NE kérj hozzá).
2. Töltsd fel a kódot (a `<fiókod>` helyére a GitHub-felhasználóneved kerül):

**Ez a saját gépeden fut: PowerShell, a projekt mappájában**

```powershell
git add -A
git status --short
```

Nézd végig a listát: **nem szerepelhet benne** `AIApi.txt`, `AIAPI.txt`, `.env.local`,
`Mintavideok/`, `storage/` vagy `node_modules/`. Ha minden rendben:

**Ez a saját gépeden fut: PowerShell, a projekt mappájában**

```powershell
git commit -m "Ex Libris Video – első verzió"
git branch -M main
git remote add origin https://github.com/<fiókod>/exlibrisvideo.git
git push -u origin main
```

Utólagos ellenőrzés – ennek a parancsnak **üres** kimenetet kell adnia:

**Ez a saját gépeden fut: PowerShell, a projekt mappájában**

```powershell
git ls-files | Select-String -Pattern 'AIApi|\.env\.local'
```

> **Ha mégis felkerült egy titok:** azonnal érvénytelenítsd a kulcsot a szolgáltatónál
> (Anthropic Console / DeepSeek platform), és kérj újat. A git-előzményekből való törlés
> önmagában nem elég – ami egyszer kikerült, azt kompromittáltnak kell tekinteni.

---

## 4. (b) PostgreSQL 16 adatbázis

1. Coolify → **Projects** → **+ Add** → név: `Ex Libris Video` → nyisd meg a
   `production` környezetet.
2. **+ New** → **Databases** → **PostgreSQL** → szerver: `localhost` (az alapértelmezett
   *Destination* maradjon). Ha választhatsz image-et, legyen **`postgres:16-alpine`**.
3. **General** fül:
   - **Name**: `exlibris-pg` – ez **csak egy címke a Coolify-ban**, nem az adatbázis vagy a
     felhasználó neve.
   - **Username**, **Password**, **Initial Database**: **hagyd érintetlenül** a Coolify által
     generált értékeket. (Az alkalmazás a kapott URL-ből mindent tud.)
   - **Make it publicly available**: maradjon **kikapcsolva** – az adatbázist csak a belső
     hálózatról kell elérni.
4. Kattints a **Start** gombra, és várd meg, amíg zöld (*Running*) lesz.
5. Másold ki az **Internal URL** mező tartalmát (kb. így néz ki:
   `postgres://postgres:HOSSZÚ_JELSZÓ@a1b2c3d4e5:5432/postgres`). Ez lesz a
   `DATABASE_URL` **mindkét** alkalmazásnál. A furcsa gépnév (`a1b2c3d4e5`) így helyes: a
   Coolify belső hálózatán ezen a néven érhető el az adatbázis.
6. **Mentés beállítása**: **Backups** fül → **Scheduled Backups** → **+ Add** →
   gyakoriság: `0 3 * * *` (minden éjjel 3:00). Ha van S3-tárhelyed (pl. Hetzner Object
   Storage), add meg célként – így a mentés akkor is megmarad, ha a szerver elvész.
   Próbaként nyomd meg egyszer a **Backup Now** gombot, és nézd meg, sikerült-e.

---

## 5. (c) A webalkalmazás (`exlibris-web`)

### 5.1 Létrehozás

1. A projektben: **+ New** → **Private Repository (with GitHub App)**.
   - Első alkalommal a Coolify végigvezet egy GitHub App létrehozásán (**Sources** →
     **+ Add** → **GitHub App** → **Register Now**). A GitHubon az **Only select
     repositories** opciót válaszd, és csak az `exlibrisvideo` tárolót engedélyezd.
2. Tároló: `exlibrisvideo`, ág (**Branch**): `main`.
3. **Build Pack**: **Dockerfile**.
4. Szerver: ugyanaz a `localhost`, ugyanaz a *Destination*, mint az adatbázisé.

### 5.2 General beállítások

| Mező | Érték |
|---|---|
| **Name** | `exlibris-web` |
| **Base Directory** | `/` |
| **Dockerfile Location** | `/Dockerfile` |
| **Docker build stage target** | **üresen hagyni** (az alapértelmezett, utolsó `web` fázis épül) |
| **Ports Exposes** | `3000` |
| **Domains** | `https://www.exlibrisvideo.hu,https://exlibrisvideo.hu` |
| **Direction** (www-átirányítás) | **Redirect to www** – így a csupasz `exlibrisvideo.hu` a `www`-re irányít |

Mentsd el (**Save**).

### 5.3 Healthcheck

**Configuration → Healthcheck**: **Enabled** ✔, **Path**: `/api/health`, **Port**: `3000`,
a többi maradhat alapértéken (pl. Interval 30 s, Timeout 10 s, Retries 3, Start Period 60 s).

Az image-ben is van egy beépített ellenőrzés ugyanerre a végpontra, és a Coolify ezt
részesíti előnyben – a kettő ugyanazt vizsgálja. A `/api/health` 200-at ad, ha az
adatbázis elérhető, és 503-at, ha nem. Ehhez a Coolify-nak `curl`-re van szüksége a
konténerben – ez benne van az image-ben.

### 5.4 Környezeti változók

**Configuration → Environment Variables.** A leggyorsabb, ha átváltasz **Developer view**-ra,
és egyben beilleszted az alábbi blokkot, majd kitöltöd a `<…>` részeket:

**Ezt a Coolify felületén illeszted be: exlibris-web → Configuration → Environment Variables → Developer view**

```dotenv
DATABASE_URL=<a Postgres "Internal URL" értéke>
APP_URL=https://www.exlibrisvideo.hu
APP_SECRET=<64 karakteres véletlen hexa szöveg, lásd lent>
STORAGE_DIR=/app/storage
ANTHROPIC_API_KEY=<sk-ant-…, ha van>
DEEPSEEK_API_KEY=<sk-…, ha van>
EMAIL_PROVIDER=console
EMAIL_FROM=Ex Libris Video <hello@exlibrisvideo.hu>
RESEND_API_KEY=
ADMIN_PASSWORD=<erős jelszó az /api/admin/overview végponthoz>
```

Az `APP_SECRET` előállítása:

**Ez a gazdagépen fut: Coolify → Terminal → localhost**

```bash
openssl rand -hex 32
```

Fontos tudnivalók:

- **Minden változó ugyanúgy kell a workerhez is** (a 7. fejezetben átmásolod). Különösen az
  `APP_SECRET`, `APP_URL` és `DATABASE_URL` legyen betűre azonos: a worker ezekkel ír
  aláírt helyreállító linkeket az e-mailekbe.
- Az `APP_SECRET`-et **ne változtasd meg** később. Ha mégis megteszed, a tulajdonosi és
  PIN-sütik érvénytelenné válnak – a tulajdonosoknak újra meg kell nyitniuk a tulajdonosi
  linküket.
- Titkoknál (kulcsok, jelszavak, `DATABASE_URL`) vedd ki a pipát a **Build Variable**
  (újabb verziókban: *Available at Buildtime*) jelölőből – ezekre csak futás közben van
  szükség. Egyedül a `NEXT_PUBLIC_DEMO_COLLECTION_ID` kell build közben is.
- Ha egy érték `$` jelet tartalmaz (pl. SMTP-jelszó), jelöld **Literal**-nak.

#### Az összes változó

A kötelezők **félkövérek**. Ahol nincs megadva érték, ott a táblázatban szereplő
alapértelmezés érvényes (forrás: `.env.example` és `src/lib/env.ts`).

| Név | Példa / alapérték | Kötelező? | Jelentés |
|---|---|---|---|
| **`DATABASE_URL`** | `postgres://postgres:…@a1b2c3d4e5:5432/postgres` | igen | A Postgres erőforrás **Internal URL**-je. |
| **`APP_URL`** | `https://www.exlibrisvideo.hu` | igen | Nyilvános cím perjel nélkül – linkekben, e-mailekben, QR-kódokban. |
| **`APP_SECRET`** | `openssl rand -hex 32` kimenete | igen | Sütik és helyreállító linkek aláírókulcsa. Hosszú, véletlen, változatlan. |
| `STORAGE_DIR` | `/app/storage` | nem (az image beállítja) | A közös tárhely útvonala a konténerben. |
| `AI_PROVIDER` | `auto` | nem | `auto` = Anthropic, ha van kulcs; különben DeepSeek; különben mock. Kényszeríthető: `anthropic` / `deepseek` / `mock`. |
| `AI_TEXT_PROVIDER` | `auto` | nem | Ugyanez a szöveges lépésekre (összevonás, témabesorolás). |
| `AI_MOCK` | `false` | nem | `true` = bemutató mód, valódi AI-hívás nélkül. |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | egy AI-kulcs erősen ajánlott | Claude – a legpontosabb gerincolvasás. |
| `ANTHROPIC_VISION_MODEL` | `claude-opus-5` | nem | Modell a képkockákhoz. |
| `ANTHROPIC_TEXT_MODEL` | `claude-opus-5` | nem | Modell a szöveges lépésekhez. |
| `ANTHROPIC_VISION_EFFORT` | `medium` | nem | `low` / `medium` / `high` / `xhigh` / `max` – nagyobb = alaposabb, drágább. |
| `ANTHROPIC_TEXT_EFFORT` | `low` | nem | Ugyanez a szöveges lépésekre. |
| `DEEPSEEK_API_KEY` | `sk-…` | egy AI-kulcs erősen ajánlott | DeepSeek – jóval olcsóbb, kevésbé pontos. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | nem | API-cím. |
| `DEEPSEEK_VISION_MODEL` / `DEEPSEEK_TEXT_MODEL` | `deepseek-flash` | nem | DeepSeek-modellek. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | nem | Az image-ben benne vannak. |
| `FRAME_SAMPLE_FPS` | `8` | nem | Ennyi jelölt képkocka másodpercenként (ebből válogat). |
| `KEYFRAME_WINDOW_SEC` | `0.33` | nem | Ekkora időablakonként a legélesebb kocka marad. |
| `MAX_FRAMES_PER_VIDEO` | `120` | nem | **Költségplafon**: legfeljebb ennyi kockát küld az AI-nak videónként. |
| `FRAME_MAX_EDGE` | `1920` | nem | Az elemzett kockák hosszabbik oldala pixelben. |
| `VISION_BATCH_SIZE` | `4` | nem | Ennyi kocka megy egy AI-kérésben (1 átfedéssel). |
| `VISION_CONCURRENCY` | `2` | nem | Párhuzamos AI-kérések videónként. |
| `DELETE_SOURCE_AFTER_PROCESSING` | `true` | nem | Feldolgozás után törli az eredeti videót (a kockák, gerincfotók maradnak). |
| `MAX_UPLOAD_MB` | `1024` | nem | Egy feltöltött fájl maximális mérete. |
| `MAX_VIDEO_SECONDS` | `600` | nem | Maximális videóhossz. |
| `MAX_SOURCES_PER_COLLECTION` | `30` | nem | Videók/fotók száma katalógusonként. |
| `MAX_BOOKS_PER_COLLECTION` | `5000` | nem | Könyvek száma katalógusonként. |
| `UPLOAD_CHUNK_MB` | `8` | nem | Feltöltési darabméret. |
| `RATE_COLLECTIONS_PER_IP_DAY` | `20` | nem | Új katalógus / IP-cím / nap. |
| `RATE_UPLOADS_PER_IP_HOUR` | `60` | nem | Feltöltés indítása / IP-cím / óra. |
| `RATE_EMAILS_PER_COLLECTION_DAY` | `5` | nem | Kiküldhető e-mail / katalógus / nap. |
| `ENRICH_COVERS` | `true` | nem | Borítók és adatok keresése (Open Library, Google Books). |
| `GOOGLE_BOOKS_API_KEY` | – | nem | Opcionális, több Google Books-lekérdezéshez. |
| `EMAIL_PROVIDER` | `console` | nem | `resend` / `smtp` / `console` (csak naplóz, nem küld). Lásd [10. fejezet](#10-h-e-mail-küldés). |
| `EMAIL_FROM` | `Ex Libris Video <hello@exlibrisvideo.hu>` | e-mail küldéshez igen | Feladó. |
| `RESEND_API_KEY` | `re_…` | ha `EMAIL_PROVIDER=resend` | Resend API-kulcs. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | – / `587` / `false` | ha `EMAIL_PROVIDER=smtp` | SMTP-szerver; 587 + `false` = STARTTLS, 465 + `true` = SSL. |
| `SMTP_USER` / `SMTP_PASS` | – | ha az SMTP hitelesítést kér | SMTP-belépés. |
| `WORKER_POLL_MS` | `1500` | nem | Milyen gyakran néz új feladat után a worker. |
| `WORKER_CONCURRENCY` | `2` | nem | Egyszerre futó feladatok (videók) száma. |
| `WORKER_SHUTDOWN_GRACE_MS` | `20000` | nem | Leállításkor ennyit vár a futó feladatokra, mielőtt visszateszi őket a sorba. Maradjon a Coolify 30 mp-es leállítási határideje alatt. |
| `WORKER_STALE_JOB_MS` | `300000` | nem | Az a futó feladat, amely ennyi ideje nem jelzett (összeomlott worker), visszakerül a sorba. |
| `DRAFT_RETENTION_DAYS` | `7` | nem | Ennyi nap után törlődnek a feltöltés nélküli üres piszkozatok. |
| `ADMIN_PASSWORD` | – | ajánlott | `/api/admin/overview` (felhasználó: `admin`). Ha üres, a végpont nem érhető el. |
| `NEXT_PUBLIC_DEMO_COLLECTION_ID` | `334345435` | nem | Minta-katalógus a nyitóoldalon. **Build Variable legyen**, és módosítás után új deploy kell. |
| `PG_POOL_MAX` | `10` | nem | Adatbázis-kapcsolatok száma konténerenként. |
| `APP_VERSION` | – | nem | Ha megadod, ezt mutatja a `/api/health` `version` mezője. |

> Még **ne** nyomd meg a Deploy gombot: előbb állítsd be a tárhelyet (6. fejezet).

---

## 6. (d) Közös tárhely a web és a worker számára

A web és a worker **ugyanazt a mappát** kell lássa. Ehhez **Directory Mount** (könyvtár-
csatolás, más néven bind mount) kell, **nem** Volume Mount: a Coolify a névvel ellátott
köteteket erőforrásonként külön hozza létre, így a két alkalmazás két különböző tárhelyet
kapna – a worker elmentené a gerincfotókat, a web viszont nem találná őket.

### 6.1 A mappa létrehozása a szerveren

Az alkalmazás a konténerben a **1001-es** felhasználóként (és 1001-es csoportként) fut,
ezért a mappa is az övé kell legyen:

**Ez a gazdagépen fut: Coolify → Terminal → localhost**

```bash
mkdir -p /data/exlibrisvideo/storage
chown -R 1001:1001 /data/exlibrisvideo/storage
chmod 750 /data/exlibrisvideo/storage
ls -ld /data/exlibrisvideo/storage
```

Az utolsó parancs kimenete ilyesmi legyen: `drwxr-x--- 2 1001 1001 … /data/exlibrisvideo/storage`.
(Ha a terminál nem `root`-ként lép be, tedd a parancsok elé: `sudo`.)

### 6.2 Csatolás a webalkalmazáshoz

`exlibris-web` → **Configuration** → **Persistent Storage** → **+ Add** → **Directory Mount**:

| Mező | Érték |
|---|---|
| **Source Path** (a szerveren) | `/data/exlibrisvideo/storage` |
| **Destination Path** (a konténerben) | `/app/storage` |

A workernél (7. fejezet) **pontosan ugyanezt** kell megadni.

Ha a jogosultság rossz, a web naplójában induláskor ez a sor jelenik meg:
`[boot] !!! STORAGE NOT WRITABLE …` – ilyenkor ismételd meg a 6.1 lépést.

Most már megnyomhatod a webalkalmazásnál a **Deploy** gombot (az első build 5–15 perc).

---

## 7. (e) A worker alkalmazás (`exlibris-worker`)

1. A projektben: **+ New** → **Private Repository (with GitHub App)** → **ugyanaz** a tároló
   (`exlibrisvideo`) és ág (`main`) → **Build Pack**: **Dockerfile**.
2. **General**:

| Mező | Érték |
|---|---|
| **Name** | `exlibris-worker` |
| **Base Directory** | `/` |
| **Dockerfile Location** | `/Dockerfile` |
| **Docker build stage target** | **`worker`** |
| **Ports Exposes** | maradhat `3000` (a worker nem figyel portot, ez így ártalmatlan) |
| **Domains** | **üres** – ha a Coolify generált egy címet, töröld ki |

   A **Docker build stage target = `worker`** a lényeg: a Dockerfile build packnél a
   Coolify-ban nincs „Start Command” mező (az csak a Nixpacks build packnél létezik),
   ehelyett a `Dockerfile` `worker` nevű fázisa indítja ugyanazt, amit az `npm run worker`
   (`tsx src/worker/index.ts`) – csak az `npm` közbeiktatása nélkül, hogy a leállítási jelet
   (frissítéskor) maga a worker kapja meg, és a futó feladatot rendben befejezze vagy
   visszategye a sorba. Ha ez a mező üresen marad, a „worker” valójában egy második weboldal
   lesz, és a videók feldolgozása sosem indul el.

   *(Csak ha a te Coolify-verziódból hiányzik ez a mező: **Custom Docker options** =*
   `--entrypoint "/usr/bin/tini -- node node_modules/tsx/dist/cli.mjs src/worker/index.ts"`*.)*

3. **Configuration → Healthcheck**: **Enabled** pipa **KI**. Magyarázat: a worker nem
   szolgál ki weboldalt, így egy HTTP-alapú ellenőrzés mindig elbukna, a Coolify pedig
   „egészségtelennek” jelölné, visszagörgetné a telepítést vagy újra és újra
   újraindítaná. (Az image beépített ellenőrzése felismeri a workert, és addig
   egészségesnek jelenti, amíg a worker folyamat fut – ezért ez akkor sem okoz gondot,
   ha a Coolify azt használja.)
4. **Environment Variables**: másold át **az összes** változót a webalkalmazásból
   (web → Developer view → kijelöl, másol → worker → Developer view → beilleszt).
5. **Persistent Storage** → **+ Add** → **Directory Mount**: **Source Path**
   `/data/exlibrisvideo/storage`, **Destination Path** `/app/storage` – betűre ugyanaz, mint a webnél.
6. **Deploy.** A **Logs** fülön ezeket kell látnod:
   `[worker] starting`, `[worker] migrations applied`, `[worker] ready`.

---

## 8. (f) DNS és HTTPS-tanúsítvány

### 8.1 DNS-rekordok a .hu regisztrátornál

A szerver IP-címét a Hetzner Cloud Console-ban látod (a szerver neve mellett, *IPv4*).
A regisztrátor DNS-kezelőjében (DNS zóna / DNS-rekordok) állítsd be:

| Típus | Név (host) | Érték | TTL |
|---|---|---|---|
| `A` | `@` (maga a `exlibrisvideo.hu`) | a Hetzner szerver IPv4-címe | 3600 |
| `A` | `www` | a Hetzner szerver IPv4-címe | 3600 |
| `AAAA` (opcionális) | `@` és `www` | a szerver IPv6-címe – csak ha biztosan működik | 3600 |

Töröld a régi `@` és `www` rekordokat (pl. parkoló oldal `A` vagy `CNAME` rekordját),
különben a böngészők felváltva a régi helyre is mehetnek. A változás általában néhány perc,
de akár pár óra is lehet. Ellenőrzés:

**Ez a saját gépeden fut: PowerShell**

```powershell
Resolve-DnsName exlibrisvideo.hu -Type A
Resolve-DnsName www.exlibrisvideo.hu -Type A
```

Mindkettőnek a Hetzner szerver IP-címét kell mutatnia.

### 8.2 Tanúsítvány

Semmit nem kell külön kérni: mivel a **Domains** mezőben `https://` címek szerepelnek, a
Coolify proxyja (Traefik) automatikusan kér és megújít **Let's Encrypt** tanúsítványt,
amint a DNS a szerverre mutat és a 80-as port elérhető. Az első deploy után 1–2 perc kell
hozzá. Ha addig „nem biztonságos” figyelmeztetést látsz, várj egy kicsit; ha tartósan
megmarad, lásd a [hibaelhárítást](#14-k-hibaelhárítás).

---

## 9. (g) Első indítás – ellenőrzőlista

1. ☐ `exlibris-pg` fut (zöld).
2. ☐ `exlibris-web` deploy sikeres; a **Logs** fülön ezek a sorok szerepelnek (a sorrend
   kicsit eltérhet): `[boot] web server starting`, `Ready in …`, `[boot] storage ready`,
   `[boot] database migrations applied`. Ha `!!!` kezdetű sort látsz, lásd a
   [hibaelhárítást](#14-k-hibaelhárítás).
3. ☐ A böngészőben a `https://www.exlibrisvideo.hu/api/health` oldal ezt mutatja:
   `{"ok":true,"db":true,"version":"1.0.0"}`.
4. ☐ A `http://exlibrisvideo.hu` cím átirányít a `https://www.exlibrisvideo.hu` címre.
5. ☐ `exlibris-worker` fut; a **Logs** fülön: `[worker] starting`, `[worker] migrations applied`,
   `[worker] ready`. (Ha ehelyett `Ready in …` látszik, a worker valójában weboldalként
   indult: üres a **Docker build stage target** – lásd 7. fejezet.)
6. ☐ Gyorsteszt a saját gépedről (létrehoz, majd töröl egy üres próbakatalógust):

   **Ez a saját gépeden fut: PowerShell, a projekt mappájában**

   ```powershell
   .\scripts\smoke.ps1 -BaseUrl https://www.exlibrisvideo.hu -Cleanup
   ```

   A végén: `All checks passed`.
7. ☐ **Valódi próba egy rövid klippel**: vegyél fel telefonnal 5–10 másodpercet egy
   polcról (lassú, egyenletes pásztázás), töltsd fel a nyitóoldalon, és kattints a
   **Feldolgozás indítása** gombra. Közben nézd a worker naplóját
   (`exlibris-worker` → **Logs**): `[worker] job started … process_video`, majd
   `[worker] job finished … ok: true`. Pár perc múlva megjelenik a könyvlista.
8. ☐ A polcnézetben a **Valódi gerincek** kapcsolóval látszanak a gerincfotók – ez igazolja,
   hogy a web és a worker tényleg ugyanazt a tárhelyet látja. A szerveren is megnézheted:

   **Ez a gazdagépen fut: Coolify → Terminal → localhost**

   ```bash
   ls /data/exlibrisvideo/storage
   du -sh /data/exlibrisvideo/storage
   ```

   Ilyen mappákat kell látnod: `frames`, `spines`, `covers` (és esetleg `uploads`, `exports`).
9. ☐ Ha beállítottad az e-mailt: a katalógus oldalán **Küldés e-mailben** → megérkezik-e
   (a worker naplójában `send_email` feladat jelenik meg).
10. ☐ Admin-áttekintés (darabszámok, hibás feladatok, AI-költség):

    **Ez a saját gépeden fut: PowerShell**

    ```powershell
    curl.exe -u "admin:<ADMIN_PASSWORD>" https://www.exlibrisvideo.hu/api/admin/overview
    ```

**Hol látom a worker naplóját?** Coolify → Projects → Ex Libris Video → `exlibris-worker`
→ **Logs** fül (élő napló). Egy adott telepítés build-naplója a **Deployments** fülön van.

---

## 10. (h) E-mail küldés

Az e-maileket (kész katalógus Excel-melléklettel, export, helyreállító linkek) a **worker**
küldi. A beállítás mindkét alkalmazásnál legyen azonos. Három lehetőség van:

### A) Resend (ajánlott, egyszerű)

1. Regisztrálj a resend.com-on → **Domains** → **Add Domain** → `exlibrisvideo.hu`
   (régiónak az EU-s, pl. *Ireland (eu-west-1)* ajánlott).
2. A Resend kiír néhány DNS-rekordot (jellemzően egy `MX` és egy `TXT` rekordot a `send`
   aldomainre – ez az **SPF** –, valamint egy `TXT` rekordot `resend._domainkey` néven – ez a
   **DKIM**). Ezeket **pontosan úgy** vedd fel a regisztrátornál, ahogy a Resend mutatja, majd
   a Resendben kattints a **Verify** gombra.
3. Ajánlott egy DMARC-rekord is: `TXT`, név: `_dmarc`, érték: `v=DMARC1; p=none;`
4. **API Keys** → **Create API Key** → jogosultság: *Sending access*, domain: `exlibrisvideo.hu`.
5. Környezeti változók (web **és** worker):

**Ezt a Coolify felületén illeszted be: exlibris-web és exlibris-worker → Configuration → Environment Variables → Developer view**

```dotenv
EMAIL_PROVIDER=resend
EMAIL_FROM=Ex Libris Video <hello@exlibrisvideo.hu>
RESEND_API_KEY=re_…
```

### B) SMTP (saját levelezőszolgáltató)

**Ezt a Coolify felületén illeszted be: exlibris-web és exlibris-worker → Configuration → Environment Variables → Developer view**

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM=Ex Libris Video <hello@exlibrisvideo.hu>
SMTP_HOST=smtp.szolgaltato.hu
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=hello@exlibrisvideo.hu
SMTP_PASS=<jelszó – ha van benne $, jelöld Literal-nak>
```

- **Fontos:** a Hetzner az új Cloud-szervereken alapból **tiltja a kimenő 25-ös és 465-ös
  portot**. Használd a **587-es portot** (`SMTP_SECURE=false`, STARTTLS), vagy a Resendet
  (az HTTPS-en megy, arra nincs tiltás).
- Az `EMAIL_FROM` címét az SMTP-fiók küldhesse, és a domain SPF/DKIM-beállítása feleljen
  meg a szolgáltató leírásának – különben a levelek a spam mappában landolnak.

### C) `console` (alapértelmezés)

`EMAIL_PROVIDER=console` esetén **nem megy ki levél**: a worker csak naplózza, és a
levél HTML-előnézetét a tárhely `exports/_mail/` mappájába menti. Teszteléshez jó,
élesben állítsd át `resend`-re vagy `smtp`-re.

---

## 11. (i) AI-kulcsok és költségek

### Melyiket válasszam?

| | Anthropic (Claude Opus 5) | DeepSeek (`deepseek-flash`) |
|---|---|---|
| Pontosság | **a legpontosabb** – nehezen olvasható, apró betűs gerinceknél is | jó, de a képeket erősen lekicsinyíti, több a tévesztés |
| Ár | drágább (lásd lent) | **jóval olcsóbb** |
| Változó | `ANTHROPIC_API_KEY` | `DEEPSEEK_API_KEY` |
| Kulcs | console.anthropic.com → **API Keys** | platform.deepseek.com → **API keys** |

Ha **mindkét** kulcsot megadod, `AI_PROVIDER=auto` mellett az Anthropic lesz használva.
Az olcsóbbat így kényszerítheted: `AI_PROVIDER=deepseek`. Kulcs nélkül (vagy
`AI_MOCK=true`) csak bemutató eredmény születik.

Állíts be **költési korlátot** a szolgáltatónál is (Anthropic Console → *Settings* →
*Limits*; DeepSeeknél előre feltöltött egyenleg), hogy egy váratlan forgalom se okozzon
meglepetést.

### Mennyibe kerül egy 1 perces videó Claude Opus 5-tel? (becslés)

Listaár: **5 USD / millió bemeneti token**, **25 USD / millió kimeneti token** (a
„gondolkodás” is kimenetnek számít).

A számítás lépései:

1. **Hány képkocka megy az AI-hoz?** A képkocka-válogatás a mintavideókon kb. **2,5
   kulcskockát** tartott meg másodpercenként (egy 10 mp-es klipből 25–27-et), így egy 1 perces
   pásztázásból ~150 lenne. Ezt a `MAX_FRAMES_PER_VIDEO` vágja le (alapból **120**).
2. **Mennyi egy kocka?** Egy 1080×1920 pixeles kocka ≈ **2,6–2,8 ezer képtoken**
   (pixelszám / 750). Tehát 48 kocka ≈ 48 × 2,6 ezer ≈ 125 ezer token ≈ **0,65 USD**.
   Ez az „alsó határ”: ha csak ezt és egy kevés kimenetet számolunk, **0,7–1,0 USD** jön ki.
3. **Átfedés:** egy kérésben 4 kocka megy, és a szomszédos kérések 1 kockán osztoznak
   (hogy a kérések határán álló könyv se vesszen el). 48 kockából így 16 kérés × 4 kép =
   64 kép lesz ≈ 177 ezer token ≈ **0,9 USD**. A rendszerprompt gyorsítótárból megy,
   töredékáron.
4. **Kimenet (a válasz):** mérés a mintavideókon – a DeepSeek 4 kockás kérésenként átlagosan
   **~2 ezer token** könyvlistát (JSON) adott vissza (5 videó, 43 kérés). A Claude több
   gerincet olvas el, és gondolkodik is (`ANTHROPIC_VISION_EFFORT=medium`), ezért kérésenként
   **2–4 ezer** kimeneti tokennel érdemes számolni: 16 × 2–4 ezer = 32–64 ezer token ≈
   **0,8–1,6 USD**.

| Beállítás | Kérés / kép | Képi bemenet | Kimenet | **Összesen / 1 perc videó** |
|---|---|---|---|---|
| `MAX_FRAMES_PER_VIDEO=48` | 16 kérés / 64 kép | ~180 ezer token ≈ 0,9 USD | 32–64 ezer token ≈ 0,8–1,6 USD | **kb. 1,7–2,5 USD** |
| `MAX_FRAMES_PER_VIDEO=120` (alap) | 40 kérés / 160 kép | ~450 ezer token ≈ 2,3 USD | 80–160 ezer token ≈ 2–4 USD | **kb. 4,3–6,3 USD** |

Katalógusonként még néhány cent jön a témabesoroláshoz (szöveges hívások).

A **DeepSeek** ennek a töredéke: a mintavideókon kérésenként ~5 ezer bemeneti és ~2 ezer
kimeneti tokent mértünk, ami a DeepSeek árlistája szerint egy 1 perces videónál jellemzően
néhány cent.

A valós költséget a `/api/admin/overview` végpont mutatja (`estCostUsd`, a listaárakkal
számolva) – az első néhány éles videó után érdemes ránézni, és ahhoz igazítani a
beállításokat. DeepSeeknél ez a mező `0` (az árát az alkalmazás nem ismeri): ott a
platform.deepseek.com **Usage** oldalán látod a tényleges költést.

**Költségcsökkentő kapcsolók:**

- `MAX_FRAMES_PER_VIDEO` – kemény felső korlát videónként; a költség nagyjából arányos vele.
  A `48` az alapértékhez képest kb. 40%-ára csökkenti egy 1 perces videó árát. Rövid (20
  másodperc alatti) klipeknél nincs hatása, mert azokból amúgy is kevesebb kocka lesz.
  (Túl alacsony értéknél a gyors pásztázásnál kimaradhatnak vékony gerincek: a korlát
  alatt a megtartott kockák egyenletesen oszlanak el a videóban, a köztük lévők kimaradnak.)
- `ANTHROPIC_VISION_EFFORT=low` – kevesebb gondolkodás, kisebb kimeneti költség.
- `MAX_VIDEO_SECONDS`, `MAX_SOURCES_PER_COLLECTION`, `RATE_COLLECTIONS_PER_IP_DAY` – a
  visszaélések és a nagyon hosszú feltöltések ellen.

---

## 12. (j) Frissítés, visszaállás, mentés, naplók

### Frissítés

A GitHub App-pel összekötött alkalmazásoknál alapból be van kapcsolva az **Auto Deploy**:
minden `git push` a `main` ágra automatikusan újraépíti **mindkét** alkalmazást.

**Ez a saját gépeden fut: PowerShell, a projekt mappájában**

```powershell
git add -A
git commit -m "Leírás a változásról"
git push
```

Kézzel: az alkalmazás oldalán **Deploy** (vagy **Redeploy**). Az adatbázis-migrációk
maguktól lefutnak. Ha a változás adatbázis-módosítást is tartalmaz, előtte készíts
mentést (**Backup Now** az adatbázisnál).

> **A worker frissítése futó feldolgozás közben.** Frissítéskor a Coolify leállítási jelet
> küld a régi worker-konténernek, és **30 másodperc** múlva végleg leállítja. A worker a jelre
> nem vesz fel új feladatot, a futót legfeljebb 20 másodpercig (`WORKER_SHUTDOWN_GRACE_MS`)
> hagyja befejeződni, utána megszakítja és visszateszi a sorba – így ez a 30 másodperces
> határidőn belül megtörténik, és az új worker azonnal újra felveszi. Ha a régi konténert
> mégis erőszakkal állítják le (pl. elfogy a memória), a feladat legfeljebb **5 percig**
> „feldolgozás alatt” marad: a futó feladatok percenként jelzik, hogy élnek, és bármelyik
> worker 2 percenként visszateszi a sorba azokat, amelyek 5 perce nem jeleztek
> (`WORKER_STALE_JOB_MS`). Kézi újraindításra nincs szükség.
>
> A félbeszakított videóelemzés elölről indul (a már elemzett kockák költsége újra felmerül),
> ezért a workert lehetőleg akkor frissítsd, amikor épp nem dolgozik. Ezt a naplóból látod
> (ha az utolsó `[worker] job started` sor után még nincs `[worker] job finished`, épp
> dolgozik), vagy közvetlenül az adatbázisból:
>
> **Ez az adatbázis-konténerben fut: Coolify → exlibris-pg → Terminal**
>
> ```bash
> psql -U postgres -d postgres -c "select id, type, locked_at from jobs where status = 'running'"
> ```
>
> Ha a `DATABASE_URL`-ben (`postgres://FELHASZNÁLÓ:jelszó@gépnév:5432/ADATBÁZIS`) más a
> felhasználó vagy az adatbázis neve, azt írd a `-U` és a `-d` után. Üres lista (`(0 rows)`)
> = most nyugodtan frissíthetsz.

### Visszaállás (rollback)

Az alkalmazás **Configuration → Rollback** részében a korábbi image-ek közül egy
kattintással visszaállhatsz. Figyelem: az adatbázis-migrációk **nem** állnak vissza –
csak olyan verzióra menj vissza, amely még ugyanazzal az adatbázis-szerkezettel dolgozik,
különben állítsd vissza a frissítés előtti adatbázis-mentést is.

### Mentések

- **Adatbázis**: a 4. fejezetben beállított napi **Scheduled Backups** (lehetőleg S3-ra).
- **Tárhely** (`/data/exlibrisvideo/storage` – képkockák, gerincfotók, borítók): ezt a
  Coolify nem menti. A legegyszerűbb a Hetzner Cloud Console-ban a szerver **Backups**
  funkciója (napi teljes mentés). Kézi mentés:

  **Ez a gazdagépen fut: Coolify → Terminal → localhost**

  ```bash
  tar -czf /root/exlibris-storage-$(date +%F).tar.gz -C /data/exlibrisvideo storage
  ls -lh /root/exlibris-storage-*.tar.gz
  ```

### Naplók

- Élő napló: alkalmazás → **Logs** fül. Hasznos előtagok: `[boot]` (indulás, migráció),
  `[api]`, `[worker]`, `[ai]`, `[email]`.
- Build-napló: alkalmazás → **Deployments** → a kiválasztott telepítés.
- A szerverről is elérhető:

  **Ez a gazdagépen fut: Coolify → Terminal → localhost**

  ```bash
  docker ps --format '{{.Names}}\t{{.Status}}'
  docker logs --tail 200 -f <a konténer neve a fenti listából>
  ```

### Parancs futtatása a konténerben

Alkalmazás → **Terminal** fül (vagy a bal oldali **Terminal** menüben a konténer
kiválasztása). Például a migráció kézi futtatása és a tárhely ellenőrzése:

**Ez a web konténerben fut: Coolify → exlibris-web → Terminal**

```bash
npm run db:migrate
id
ls -la /app/storage
```

Az `id` kimenete: `uid=1001(exlibris) gid=1001(exlibris)`. A migráció végén
`[migrate] done` jelenik meg.

**Ez a worker konténerben fut: Coolify → exlibris-worker → Terminal**

```bash
ffmpeg -hide_banner -version | head -n 1
ls /app/storage/spines | head
```

---

## 13. Valódi látogatói IP, Cloudflare

Az alkalmazás IP-címenként korlátozza a katalógus-létrehozást, a feltöltéseket és a
PIN-próbálkozásokat. Az IP-címet az `X-Forwarded-For` fejléc első eleméből veszi.

- **Coolify alapbeállítással ez biztonságos:** a Coolify proxyja (Traefik) alapból senkitől
  sem fogad el `X-Forwarded-For` fejlécet: a látogató által küldöttet eldobja, és a valódi,
  hozzá kapcsolódó IP-címet írja bele – hamis fejléccel tehát nem lehet kijátszani a
  korlátokat. (A Coolify alapértelmezett proxy-konfigurációjában nincs `forwardedHeaders`
  beállítás; ennek így is kell maradnia.)
- **Ne kapcsold be** a proxy beállításaiban a `forwardedHeaders.insecure` opciót
  (Servers → localhost → Proxy): akkor bárki hamis IP-címet küldhetne, és megkerülhetné a
  korlátozást. Ugyanezért ne adj meg `forwardedHeaders.trustedIPs` listát sem – kivéve a lenti
  Cloudflare-esetet.
- Ha a szerver elé másik fordított proxyt vagy terheléselosztót teszel (pl. Hetzner Load
  Balancer), az ugyanúgy a proxy saját IP-címét adná át; ilyenkor a lenti Cloudflare-leírás
  szerint kell a proxy címét megbízhatónak jelölni.

### Ha Cloudflare-t használsz

- **Ajánlott**: a Cloudflare DNS-ben a `@` és `www` rekord **DNS only** (szürke felhő)
  legyen. Így minden a fentiek szerint működik, és a tanúsítvány is gond nélkül elkészül.
- **Ha proxyzol (narancs felhő)**: minden kérés a Cloudflare szervereiről érkezik, a
  Traefik ezért a Cloudflare IP-címét írja be – sok látogató osztozna ugyanazon a korláton,
  és indokolatlan „túl sok kérés” hibák jönnének. Megoldás: a Traefik bízzon meg a
  Cloudflare címtartományaiban. Servers → localhost → **Proxy** → a konfigurációs fájl
  `command:` listájába vedd fel az alábbi két sort (a tartományok aktuális listája:
  cloudflare.com/ips), majd **Restart Proxy**:

  **Ezt a Coolify felületén szerkeszted: Servers → localhost → Proxy → konfiguráció, a `command:` lista végére**

  ```yaml
  - '--entrypoints.http.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32'
  - '--entrypoints.https.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32'
  ```

  A Cloudflare **SSL/TLS** módja legyen **Full (strict)**. Tanúsítványkéréskor (első
  telepítés, domainváltás) érdemes ideiglenesen szürkére állítani a felhőt.

  **Fontos korlát:** a Cloudflare a látogató által küldött `X-Forwarded-For` fejlécet nem
  dobja el, hanem a végére fűzi a valódi IP-címet (`hamis-ip, valódi-ip`). Mivel az alkalmazás
  az első elemet veszi, proxyzott módban egy rosszindulatú látogató minden kérésnél más hamis
  IP-címet küldhet, és így **megkerülheti** az IP-alapú korlátokat (katalógus-létrehozás,
  feltöltés, PIN-próbálkozás). Ha mégis a narancs felhőt választod, kapcsold be a Cloudflare
  saját védelmét is (**Security → WAF → Rate limiting rules**, pl. a `/api/` útvonalakra), és
  állíts be költési korlátot az AI-szolgáltatónál. Ez is a szürke felhő (DNS only) mellett szól.

---

## 14. (k) Hibaelhárítás

| Tünet | Valószínű ok | Megoldás |
|---|---|---|
| A tulajdonosi link megnyitása után „kijelentkeztet”, nem tudok szerkeszteni | A sütik a protokollhoz igazodnak (HTTPS-en `Secure`, HTTP-n anélkül), tehát sima HTTP-n is működnek. Ha mégis elvesznek: megváltozott az `APP_SECRET`, vagy felváltva a `www` és a csupasz domain nyílik meg | Nyisd meg újra a tulajdonosi linket. Legyen beállítva a **Redirect to www**. Az `APP_SECRET` maradjon változatlan, és a web és a worker értéke egyezzen. |
| Feltöltés megszakad vagy hibát ad | A feltöltés 8 MB-os darabokban megy, a proxy méretkorlátja tehát nem gond. Gyakoribb ok: betelt a lemez, rossz a tárhely jogosultsága, vagy elérted a feltöltési korlátot | `df -h` a gazdagépen; a web naplójában `STORAGE NOT WRITABLE` → 6.1 lépés; `MAX_UPLOAD_MB`, `RATE_UPLOADS_PER_IP_HOUR`. A feltöltés folytatható, újrapróbálkozik. |
| A worker újra és újra újraindul, vagy a deploy „unhealthy” és visszagörgetődik | Be van kapcsolva a Healthcheck a workeren (HTTP-kérésre vár, de a worker nem szolgál ki weboldalt), **vagy** a worker induláskor hibával kilép | `exlibris-worker` → Configuration → Healthcheck → **Enabled** ki, majd **Redeploy**. Ha a naplóban `[worker] fatal` áll: rossz a `DATABASE_URL`, vagy nem fut az adatbázis – javítsd, a worker magától újraindul. |
| Az adatbázis újraindítása (pl. Postgres-frissítés) után a worker is újraindul | A megszakadt adatbázis-kapcsolat miatt a worker kilép, a Coolify pedig automatikusan újraindítja | Nincs teendő: amint az adatbázis fut, a naplóban megjelenik a `[worker] ready`. A web ilyenkor csak egy `[db] idle PostgreSQL connection lost` sort ír, és fut tovább. |
| A feldolgozás el sem indul, 0%-on áll | Nem fut a worker, vagy üres a **Docker build stage target** (ekkor a „worker” egy második weboldal) | A worker naplójában kell lennie `[worker] ready` sornak. Ha `Ready in …` (Next.js) látszik, állítsd a target mezőt `worker`-re, és **Redeploy**. |
| A könyvek megjelennek, de a gerincfotók / képkockák hiányoznak (törött képek) | A web és a worker **különböző** tárhelyet lát (eltér a Directory Mount, vagy Volume Mount lett) | Mindkét alkalmazásnál **Directory Mount**: `/data/exlibrisvideo/storage` → `/app/storage`. Ellenőrzés: `ls /app/storage/spines` mindkét konténer termináljában ugyanazt mutassa. |
| `/api/health`: `{"ok":false,"db":false}` (503) vagy 404 / „no available server” | Rossz a `DATABASE_URL` (Public URL-t vagy régi jelszót adtál meg), leállt az adatbázis, vagy más *Destination*-ön van | Használd a Postgres **Internal URL**-jét; indítsd el az adatbázist; azonos szerver és Destination. A web naplójában: `[boot] !!! DATABASE MIGRATION FAILED`. |
| Migrációs hiba | A migrációk induláskor futnak (web és worker, egy adatbázis-zár miatt egyszerre csak az egyik); adatbázis-hiba esetén a web a háttérben újrapróbálkozik (5 mp, 15 mp, … legfeljebb 5 percenként) | Nézd meg a `[boot]` sorokat a naplóban. Kézi futtatás a web konténer termináljában (Coolify → exlibris-web → Terminal): `npm run db:migrate` – a végén `[migrate] done`. |
| A naplóban `STORAGE NOT WRITABLE` | A szerveren lévő mappa nem a 1001-es felhasználóé | 6.1 lépés (`chown -R 1001:1001 /data/exlibrisvideo/storage`), majd **Restart**. |
| Tanúsítvány-figyelmeztetés marad | A DNS még nem a szerverre mutat, zárva a 80-as port, vagy Cloudflare-proxy van bekapcsolva | `Resolve-DnsName`; Hetzner tűzfal 80/443; Cloudflare-nél ideiglenesen szürke felhő; a web **Redeploy**. |
| Nem érkeznek e-mailek | `EMAIL_PROVIDER=console`; nincs hitelesítve a Resend-domain; a Hetzner tiltja a 25/465-ös portot | Worker napló `[email]` sorai; Resend **Domains** → Verified; SMTP-nél 587-es port; spam mappa. |
| AI-hiba (pl. 401, „insufficient balance”) | Hibás kulcs vagy elfogyott egyenleg | Worker napló `[ai]` sorai; ellenőrizd a kulcsot és az egyenleget a szolgáltatónál. |
| Mindenki „túl sok kérés” (429) hibát kap | Cloudflare-proxy mögött minden kérés azonos IP-ről jön | [13. fejezet](#13-valódi-látogatói-ip-cloudflare). |
| Egy katalógus a frissítés után „feldolgozás alatt” ragadt | A worker frissítése vagy összeomlása félbeszakított egy videóelemzést | Várj 5–7 percet: a futó worker magától visszateszi a sorba a gazdátlan feladatot, és újrakezdi. Ha nincs futó worker (a naplóban nincs `[worker] ready`), indítsd el (**Restart**). Lásd a 12. fejezet tippjét. |
| A build `npm ci` vagy `next build` közben elhal („Killed”, „out of memory”) | Kevés a memória a szerveren | Nagyobb szerver, vagy swap bekapcsolása (lent). |

Swap (virtuális memória) bekapcsolása kis memóriájú szerveren:

**Ez a gazdagépen fut: Coolify → Terminal → localhost**

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```
