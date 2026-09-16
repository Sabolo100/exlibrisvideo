import { defineMessages } from '../define';

/** Area "landing": landing page, how-it-works, filming tips, FAQ, demo, header/footer extras. Only the owning module adds keys here. */
export const landing = defineMessages({
  hu: {
    'meta.title': 'Ex Libris Video – könyvespolc-videóból könyvkatalógus',
    'meta.description':
      'Vedd fel telefonnal a könyvespolcodat, és pár perc alatt böngészhető, szép katalógust kapsz saját linken, Excel-exporttal. Ingyenes, regisztráció nélkül.',

    'hero.eyebrow': 'Ingyenes · regisztráció nélkül',
    'hero.title': 'Filmezd le a könyvespolcodat – mi katalógust készítünk belőle',
    'hero.lead':
      'Egy lassú pásztázás a telefonoddal, és a mesterséges intelligencia kiolvassa a gerinceket. Pár perc múlva ott a könyvtárad egy saját linken: polcnézettel, borítókkal, statisztikákkal és Excel-exporttal.',
    'hero.leadShort':
      'Egy lassú pásztázás a telefonoddal, és pár perc múlva kész a könyvtárad katalógusa – saját linken, Excel-exporttal.',
    'hero.point.free': 'Ingyenes',
    'hero.point.noSignup': 'Nem kell regisztrálni',
    'hero.point.languages': 'Magyar és idegen nyelvű könyvek',
    'hero.illustration': 'Illusztráció: klasszikus magyar regények egy könyvespolcon, amelyeket egy telefon épp végigpásztáz',
    'hero.recognised': 'Felismerve',
    'hero.found': '{count} könyv a polcon',
    'hero.found_one': '{count} könyv a polcon',
    'hero.demo': 'Nézz meg egy kész katalógust',

    'how.eyebrow': 'Hogyan működik?',
    'how.title': 'Három lépés, és kész',
    'how.step': '{n}. lépés',
    'how.step1.title': 'Vedd fel a polcot',
    'how.step1.text': 'Telefonnal, lassan végigpásztázva a gerinceken. Egy polcsor, egy rövid klip – ennyi az egész.',
    'how.step2.title': 'Töltsd fel',
    'how.step2.text': 'Húzd ide a videót, vagy vedd fel közvetlenül a böngészőben. Ha megadod az e-mail-címed, szólunk, amikor kész.',
    'how.step3.title': 'Böngészd a katalógust',
    'how.step3.text':
      'Néhány perc múlva kész: virtuális polc, borítófal, táblázat és statisztikák. Javíthatsz, szűrhetsz, és letöltheted a listát.',

    'tips.eyebrow': 'Forgatási tippek',
    'tips.title': 'Így lesz a legjobb a felvétel',
    'tips.lead': 'A felismerés pontossága leginkább a videón múlik. Ez a hat egyszerű szabály sokat segít.',
    'tips.distance.title': '20–40 cm távolság',
    'tips.distance.text': 'Elég közel ahhoz, hogy a betűk jól olvashatók legyenek, de egyszerre több könyv is látsszon.',
    'tips.pan.title': 'Lassú, egyenletes pásztázás',
    'tips.pan.text':
      'Nagyjából egy könyvszélességnyit haladj fél másodperc alatt. Polcsoronként egy klip, vagy lassan kígyózva, soronként.',
    'tips.light.title': 'Jó fény',
    'tips.light.text': 'Filmezz nappal vagy felkapcsolt lámpánál. Sötétben a telefon bemozdult, zajos képet készít.',
    'tips.glare.title': 'Kerüld a tükröződést',
    'tips.glare.text': 'A fényes, fóliázott gerinceken megcsillan a lámpa. Filmezz kicsit oldalról, és ne használj vakut.',
    'tips.upright.title': 'Álló gerincek',
    'tips.upright.text': 'Úgy tartsd a telefont, hogy a könyvek a képen is egyenesen álljanak, ne dőljenek oldalra.',
    'tips.clips.title': 'Több rövid klip is jó',
    'tips.clips.text': 'Nem kell egyetlen hosszú felvétel: tölts fel nyugodtan több részletet, az ismétlődéseket kiszűrjük.',

    'get.eyebrow': 'Mit kapsz?',
    'get.title': 'A polcodból böngészhető könyvtár lesz',
    'get.lead': 'Egy saját linken minden egy helyen – telefonon és számítógépen is.',
    'get.shelf.title': 'Virtuális könyvespolc',
    'get.shelf.text': 'A könyveid gerincei fapolcon, ahogy otthon is állnak – akár a valódi gerincfotókkal.',
    'get.covers.title': 'Borítófal',
    'get.covers.text': 'Borítók és rövid leírások. Ahol nincs borító, szép tipografikus borítót rajzolunk.',
    'get.stats.title': 'Statisztikák',
    'get.stats.text': 'Kedvenc szerzők, témák, évtizedek és nyelvek – meg az is, hány méternyi könyved van.',
    'get.stats.books': 'könyv',
    'get.stats.authors': 'szerző',
    'get.stats.metres': 'méter polc',
    'get.table.title': 'Szerkeszthető táblázat',
    'get.table.text': 'Keresés, szűrés, rendezés, csoportos javítás, olvasási állapot és értékelés.',
    'get.table.author': 'Szerző',
    'get.table.bookTitle': 'Cím',
    'get.table.year': 'Év',
    'get.email.title': 'Excel e-mailben',
    'get.email.text': 'Letöltés Excelben, CSV-ben, PDF-ben vagy Goodreads-formátumban – a listát e-mailben is elküldjük.',
    'get.email.subject': 'Elkészült a katalógusod',
    'get.email.from': 'Ex Libris Video',
    'get.email.attachment': 'konyvtaram.xlsx',
    'get.email.body': '248 könyv, 5 formátumban letölthető',

    'privacy.eyebrow': 'Adatvédelem',
    'privacy.title': 'A polcod a tiéd marad',
    'privacy.lead': 'Csak annyi adatot kezelünk, amennyi a katalógusodhoz feltétlenül szükséges.',
    'privacy.point1': 'Nem kell fiókot létrehoznod, és az e-mail-címed megadása sem kötelező.',
    'privacy.point2':
      'Az eredeti videót a feldolgozás után töröljük. Csak a kiválasztott képkockák és a gerincfotók maradnak meg, amíg a katalógus létezik.',
    'privacy.point3': 'A katalógust csak az látja, akinek megadod a linket – ha szeretnéd, PIN-kóddal is levédheted.',
    'privacy.point4': 'Az adatokat az Európai Unióban, a Hetzner szerverein tároljuk, és bármikor véglegesen törölheted őket.',
    'privacy.more': 'Az adatkezelési tájékoztató elolvasása',

    'faq.eyebrow': 'Gyakori kérdések',
    'faq.title': 'Kérdésed van?',
    'faq.accuracy.q': 'Mennyire pontos a felismerés?',
    'faq.accuracy.a':
      'Éles, jól megvilágított felvételen a gerincek nagy többségét helyesen olvassuk ki. A kopott, apró betűs, fényes vagy nagyon vékony gerincek nehezebbek: a bizonytalan találatokat megjelöljük, és egy külön ellenőrző nézetben gyorsan kijavíthatod őket. A pontosság leginkább a videó minőségén múlik – ebben segítenek a forgatási tippek.',
    'faq.time.q': 'Mennyi ideig tart?',
    'faq.time.a':
      'A feltöltés a fájl méretétől és az internetkapcsolattól függ. Egy néhány perces videó feldolgozása általában 2–10 perc. Ha a feltöltés befejeződött, nyugodtan bezárhatod az oldalt: ha megadtad az e-mail-címedet, szólunk, amikor kész.',
    'faq.cost.q': 'Mennyibe kerül?',
    'faq.cost.a': 'Semmibe. Az Ex Libris Video ingyenes: nincs regisztráció, nincs előfizetés, és bankkártyát sem kérünk.',
    'faq.privacy.q': 'Ki látja a katalógusomat?',
    'faq.privacy.a':
      'Csak az, akinek megadod a linket. A link egy véletlenszerű, 9 jegyű számra végződik, és ha szeretnéd, PIN-kóddal is levédheted. Szerkeszteni csak a tulajdonosi linkkel lehet, amelyet csak te kapsz meg.',
    'faq.video.q': 'Mi történik a videómmal?',
    'faq.video.a':
      'A feldolgozás után automatikusan töröljük. Csak a kiválasztott képkockákat és a könyvgerincekről kivágott fotókat őrizzük meg, hogy ellenőrizhesd a felismerést – ezek is törlődnek, amikor a katalógust törlöd.',
    'faq.editing.q': 'Kijavíthatom a rosszul felismert könyveket?',
    'faq.editing.a':
      'Igen. A tulajdonosi linkkel szerkesztheted a címeket és a szerzőket, törölhetsz és összevonhatsz tételeket, kézzel is felvehetsz könyveket, és azt is megjelölheted, mit olvastál már.',
    'faq.shelves.q': 'Több könyvespolcom is van. Hogyan vegyem fel őket?',
    'faq.shelves.a':
      'Polcsoronként készíts egy-egy rövid videót, és töltsd fel őket egyszerre – egy katalógusba legfeljebb {maxFiles} fájl fér. Később is hozzáadhatsz újabbakat, a már felismert könyveket pedig nem vesszük fel kétszer.',
    'faq.exports.q': 'Milyen formátumban tölthetem le a listát?',
    'faq.exports.a':
      'Excel (.xlsx), CSV, nyomtatható PDF, JSON és Goodreads-kompatibilis CSV formátumban. Kérésre az Excel-táblázatot e-mailben is elküldjük.',
    'faq.lost.q': 'Elvesztettem a linket. Mit tehetek?',
    'faq.lost.a':
      'Ha megadtad az e-mail-címedet, a Kollekcióim oldalon kérhetsz új belépő linket. Ugyanabban a böngészőben a Kollekcióim oldal a korábban megnyitott katalógusaidat is felsorolja.',

    'cta.title': 'Vedd elő a telefonod, és kezdd a kedvenc polcoddal',
    'cta.text': 'Egy perc felvétel, néhány perc várakozás – és a könyvtárad ott lesz a zsebedben.',
    'cta.upload': 'Töltsd fel a polcvideódat',
    'cta.demo': 'Minta könyvtár megtekintése',
    'cta.my': 'Korábbi katalógusaim',

    'notFound.eyebrow': '404-es hiba',
    'notFound.title': 'Ez a könyv nincs a polcon',
    'notFound.text':
      'Nem találjuk ezt az oldalt vagy katalógust. Lehet, hogy elírás van a linkben, vagy a katalógust időközben törölték.',
    'notFound.findTitle': 'Keresd meg az azonosítója alapján',
    'notFound.home': 'Kezdőlap',
    'notFound.my': 'Kollekcióim',
    'notFound.illustration': 'Három könyvgerinc a polcon, rajtuk a 4, a 0 és a 4 számjegy',

    'error.eyebrow': 'Hiba',
    'error.title': 'Hoppá, valami elakadt',
    'error.text': 'Váratlan hiba történt az oldal betöltése közben. Próbáld újra – ha nem sikerül, térj vissza a kezdőlapra.',
    'error.retry': 'Újrapróbálom',
    'error.home': 'Kezdőlap',
    'error.code': 'Hibakód: {code}',
  },
  en: {
    'meta.title': 'Ex Libris Video – turn a bookshelf video into a book catalogue',
    'meta.description':
      'Film your bookshelf with your phone and within minutes get a beautiful, browsable catalogue at your own link, with Excel export. Free, no sign-up.',

    'hero.eyebrow': 'Free · no sign-up',
    'hero.title': 'Film your bookshelf – we’ll turn it into a catalogue',
    'hero.lead':
      'One slow pan with your phone, and AI reads the spines. A few minutes later your library is waiting at its own link – with a shelf view, covers, statistics and an Excel export.',
    'hero.leadShort': 'One slow pan with your phone, and a few minutes later your library catalogue is ready – at its own link, with Excel export.',
    'hero.point.free': 'Free',
    'hero.point.noSignup': 'No sign-up',
    'hero.point.languages': 'Hungarian and foreign-language books',
    'hero.illustration': 'Illustration: Hungarian classic novels on a bookshelf, being scanned by a phone',
    'hero.recognised': 'Recognised',
    'hero.found': '{count} books on the shelf',
    'hero.found_one': '{count} book on the shelf',
    'hero.demo': 'See a finished catalogue',

    'how.eyebrow': 'How it works',
    'how.title': 'Three steps and you’re done',
    'how.step': 'Step {n}',
    'how.step1.title': 'Film your shelf',
    'how.step1.text': 'With your phone, panning slowly along the spines. One shelf row, one short clip – that’s all.',
    'how.step2.title': 'Upload it',
    'how.step2.text': 'Drop the video here or record it right in your browser. Leave your e-mail address and we’ll tell you when it’s ready.',
    'how.step3.title': 'Browse your catalogue',
    'how.step3.text':
      'Ready in a few minutes: a virtual shelf, a cover wall, a table and statistics. Fix, filter and download the list as you like.',

    'tips.eyebrow': 'Filming tips',
    'tips.title': 'How to get the best recording',
    'tips.lead': 'Recognition accuracy depends mostly on the video. These six simple rules help a lot.',
    'tips.distance.title': 'Stay 20–40 cm away',
    'tips.distance.text': 'Close enough for the letters to be easy to read, yet far enough to see several books at once.',
    'tips.pan.title': 'Slow, steady pan',
    'tips.pan.text': 'Move about one book width every half second. One clip per shelf row, or a slow zig-zag, row by row.',
    'tips.light.title': 'Good light',
    'tips.light.text': 'Film in daylight or with the lights on. In the dark, phones record blurry, noisy footage.',
    'tips.glare.title': 'Avoid glare',
    'tips.glare.text': 'Glossy, laminated spines reflect lamps. Film slightly from the side and keep the flash off.',
    'tips.upright.title': 'Keep spines upright',
    'tips.upright.text': 'Hold the phone so the books stand straight in the picture too, not tilted to one side.',
    'tips.clips.title': 'Several short clips are fine',
    'tips.clips.text': 'No need for one long take: upload several clips, and we’ll filter out the repeats.',

    'get.eyebrow': 'What you get',
    'get.title': 'Your shelf becomes a library you can browse',
    'get.lead': 'Everything in one place at your own link – on your phone and your computer.',
    'get.shelf.title': 'Virtual bookshelf',
    'get.shelf.text': 'Your book spines on wooden shelves, just as they stand at home – even with the real spine photos.',
    'get.covers.title': 'Cover wall',
    'get.covers.text': 'Covers and short descriptions. Where there’s no cover, we draw a handsome typographic one.',
    'get.stats.title': 'Statistics',
    'get.stats.text': 'Top authors, topics, decades and languages – and how many metres of books you own.',
    'get.stats.books': 'books',
    'get.stats.authors': 'authors',
    'get.stats.metres': 'metres of shelf',
    'get.table.title': 'Editable table',
    'get.table.text': 'Search, filter, sort, bulk edit, reading status and ratings.',
    'get.table.author': 'Author',
    'get.table.bookTitle': 'Title',
    'get.table.year': 'Year',
    'get.email.title': 'Excel by e-mail',
    'get.email.text': 'Download as Excel, CSV, PDF or Goodreads format – and we’ll e-mail you the list too.',
    'get.email.subject': 'Your catalogue is ready',
    'get.email.from': 'Ex Libris Video',
    'get.email.attachment': 'my-library.xlsx',
    'get.email.body': '248 books, downloadable in 5 formats',

    'privacy.eyebrow': 'Privacy',
    'privacy.title': 'Your shelf stays yours',
    'privacy.lead': 'We only handle the data your catalogue really needs.',
    'privacy.point1': 'You don’t need an account, and giving your e-mail address is optional.',
    'privacy.point2':
      'We delete the original video after processing. Only the selected frames and spine photos are kept, for as long as the catalogue exists.',
    'privacy.point3': 'Only people you give the link to can see the catalogue – and you can protect it with a PIN if you like.',
    'privacy.point4': 'Data is stored in the European Union on Hetzner servers, and you can delete it permanently at any time.',
    'privacy.more': 'Read the privacy policy',

    'faq.eyebrow': 'FAQ',
    'faq.title': 'Questions?',
    'faq.accuracy.q': 'How accurate is the recognition?',
    'faq.accuracy.a':
      'On a sharp, well-lit recording we read the large majority of spines correctly. Worn, small-print, glossy or very thin spines are harder: we flag uncertain matches so you can fix them quickly in a dedicated review view. Accuracy depends mostly on the video quality – that’s what the filming tips are for.',
    'faq.time.q': 'How long does it take?',
    'faq.time.a':
      'Uploading depends on the file size and your connection. Processing a video of a few minutes usually takes 2–10 minutes. Once the upload has finished you can close the page: if you left your e-mail address, we’ll let you know when it’s ready.',
    'faq.cost.q': 'How much does it cost?',
    'faq.cost.a': 'Nothing. Ex Libris Video is free: no sign-up, no subscription, and we never ask for a card.',
    'faq.privacy.q': 'Who can see my catalogue?',
    'faq.privacy.a':
      'Only the people you share the link with. The link ends in a random 9-digit number, and you can protect it with a PIN if you like. Editing is only possible with the owner link, which only you receive.',
    'faq.video.q': 'What happens to my video?',
    'faq.video.a':
      'We delete it automatically after processing. We only keep the selected frames and the photos cropped from the book spines so you can double-check the results – and those are deleted too when you delete the catalogue.',
    'faq.editing.q': 'Can I fix books that were recognised wrongly?',
    'faq.editing.a':
      'Yes. With the owner link you can edit titles and authors, delete and merge entries, add books by hand, and mark what you’ve already read.',
    'faq.shelves.q': 'I have several bookcases. How do I add them?',
    'faq.shelves.a':
      'Make a short video per shelf row and upload them together – one catalogue holds up to {maxFiles} files. You can add more later, and books we’ve already found won’t be added twice.',
    'faq.exports.q': 'Which formats can I download the list in?',
    'faq.exports.a':
      'Excel (.xlsx), CSV, printable PDF, JSON and Goodreads-compatible CSV. We can also e-mail you the Excel spreadsheet.',
    'faq.lost.q': 'I lost my link. What can I do?',
    'faq.lost.a':
      'If you left your e-mail address, you can request a new sign-in link on the My collections page. In the same browser, My collections also lists the catalogues you opened before.',

    'cta.title': 'Grab your phone and start with your favourite shelf',
    'cta.text': 'A minute of filming, a few minutes of waiting – and your library is in your pocket.',
    'cta.upload': 'Upload your shelf video',
    'cta.demo': 'View the sample library',
    'cta.my': 'My earlier catalogues',

    'notFound.eyebrow': 'Error 404',
    'notFound.title': 'This book isn’t on the shelf',
    'notFound.text':
      'We can’t find this page or catalogue. The link may contain a typo, or the catalogue may have been deleted in the meantime.',
    'notFound.findTitle': 'Find it by its ID',
    'notFound.home': 'Home page',
    'notFound.my': 'My collections',
    'notFound.illustration': 'Three book spines on a shelf, showing the digits 4, 0 and 4',

    'error.eyebrow': 'Error',
    'error.title': 'Oops, something got stuck',
    'error.text': 'Something went wrong while loading the page. Please try again – if that doesn’t help, go back to the home page.',
    'error.retry': 'Try again',
    'error.home': 'Home page',
    'error.code': 'Error code: {code}',
  },
});
