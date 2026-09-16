import { defineMessages } from '../define';

/** Area "legal": privacy and terms pages. Only the owning module adds keys here. */
export const legal = defineMessages({
  hu: {
    toc: 'Tartalom',
    placeholder: 'Kitöltendő adat',
    'contact.label': 'E-mail',
    'related.title': 'Lásd még',
    'related.privacy': 'Adatkezelési tájékoztató',
    'related.terms': 'Felhasználási feltételek',
    backToTop: 'Vissza az elejére',

    /* ---------------- privacy ---------------- */
    'privacy.meta.title': 'Adatkezelési tájékoztató',
    'privacy.meta.description':
      'Közérthetően arról, hogyan kezeli az Ex Libris Video a feltöltött videókat, a könyvlistát és az e-mail-címedet.',
    'privacy.title': 'Adatkezelési tájékoztató',
    'privacy.intro':
      'Röviden: csak annyi adatot kezelünk, amennyi a katalógusod elkészítéséhez és megjelenítéséhez kell. Nem kell fiókot létrehoznod, nem használunk hirdetési vagy követő sütiket, a feltöltött videót pedig a feldolgozás után töröljük. Alább részletesen és közérthetően leírjuk, mi történik az adataiddal.',
    'privacy.updated': 'Hatályos: 2026. szeptember 13.',

    'privacy.controller.title': '1. Ki kezeli az adataidat?',
    'privacy.controller.p1': 'Az adatkezelő az Ex Libris Video szolgáltatás üzemeltetője:',
    'privacy.controller.placeholder':
      '[Az üzemeltető neve, székhelye vagy címe, cégjegyzékszáma vagy nyilvántartási száma, adószáma – kitöltendő]',
    'privacy.controller.p2': 'Adatvédelmi kérdésekben ezen az e-mail-címen érsz el minket:',

    'privacy.data.title': '2. Milyen adatokat kezelünk?',
    'privacy.data.item1':
      'A könyvespolcodról feltöltött videókat és fotókat. Kérjük, csak a polcot filmezd: ne kerüljenek a felvételre emberek, iratok vagy más személyes tárgyak.',
    'privacy.data.item2': 'A felvételekből kiválasztott képkockákat és a könyvgerincekről kivágott fotókat.',
    'privacy.data.item3':
      'A felismert könyvlistát és mindazt, amit te adsz meg: a katalógus címét, a nevedet, megjegyzéseket, olvasási állapotot, értékelést és kölcsönzési adatokat (például hogy kinek adtad kölcsön a könyvet).',
    'privacy.data.item4': 'Az e-mail-címedet, ha megadod. Ez nem kötelező.',
    'privacy.data.item5':
      'Technikai adatokat: az IP-címedet a visszaélések kiszűréséhez (kéréskorlátozás), a böngésző által küldött alapadatokat (például a nyelvi beállítást) és a lent felsorolt, működéshez szükséges sütiket.',
    'privacy.data.p1': 'Nem kérünk jelszót vagy bankkártyaadatot, és nem készítünk rólad profilt.',

    'privacy.purpose.title': '3. Mire használjuk, és milyen jogalapon?',
    'privacy.purpose.item1':
      'A katalógus elkészítésére, tárolására és megjelenítésére – ez maga a szolgáltatás, amelyet a feltöltéssel kérsz (GDPR 6. cikk (1) bekezdés b) pont).',
    'privacy.purpose.item2':
      'A kész katalógusról szóló értesítés, az exportok és a belépő linkek e-mailes küldésére – a hozzájárulásod alapján, amelyet az e-mail-cím megadásával adsz meg, és bármikor visszavonhatsz (GDPR 6. cikk (1) bekezdés a) pont).',
    'privacy.purpose.item3':
      'A szolgáltatás biztonságára, a visszaélések és a túlterhelés megelőzésére – jogos érdekünk alapján (GDPR 6. cikk (1) bekezdés f) pont).',
    'privacy.purpose.p1': 'Hírlevelet nem küldünk, az adataidat nem adjuk el, és reklámcélra sem használjuk.',

    'privacy.ai.title': '4. Mesterséges intelligencia és adatfeldolgozók',
    'privacy.ai.p1':
      'A könyvgerincek kiolvasásához a kiválasztott képkockákat, a könyvek témák szerinti besorolásához pedig a felismert címeket és szerzőket külső mesterségesintelligencia-szolgáltatóknak küldjük. Ezek a szolgáltatók a megbízásunkból, adatfeldolgozóként járnak el:',
    'privacy.ai.item1': 'Anthropic PBC (Claude modellek) – Amerikai Egyesült Államok',
    'privacy.ai.item2': 'DeepSeek (DeepSeek modellek) – Kínai Népköztársaság',
    'privacy.ai.p2':
      'Az Európai Unión kívülre történő adattovábbításnál a GDPR V. fejezetében előírt garanciákra, például az Európai Bizottság általános szerződési feltételeire támaszkodunk. A szolgáltatóknak csak a feldolgozáshoz szükséges képkockákat és szövegeket adjuk át – a nevedet és az e-mail-címedet soha.',
    'privacy.ai.p3':
      'A borítók és a kiadási adatok kereséséhez a könyvek címét és szerzőjét elküldjük az Open Library (Internet Archive) és a Google Books nyilvános keresőjének. Ezek a kérések rólad nem tartalmaznak adatot.',
    'privacy.ai.p4': 'Az e-mailek kiküldéséhez e-mail-szolgáltatót veszünk igénybe:',
    'privacy.ai.placeholder': '[Az e-mail-küldő szolgáltató neve és székhelye – kitöltendő]',

    'privacy.hosting.title': '5. Hol tároljuk az adatokat?',
    'privacy.hosting.p1':
      'A szolgáltatás, az adatbázis és a feltöltött fájlok a Hetzner Online GmbH (Németország) szerverein, az Európai Unión belüli adatközpontban vannak.',
    'privacy.hosting.p2':
      'Az adatokat titkosított kapcsolaton (HTTPS) továbbítjuk. A tulajdonosi kulcsnak és a PIN-kódnak csak egy visszafejthetetlen lenyomatát tároljuk, magát a kulcsot és a kódot nem.',

    'privacy.retention.title': '6. Meddig őrizzük az adatokat?',
    'privacy.retention.item1': 'Az eredeti videót vagy fotót a sikeres feldolgozás után automatikusan töröljük.',
    'privacy.retention.item2':
      'A kiválasztott képkockákat és a gerincfotókat addig őrizzük, amíg a katalógus létezik, hogy ellenőrizhesd és javíthasd a felismerést.',
    'privacy.retention.item3': 'A katalógust, a könyvlistát és az e-mail-címedet addig tároljuk, amíg nem törlöd őket.',
    'privacy.retention.item4': 'A félbemaradt feltöltéseket 24 óra, a feltöltés nélküli üres katalógusokat 7 nap elteltével töröljük.',
    'privacy.retention.item5': 'A kéréskorlátozáshoz használt technikai adatokat (például az IP-címhez tartozó számlálót) legfeljebb két napig őrizzük.',

    'privacy.cookies.title': '7. Sütik és helyi tárolás',
    'privacy.cookies.p1':
      'Csak a működéshez feltétlenül szükséges sütiket használunk, ezért nem kérünk hozzájárulást sütikhez. Nincs hirdetési, statisztikai vagy követő süti.',
    'privacy.cookies.item1': 'exl_own_… – azt jelzi, hogy ebben a böngészőben te vagy a katalógus tulajdonosa (legfeljebb 400 napig).',
    'privacy.cookies.item2': 'exl_pin_… – megjegyzi, hogy megadtad egy védett katalógus PIN-kódját (legfeljebb 180 napig).',
    'privacy.cookies.item3': 'exl_seen_… – hogy egy megnyitást ne számoljunk többször (30 percig).',
    'privacy.cookies.item4': 'exl_lang – a választott nyelv (1 évig).',
    'privacy.cookies.p2':
      'A böngésződ helyi tárolójában (localStorage) tartjuk a Kollekcióim listát – benne a tulajdonosi kulcsokkal – és a választott színtémát. Ezek nem kerülnek a szerverre, és a böngészőadatok törlésével eltávolíthatod őket.',

    'privacy.rights.title': '8. A jogaid',
    'privacy.rights.p1': 'A GDPR alapján bármikor kérheted, hogy:',
    'privacy.rights.item1': 'tájékoztassunk a rólad kezelt adatokról, és adjunk róluk másolatot (hozzáférés);',
    'privacy.rights.item2': 'javítsuk ki a pontatlan adatokat (helyesbítés);',
    'privacy.rights.item3': 'töröljük az adataidat, vagy korlátozzuk a kezelésüket;',
    'privacy.rights.item4': 'géppel olvasható formában adjuk át az adataidat (adathordozhatóság) – erre a katalógus exportjai is lehetőséget adnak;',
    'privacy.rights.item5': 'ne kezeljük tovább az adataidat jogos érdekünk alapján (tiltakozás); a hozzájárulásodat pedig bármikor visszavonhatod.',
    'privacy.rights.p2':
      'A katalógust a beállításokban magad is bármikor véglegesen törölheted: ezzel azonnal törlődik minden hozzá tartozó adat, képkocka és fotó. Az e-mail-címedet ugyanott módosíthatod vagy törölheted.',
    'privacy.rights.p3':
      'Mivel nincs felhasználói fiók, a kérésed teljesítése előtt megkérhetünk, hogy igazold, a katalógus a tiéd (például a tulajdonosi linkkel, vagy a katalógusnál megadott e-mail-címről írva). Legkésőbb egy hónapon belül válaszolunk.',
    'privacy.rights.p4':
      'Ha úgy érzed, megsértettük az adatvédelmi jogaidat, panaszt tehetsz a Nemzeti Adatvédelmi és Információszabadság Hatóságnál (NAIH, www.naih.hu), vagy bírósághoz fordulhatsz.',

    'privacy.children.title': '9. Gyerekek',
    'privacy.children.p1': 'Ha 16 évesnél fiatalabb vagy, az e-mail-címedet csak a szüleid hozzájárulásával add meg.',

    'privacy.changes.title': '10. Változások és kapcsolat',
    'privacy.changes.p1':
      'Ha ez a tájékoztató lényegesen megváltozik, azt ezen az oldalon, a hatálybalépés dátumával együtt jelezzük. Kérdésed van? Írj nekünk:',

    /* ---------------- terms ---------------- */
    'terms.meta.title': 'Felhasználási feltételek',
    'terms.meta.description':
      'Az Ex Libris Video használatának feltételei közérthetően: mit tölthetsz fel, meddig tároljuk, és miért vállalunk felelősséget.',
    'terms.title': 'Felhasználási feltételek',
    'terms.intro':
      'Az Ex Libris Video ingyenes szolgáltatás, amely a könyvespolcodról készült videóból vagy fotókból könyvkatalógust készít. A szolgáltatás használatával elfogadod az alábbi, egyszerűen megfogalmazott feltételeket.',
    'terms.updated': 'Hatályos: 2026. szeptember 13.',

    'terms.provider.title': '1. A szolgáltató',
    'terms.provider.p1': 'A szolgáltatást az alábbi üzemeltető nyújtja:',
    'terms.provider.placeholder':
      '[Az üzemeltető neve, székhelye vagy címe, cégjegyzékszáma vagy nyilvántartási száma, adószáma – kitöltendő]',

    'terms.service.title': '2. A szolgáltatás',
    'terms.service.p1':
      'Feltöltheted a könyvespolcodról készült videókat vagy fotókat. A rendszer mesterséges intelligencia segítségével felismeri a könyveket, és egy saját linken elérhető, szerkeszthető katalógust készít belőlük, amelyet több formátumban letölthetsz, illetve e-mailben is megkaphatsz.',
    'terms.service.p2':
      'A szolgáltatás ingyenes, és „ahogy van” alapon érhető el. Folyamatosan fejlesztjük, ezért egyes funkciói változhatnak, és karbantartás miatt időnként szünetelhet.',

    'terms.use.title': '3. Mit tölthetsz fel?',
    'terms.use.item1': 'Csak olyan felvételt tölts fel, amelyet te készítettél, vagy amelynek a felhasználására jogod van.',
    'terms.use.item2': 'A felvételen a könyvespolc szerepeljen. Ne filmezz embereket, személyes iratokat vagy más érzékeny tartalmat.',
    'terms.use.item3':
      'Tilos jogsértő vagy sértő tartalmat feltölteni, a szolgáltatást túlterhelni, vagy a rendeltetésétől eltérő célra használni.',
    'terms.use.item4':
      'Egy fájl legfeljebb {maxSize} méretű és {maxDuration} hosszú lehet, egy katalógusba legfeljebb {maxFiles} fájl kerülhet. A visszaélések megelőzése érdekében a kérések számát korlátozhatjuk.',

    'terms.accuracy.title': '4. A felismerés pontossága',
    'terms.accuracy.p1':
      'A könyveket mesterséges intelligencia ismeri fel, amely tévedhet: kihagyhat könyveket, félreolvashat címeket vagy szerzőket. Ellenőrizd a katalógus tartalmát, és szükség esetén javítsd. A felismerés helyességéért, valamint a borítók és a kiegészítő adatok (például a kiadási év vagy a leírás) pontosságáért nem vállalunk felelősséget.',

    'terms.link.title': '5. A katalógus linkje és a tulajdonosi link',
    'terms.link.item1': 'A katalógust bárki megtekintheti, aki ismeri a linkjét. Ha ezt szeretnéd elkerülni, kapcsold be a PIN-kódos védelmet.',
    'terms.link.item2':
      'A tulajdonosi linkkel a katalógus szerkeszthető és törölhető. Tartsd titokban: ha illetéktelen kézbe kerül, az ebből eredő változásokért nem felelünk.',
    'terms.link.item3':
      'Ha megadtad az e-mail-címedet, elveszett link esetén a Kollekcióim oldalon kérhetsz új, 24 óráig érvényes belépő linket.',

    'terms.rights.title': '6. Kié a tartalom?',
    'terms.rights.p1':
      'A feltöltött felvételek és a katalógus adatai a tieid maradnak. A feltöltéssel engedélyt adsz arra, hogy kizárólag a szolgáltatás nyújtásához szükséges mértékben tároljuk és feldolgozzuk őket (a mesterségesintelligencia-szolgáltatók bevonásával is), és megjelenítsük mindazoknak, akik ismerik a katalógus linkjét.',
    'terms.rights.p2':
      'A borítóképek az Open Library, illetve a Google Books szolgáltatásból származnak, és a jogtulajdonosaikat illetik; csak a katalógus megjelenítéséhez használjuk őket.',

    'terms.deletion.title': '7. Törlés és megszűnés',
    'terms.deletion.p1':
      'A katalógust a beállításokban bármikor véglegesen törölheted – ezzel minden hozzá tartozó adat és fájl törlődik. A feltöltés nélküli, üres katalógusokat 7 nap után automatikusan töröljük.',
    'terms.deletion.p2':
      'A feltételeket sértő tartalmat előzetes értesítés nélkül eltávolíthatjuk. Ha a szolgáltatást megszüntetjük, erről – ahol lehetséges – előre tájékoztatunk, hogy exportálhasd az adataidat.',

    'terms.liability.title': '8. Felelősség',
    'terms.liability.p1':
      'A szolgáltatást gondosan üzemeltetjük, de nem garantáljuk, hogy mindig hibamentesen és megszakítás nélkül működik. A jogszabályok által megengedett legnagyobb mértékben kizárjuk a felelősséget az adatvesztésből vagy a szolgáltatás használatából eredő közvetett károkért, ezért a fontos katalógusaidról rendszeresen készíts exportot. Ez a korlátozás nem érinti a fogyasztókat jogszabály alapján megillető jogokat.',

    'terms.law.title': '9. Irányadó jog és változások',
    'terms.law.p1':
      'A feltételekre a magyar jog irányadó. A feltételeket módosíthatjuk; a lényeges változásokról ezen az oldalon tájékoztatunk, és a módosítás után a szolgáltatás további használatával elfogadod az új feltételeket.',

    'terms.contact.title': '10. Kapcsolat',
    'terms.contact.p1': 'Kérdésed, panaszod vagy észrevételed van? Írj nekünk:',
  },
  en: {
    toc: 'Contents',
    placeholder: 'To be completed',
    'contact.label': 'E-mail',
    'related.title': 'See also',
    'related.privacy': 'Privacy policy',
    'related.terms': 'Terms of use',
    backToTop: 'Back to top',

    /* ---------------- privacy ---------------- */
    'privacy.meta.title': 'Privacy policy',
    'privacy.meta.description':
      'In plain language: how Ex Libris Video handles your uploaded videos, your book list and your e-mail address.',
    'privacy.title': 'Privacy policy',
    'privacy.intro':
      'In short: we only handle the data needed to create and show your catalogue. You don’t need an account, we use no advertising or tracking cookies, and we delete the uploaded video after processing. Below we explain in detail, in plain language, what happens to your data.',
    'privacy.updated': 'Effective: 13 September 2026',

    'privacy.controller.title': '1. Who is responsible for your data?',
    'privacy.controller.p1': 'The data controller is the operator of the Ex Libris Video service:',
    'privacy.controller.placeholder': '[Operator name, registered office or address, company or registration number, tax number – to be completed]',
    'privacy.controller.p2': 'For privacy questions, you can reach us at this e-mail address:',

    'privacy.data.title': '2. What data do we handle?',
    'privacy.data.item1':
      'The videos and photos of your bookshelf that you upload. Please film only the shelf: keep people, documents and other personal items out of the picture.',
    'privacy.data.item2': 'The frames selected from your recordings and the photos cropped from the book spines.',
    'privacy.data.item3':
      'The recognised book list and everything you add yourself: the catalogue title, your name, notes, reading status, ratings and lending details (for example who you lent a book to).',
    'privacy.data.item4': 'Your e-mail address, if you give it. This is optional.',
    'privacy.data.item5':
      'Technical data: your IP address to prevent abuse (rate limiting), basic data sent by your browser (such as the language setting), and the essential cookies listed below.',
    'privacy.data.p1': 'We never ask for a password or card details, and we don’t build a profile of you.',

    'privacy.purpose.title': '3. What do we use it for, and on what legal basis?',
    'privacy.purpose.item1':
      'To create, store and display your catalogue – the service you request by uploading (Article 6(1)(b) GDPR).',
    'privacy.purpose.item2':
      'To e-mail you when the catalogue is ready, and to send exports and sign-in links – based on the consent you give by entering your e-mail address, which you can withdraw at any time (Article 6(1)(a) GDPR).',
    'privacy.purpose.item3': 'To keep the service secure and prevent abuse and overload – based on our legitimate interest (Article 6(1)(f) GDPR).',
    'privacy.purpose.p1': 'We don’t send newsletters, we don’t sell your data, and we don’t use it for advertising.',

    'privacy.ai.title': '4. Artificial intelligence and processors',
    'privacy.ai.p1':
      'To read the book spines we send the selected frames, and to sort the books by topic we send the recognised titles and authors, to external AI providers. These providers act on our behalf as data processors:',
    'privacy.ai.item1': 'Anthropic PBC (Claude models) – United States of America',
    'privacy.ai.item2': 'DeepSeek (DeepSeek models) – People’s Republic of China',
    'privacy.ai.p2':
      'For transfers outside the European Union we rely on the safeguards required by Chapter V of the GDPR, such as the European Commission’s standard contractual clauses. The providers only receive the frames and text needed for processing – never your name or e-mail address.',
    'privacy.ai.p3':
      'To look up covers and publication details, we send book titles and authors to the public search services of Open Library (Internet Archive) and Google Books. These requests contain no data about you.',
    'privacy.ai.p4': 'We use an e-mail provider to send e-mails:',
    'privacy.ai.placeholder': '[Name and registered office of the e-mail delivery provider – to be completed]',

    'privacy.hosting.title': '5. Where is the data stored?',
    'privacy.hosting.p1':
      'The service, the database and the uploaded files run on servers of Hetzner Online GmbH (Germany), in a data centre within the European Union.',
    'privacy.hosting.p2':
      'Data is transferred over an encrypted connection (HTTPS). For owner keys and PINs we only store an irreversible fingerprint, never the key or the code itself.',

    'privacy.retention.title': '6. How long do we keep the data?',
    'privacy.retention.item1': 'We automatically delete the original video or photo after it has been processed successfully.',
    'privacy.retention.item2':
      'We keep the selected frames and spine photos for as long as the catalogue exists, so you can check and correct the recognition.',
    'privacy.retention.item3': 'We keep the catalogue, the book list and your e-mail address until you delete them.',
    'privacy.retention.item4': 'Unfinished uploads are deleted after 24 hours, and empty catalogues without uploads after 7 days.',
    'privacy.retention.item5': 'Technical data used for rate limiting (such as a counter tied to an IP address) is kept for at most two days.',

    'privacy.cookies.title': '7. Cookies and local storage',
    'privacy.cookies.p1':
      'We only use cookies that are strictly necessary for the service to work, so we don’t ask for cookie consent. There are no advertising, analytics or tracking cookies.',
    'privacy.cookies.item1': 'exl_own_… – marks that you are the owner of the catalogue in this browser (up to 400 days).',
    'privacy.cookies.item2': 'exl_pin_… – remembers that you entered the PIN of a protected catalogue (up to 180 days).',
    'privacy.cookies.item3': 'exl_seen_… – so that one visit isn’t counted more than once (30 minutes).',
    'privacy.cookies.item4': 'exl_lang – your chosen language (1 year).',
    'privacy.cookies.p2':
      'Your browser’s local storage (localStorage) holds the My collections list – including owner keys – and your chosen colour theme. These never reach our servers, and clearing your browser data removes them.',

    'privacy.rights.title': '8. Your rights',
    'privacy.rights.p1': 'Under the GDPR you can ask us at any time to:',
    'privacy.rights.item1': 'tell you what data we hold about you and give you a copy (access);',
    'privacy.rights.item2': 'correct inaccurate data (rectification);',
    'privacy.rights.item3': 'delete your data or restrict how we use it;',
    'privacy.rights.item4': 'hand over your data in a machine-readable format (portability) – the catalogue exports let you do this too;',
    'privacy.rights.item5': 'stop using your data based on our legitimate interest (objection); and you can withdraw your consent at any time.',
    'privacy.rights.p2':
      'You can also delete your catalogue permanently yourself at any time in its settings: this immediately deletes all of its data, frames and photos. You can change or remove your e-mail address there too.',
    'privacy.rights.p3':
      'As there are no user accounts, before acting on a request we may ask you to show that the catalogue is yours (for example with the owner link, or by writing from the e-mail address given for the catalogue). We reply within one month at the latest.',
    'privacy.rights.p4':
      'If you feel we have violated your data protection rights, you can lodge a complaint with the Hungarian National Authority for Data Protection and Freedom of Information (NAIH, www.naih.hu) or the supervisory authority where you live, or go to court.',

    'privacy.children.title': '9. Children',
    'privacy.children.p1': 'If you are under 16, please only give your e-mail address with your parents’ consent.',

    'privacy.changes.title': '10. Changes and contact',
    'privacy.changes.p1':
      'If this policy changes significantly, we will say so on this page, together with the date the changes take effect. Questions? Write to us:',

    /* ---------------- terms ---------------- */
    'terms.meta.title': 'Terms of use',
    'terms.meta.description':
      'The terms of using Ex Libris Video in plain language: what you can upload, how long we keep it, and what we are responsible for.',
    'terms.title': 'Terms of use',
    'terms.intro':
      'Ex Libris Video is a free service that turns a video or photos of your bookshelf into a book catalogue. By using the service you accept the simple terms below.',
    'terms.updated': 'Effective: 13 September 2026',

    'terms.provider.title': '1. The provider',
    'terms.provider.p1': 'The service is provided by the following operator:',
    'terms.provider.placeholder': '[Operator name, registered office or address, company or registration number, tax number – to be completed]',

    'terms.service.title': '2. The service',
    'terms.service.p1':
      'You can upload videos or photos of your bookshelf. The system recognises the books with the help of artificial intelligence and builds an editable catalogue at its own link, which you can download in several formats or receive by e-mail.',
    'terms.service.p2':
      'The service is free and provided “as is”. We keep improving it, so some features may change, and it may occasionally be unavailable for maintenance.',

    'terms.use.title': '3. What may you upload?',
    'terms.use.item1': 'Only upload recordings you made yourself or have the right to use.',
    'terms.use.item2': 'The recording should show your bookshelf. Don’t film people, personal documents or other sensitive content.',
    'terms.use.item3': 'Don’t upload unlawful or offensive content, overload the service, or use it for purposes it isn’t meant for.',
    'terms.use.item4':
      'A file can be at most {maxSize} in size and {maxDuration} long, and a catalogue can hold at most {maxFiles} files. To prevent abuse, we may limit the number of requests.',

    'terms.accuracy.title': '4. Recognition accuracy',
    'terms.accuracy.p1':
      'Books are recognised by artificial intelligence, which can make mistakes: it may miss books or misread titles and authors. Please check your catalogue and correct it where needed. We accept no responsibility for the correctness of the recognition, or for the accuracy of covers and additional details (such as publication years or descriptions).',

    'terms.link.title': '5. The catalogue link and the owner link',
    'terms.link.item1': 'Anyone who knows the link can view the catalogue. If you want to prevent that, turn on PIN protection.',
    'terms.link.item2':
      'The owner link allows editing and deleting the catalogue. Keep it secret: if it falls into the wrong hands, we are not responsible for the resulting changes.',
    'terms.link.item3':
      'If you entered your e-mail address, you can request a new sign-in link, valid for 24 hours, on the My collections page if you lose yours.',

    'terms.rights.title': '6. Who owns the content?',
    'terms.rights.p1':
      'Your recordings and catalogue data remain yours. By uploading them you allow us to store and process them only as far as needed to provide the service (including through our AI providers), and to show them to anyone who knows the catalogue link.',
    'terms.rights.p2':
      'Cover images come from Open Library or Google Books and belong to their respective rights holders; we only use them to display your catalogue.',

    'terms.deletion.title': '7. Deletion and termination',
    'terms.deletion.p1':
      'You can permanently delete your catalogue at any time in its settings – this deletes all of its data and files. Empty catalogues without uploads are deleted automatically after 7 days.',
    'terms.deletion.p2':
      'We may remove content that breaks these terms without prior notice. If we ever shut the service down, we will let you know in advance where possible, so you can export your data.',

    'terms.liability.title': '8. Liability',
    'terms.liability.p1':
      'We run the service with care, but we can’t guarantee that it will always work without errors or interruptions. To the fullest extent permitted by law, we exclude liability for data loss and for indirect damage arising from using the service, so please export your important catalogues regularly. This limitation does not affect the statutory rights of consumers.',

    'terms.law.title': '9. Governing law and changes',
    'terms.law.p1':
      'These terms are governed by Hungarian law. We may change the terms; we will announce significant changes on this page, and by continuing to use the service after a change you accept the new terms.',

    'terms.contact.title': '10. Contact',
    'terms.contact.p1': 'Questions, complaints or feedback? Write to us:',
  },
});
