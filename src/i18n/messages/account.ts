import { defineMessages } from '../define';

/** Area "account": sign-in with Google, the account menu, the user's library. */
export const account = defineMessages({
  hu: {
    'signIn.google': 'Belépés Google-fiókkal',
    'signIn.short': 'Belépés',
    'signIn.title': 'Egy könyvtár, ami veled marad',
    'signIn.text':
      'Lépj be a Google-fiókoddal: a könyvtárad a fiókodhoz kötődik, bármikor bővítheted új videóval vagy könyvvel, bármelyik eszközről.',
    'signIn.recommended': 'Javasolt',
    'signIn.withoutAccount': 'Vagy fiók nélkül: töltsd fel a videót, és a katalógust egy titkos link őrzi.',
    'nudge.title': 'Lépj be, hogy a könyvtárad megmaradjon',
    'nudge.text':
      'Google-fiókkal a könyvtárad bármelyik eszközödről elérhető, és nem kell őrizgetned a titkos linket. Bejelentkezés nélkül csak a link őrzi a katalógust – ha elveszik, a könyvtár is.',
    'nudge.later': 'Ha most nem lépsz be, később is megteheted: új fiókkal belépve a most felvett könyvek lesznek a könyvtárad.',
    'nudge.continue': 'Folytatás bejelentkezés nélkül',
    'keep.label': 'Belépés a könyvtár megtartásához',
    'keep.title': 'Lépj be, hogy a könyveid megmaradjanak',
    'keep.text':
      'Új fiókkal belépve ennek a felvételnek a könyvei lesznek a könyvtárad – bármelyik eszközödről elérheted, és a linket sem kell őrizgetned.',
    'signIn.failed': 'A belépés nem sikerült. Próbáld újra.',
    'signIn.unavailable': 'A Google-belépés most nem érhető el.',
    'menu.label': 'Fiók',
    'menu.library': 'A könyvtáram',
    'menu.signOut': 'Kijelentkezés',
    'menu.signedInAs': 'Belépve: {email}',
    'library.addHint': 'Minden új videó és könyv ehhez a könyvtárhoz adódik – a már meglévő könyveket felismerjük.',
  },
  en: {
    'signIn.google': 'Sign in with Google',
    'signIn.short': 'Sign in',
    'signIn.title': 'One library that stays with you',
    'signIn.text':
      'Sign in with your Google account: your library belongs to your account and you can add new videos or books any time, from any device.',
    'signIn.recommended': 'Recommended',
    'signIn.withoutAccount': 'Or without an account: upload the video and a secret link keeps your catalogue.',
    'nudge.title': 'Sign in to keep your library',
    'nudge.text':
      'With a Google account your library is available from any device and you don’t have to look after the secret link. Without one only the link keeps the catalogue – if it is lost, so is the library.',
    'nudge.later': 'If you don’t sign in now you can do it later: signing in with a new account makes the books you record now your library.',
    'nudge.continue': 'Continue without signing in',
    'keep.label': 'Sign in to keep the library',
    'keep.title': 'Sign in to keep your books',
    'keep.text':
      'Signing in with a new account makes the books of this recording your library – reachable from any device, and you no longer need to look after the link.',
    'signIn.failed': 'Signing in did not work. Please try again.',
    'signIn.unavailable': 'Google sign-in is not available right now.',
    'menu.label': 'Account',
    'menu.library': 'My library',
    'menu.signOut': 'Sign out',
    'menu.signedInAs': 'Signed in as {email}',
    'library.addHint': 'Every new video and book is added to this library – books you already have are recognised.',
  },
});
