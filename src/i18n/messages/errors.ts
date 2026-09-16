import { defineMessages } from '../define';

/**
 * Area "errors": API error messages keyed by error code. Only the owning module (api) adds keys here.
 *
 * The first nine keys are the machine-readable `ApiError.code` values of SPEC §3. The remaining
 * keys are more specific *reasons*: the API still answers with one of the nine base codes
 * (see `ERROR_KEY_CODE` in src/lib/http.ts) and puts the reason into `details.reason`, while the
 * human readable `error` text comes from the specific key.
 */
export const errors = defineMessages({
  hu: {
    invalid: 'Érvénytelen kérés. Kérjük, ellenőrizd a megadott adatokat.',
    not_found: 'Nem találjuk, amit keresel. Lehet, hogy törölték, vagy elírás van a linkben.',
    forbidden: 'Ehhez nincs jogosultságod. Nyisd meg a katalógust a tulajdonosi linkkel.',
    needs_pin: 'Ez a katalógus PIN-kóddal védett. A megtekintéshez add meg a PIN-kódot.',
    rate_limited: 'Túl sok kérés érkezett rövid idő alatt. Kérjük, várj egy kicsit, és próbáld újra.',
    too_large: 'Túl nagy a fájl vagy a kérés, ekkora méretet nem tudunk fogadni.',
    conflict: 'Az adatok időközben megváltoztak. Frissítsd az oldalt, és próbáld újra.',
    unsupported:
      'Ezt a fájltípust nem tudjuk feldolgozni. Videót (MP4, MOV, WebM) vagy fényképet (JPEG, PNG, WebP) tölts fel.',
    internal: 'Váratlan hiba történt. Kérjük, próbáld újra később.',
    wrong_pin: 'Hibás PIN-kód. Próbáld újra.',
    expired_link: 'Ez a helyreállító link lejárt vagy érvénytelen. Kérj újat e-mailben a Kollekcióim oldalon.',
    upload_incomplete: 'A feltöltés még nem fejeződött be: a fájl nem érkezett meg teljesen.',
    too_many_sources: 'Elérted az egy katalógusba feltölthető videók és fényképek maximális számát.',
    bad_email: 'Érvénytelen e-mail-cím. Kérjük, ellenőrizd, hogy jól írtad-e be.',
    bad_owner_link: 'Érvénytelen tulajdonosi link. Ellenőrizd, hogy a teljes linket másoltad-e be.',
    pin_format: 'A PIN-kód 4–8 számjegyből álljon.',
    too_many_books: 'Elérted az egy katalógusban tárolható könyvek maximális számát.',
    upload_closed: 'Ez a feltöltés már lezárult, további adat nem küldhető hozzá.',
    unauthorized: 'Ehhez az oldalhoz bejelentkezés szükséges.',
  },
  en: {
    invalid: 'Invalid request. Please check the data you entered.',
    not_found: "We couldn't find what you're looking for. It may have been deleted, or the link may contain a typo.",
    forbidden: "You don't have permission to do this. Open the collection with its owner link.",
    needs_pin: 'This collection is protected by a PIN. Enter the PIN to view it.',
    rate_limited: 'Too many requests in a short time. Please wait a moment and try again.',
    too_large: 'The file or request is too large for us to accept.',
    conflict: 'The data changed in the meantime. Refresh the page and try again.',
    unsupported:
      "We can't process this file type. Please upload a video (MP4, MOV, WebM) or a photo (JPEG, PNG, WebP).",
    internal: 'Something went wrong on our side. Please try again later.',
    wrong_pin: 'Incorrect PIN. Please try again.',
    expired_link: 'This recovery link has expired or is invalid. Request a new one by e-mail on the My collections page.',
    upload_incomplete: "The upload hasn't finished yet – the file has not arrived completely.",
    too_many_sources: "You've reached the maximum number of videos and photos for one collection.",
    bad_email: "Invalid e-mail address. Please check that it's typed correctly.",
    bad_owner_link: "Invalid owner link. Please check that you've copied the whole link.",
    pin_format: 'The PIN must be 4–8 digits.',
    too_many_books: "You've reached the maximum number of books for one collection.",
    upload_closed: 'This upload has already been closed; no more data can be added to it.',
    unauthorized: 'You need to sign in to access this page.',
  },
});
