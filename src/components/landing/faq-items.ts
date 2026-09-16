import type { MessageKey } from '@/i18n';

/** FAQ entries (question / answer keys), shared by the accordion and the FAQPage JSON-LD. */
export const FAQ_ITEMS: readonly { id: string; q: MessageKey; a: MessageKey }[] = [
  { id: 'accuracy', q: 'landing.faq.accuracy.q', a: 'landing.faq.accuracy.a' },
  { id: 'time', q: 'landing.faq.time.q', a: 'landing.faq.time.a' },
  { id: 'cost', q: 'landing.faq.cost.q', a: 'landing.faq.cost.a' },
  { id: 'privacy', q: 'landing.faq.privacy.q', a: 'landing.faq.privacy.a' },
  { id: 'video', q: 'landing.faq.video.q', a: 'landing.faq.video.a' },
  { id: 'editing', q: 'landing.faq.editing.q', a: 'landing.faq.editing.a' },
  { id: 'shelves', q: 'landing.faq.shelves.q', a: 'landing.faq.shelves.a' },
  { id: 'exports', q: 'landing.faq.exports.q', a: 'landing.faq.exports.a' },
  { id: 'lost', q: 'landing.faq.lost.q', a: 'landing.faq.lost.a' },
];

/** schema.org FAQPage structured data, safe to inline in a <script type="application/ld+json">. */
export function faqJsonLd(t: (key: MessageKey) => string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: t(item.q),
      acceptedAnswer: { '@type': 'Answer', text: t(item.a) },
    })),
  };
  // "<" is escaped so the payload can never close the script element
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
