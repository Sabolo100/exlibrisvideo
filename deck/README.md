# Ex Libris Video — befektetői és szponzori prezentáció

Teljes képernyős, jobbra-balra léptethető HTML-prezentáció potenciális szponzoroknak és befektetőknek (a teljes
rendszer megvásárlását is beleértve). Élő címe: **https://www.exlibrisvideo.hu/deck** — az app sehonnan nem linkel
rá, csak a cím ismeretében nyitható meg; `noindex` (meta + `X-Robots-Tag` fejléc a `next.config.ts`-ben).

Az `arworks-web-presentation-builder` skill héjára épül (1280×720-as vászon, áttekintő nézet, indítókapu,
teljes képernyő, nyomtatás), az app arculatával (Fraunces + Inter, diófa, aranyfólia, palackzöld).

## Fájlok

| Fájl | Szerep |
|---|---|
| `deck/build.mjs` | a diák tartalma és szerkezete → `public/deck/index.html` (a verzió: `DECK_VERSION`) |
| `deck/media.mjs` | a média előállítása (videók, képek, gerincfotók, felismerési adat) → `public/deck/media/` |
| `public/deck/assets/deck.css` | héj + diánkénti stílus és mozgás |
| `public/deck/assets/deck.js` | lapozás, áttekintés, ablakok, videószinkron, a címlap felismerési dobozai, számlálók |
| `public/deck/assets/fonts/` | Fraunces és Inter (latin + latin-ext, a `@fontsource-variable` csomagokból) |

## Használat

```bash
node deck/media.mjs     # csak ha a forrásmédia változott (promo/out, Mintavideok, storage — ezek nincsenek a repóban)
node deck/build.mjs     # minden szöveg- vagy stílusváltozás után
```

Billentyűk: `←` `→` lapozás · `O` áttekintés · `F` teljes képernyő · `B` sötét képernyő · `Home`/`End`.
Mélylink: `/deck#7` (a kapu nélkül indul a 7. diánál). Nyomtatás/PDF: diánként egy oldal.

## A diák

| # | Dia | Üzenet | „Poén” (kódból) |
|---|---|---|---|
| 1 | Címlap | Elég egy videó | a valódi 9,6 mp-es polcvideón a valódi felismerési dobozok, számláló, a gerincfotók a polcra érkeznek |
| 2 | Probléma | Sok könyv, semmi lista | szellemkép → valódi polcfotó |
| 3 | Kézzel vs. videóval | Gépelés helyett pásztázás | gépelés-verseny két órával (illusztráció) |
| 4 | Így működik | Három lépés | vándorló pont, felgyúló lépések |
| 5 | Felvétel | Egy lassú pásztázás | képernyőfelvétel + a videóhoz kötött lépéslista |
| 6 | Feldolgozás | Közben megtelik a polc | ugyanaz |
| 7 | Gerincenként olvas | Nem találgat | letapogató sáv a valódi gerincfotókon, „begépelődő” olvasat, valódi megbízhatóság |
| 8 | Mérés | Mérve, nem becsülve | régi/új sávok, tizedes számlálók |
| 9 | Kilenc nézet | Egy könyvtár, sok nézet | a böngészőben váltakozó nézetek, velük együtt váltó jelölők |
| 10 | Valódi gerincek | Könyvlap | képernyőfelvétel + buborékok a videó idejéhez kötve |
| 11 | Telefonon | Zsebben a könyvtár | két képernyőfelvétel, szinkron menü |
| 12 | Export | Az adat a tiéd | a formátumok akkor gyúlnak fel, amikor a videóban kinyílik az exportmenü |
| 13 | Felépítés | Egyszerű, cserélhető, EU | áramló adatvonalak, pulzusok |
| 14 | Idővonal | Öt hét, húsz kiadás | kiadásszámláló, telő polc, „most” jel, javaslatok |
| 15 | Piac | Kinek ér pénzt | csempék rajzolódó ikonokkal, állapotcímkék |
| 16 | Szponzoráció | Ott, ahol a könyv él | koncepció-jelölők a valódi könyvlapon |
| 17 | Átvétel | Kulcsrakészen | kipipálódó lista |
| 18 | Kapcsolat | Írjuk tovább együtt | gyűrűző gomb, promóvideó |

Részletes ablakok: a felismerés menete, a mérés táblázata, technológia és adatvédelem, az átvétel tartalma.

## Tények forrása

Mérés: `scripts/eval-recognition.ts` fejléce; tesztek: `npx vitest run` (1061 teszt, 2026-10-19);
kiadások: `CHANGELOG.md`; felépítés és adatvédelem: `SPEC.md`, `COOLIFY.md`. Piaci számokat szándékosan nem
tartalmaz (nincsenek mért adatok); a szegmensek és a szponzori helyek „irány” / „koncepció” jelölést kapnak.

## Változásnapló

- **1.0.0 – 2026-10-19** — első változat: 18 dia, magyar nyelven, a promóvideó képernyőfelvételeivel és a
  minta-polcvideó valódi felismerési adataival.
