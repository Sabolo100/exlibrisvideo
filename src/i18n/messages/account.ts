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
    'signIn.failed': 'Signing in did not work. Please try again.',
    'signIn.unavailable': 'Google sign-in is not available right now.',
    'menu.label': 'Account',
    'menu.library': 'My library',
    'menu.signOut': 'Sign out',
    'menu.signedInAs': 'Signed in as {email}',
    'library.addHint': 'Every new video and book is added to this library – books you already have are recognised.',
  },
});
