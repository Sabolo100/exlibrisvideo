import { describe, expect, it } from 'vitest';
import { TOPICS, TOPIC_KEYS, topicLabel, isTopicKey } from '@/lib/taxonomy';
import { translate, translatePlural } from '@/i18n';

describe('taxonomy', () => {
  it('has unique keys and bilingual labels', () => {
    expect(new Set(TOPIC_KEYS).size).toBe(TOPIC_KEYS.length);
    for (const t of TOPICS) {
      expect(t.hu.length).toBeGreaterThan(1);
      expect(t.en.length).toBeGreaterThan(1);
    }
    expect(isTopicKey('scifi')).toBe(true);
    expect(topicLabel('history', 'hu')).toBe('Történelem');
  });
});

describe('i18n', () => {
  it('translates and pluralises', () => {
    expect(translate('hu', 'common.action.save')).toBe('Mentés');
    expect(translatePlural('en', 'common.unit.book', 1)).toBe('1 book');
    expect(translatePlural('en', 'common.unit.book', 1234)).toBe('1,234 books');
    expect(translatePlural('hu', 'common.unit.book', 3)).toBe('3 könyv');
  });
});
