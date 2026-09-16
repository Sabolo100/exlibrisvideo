import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from './context';
import {
  buildSearch,
  DEFAULT_URL_STATE,
  filtersEqual,
  hrefWithSearch,
  parseUrlState,
  searchStateKey,
  stateKey,
  withoutParams,
  type CollectionUrlState,
} from './url-state';

const p = (qs: string) => new URLSearchParams(qs);

describe('parseUrlState', () => {
  it('returns defaults for an empty query', () => {
    expect(parseUrlState(p(''))).toEqual(DEFAULT_URL_STATE);
  });

  it('reads every managed parameter', () => {
    const state = parseUrlState(
      p(
        'view=table&sort=author&q=eszterh%C3%A1zy&topic=poetry,history&status=read&status=to_read' +
          '&author=Esterh%C3%A1zy%20P%C3%A9ter&author=Doe%2C%20John&lang=hu,EN&decade=1960,1970' +
          '&review=1&fav=true&lent=1&book=0b4e7c9a-1d2f-4c3b-9a8e-7f6d5c4b3a21',
      ),
    );
    expect(state).toEqual<CollectionUrlState>({
      view: 'table',
      sort: 'author',
      filters: {
        q: 'eszterházy',
        topics: ['poetry', 'history'],
        statuses: ['read', 'to_read'],
        authors: ['Esterházy Péter', 'Doe, John'],
        languages: ['hu', 'en'],
        decades: [1960, 1970],
        needsReview: true,
        favorites: true,
        lent: true,
      },
      book: '0b4e7c9a-1d2f-4c3b-9a8e-7f6d5c4b3a21',
    });
  });

  it('drops invalid values', () => {
    const state = parseUrlState(
      p('view=nope&sort=random&topic=poetry,not_a_topic&status=done&lang=hungarian,hu&decade=1965,abc,1980&book=../../etc&fav=0'),
    );
    expect(state.view).toBe('shelf');
    expect(state.sort).toBe('shelf');
    expect(state.filters.topics).toEqual(['poetry']);
    expect(state.filters.statuses).toEqual([]);
    expect(state.filters.languages).toEqual(['hu']);
    expect(state.filters.decades).toEqual([1980]);
    expect(state.filters.favorites).toBe(false);
    expect(state.book).toBeNull();
  });

  it('only allows the review view for owners', () => {
    expect(parseUrlState(p('view=review')).view).toBe('shelf');
    expect(parseUrlState(p('view=review'), { isOwner: true }).view).toBe('review');
  });

  it('de-duplicates list values and caps the search text', () => {
    const long = 'x'.repeat(500);
    const state = parseUrlState(p(`topic=poetry&topic=poetry,poetry&q=${long}`));
    expect(state.filters.topics).toEqual(['poetry']);
    expect(state.filters.q).toHaveLength(200);
  });

  it('treats a bare flag as on', () => {
    expect(parseUrlState(p('fav')).filters.favorites).toBe(true);
    expect(parseUrlState(p('lent=yes')).filters.lent).toBe(true);
    expect(parseUrlState(p('review=false')).filters.needsReview).toBe(false);
  });
});

describe('buildSearch', () => {
  it('omits defaults', () => {
    expect(buildSearch(null, DEFAULT_URL_STATE)).toBe('');
    expect(buildSearch(p(''), { ...DEFAULT_URL_STATE, filters: { ...EMPTY_FILTERS, q: '   ' } })).toBe('');
  });

  it('keeps unmanaged parameters and replaces managed ones', () => {
    const qs = buildSearch(p('utm_source=mail&view=covers&k=abc&q=old'), {
      ...DEFAULT_URL_STATE,
      view: 'stats',
      filters: { ...EMPTY_FILTERS, q: 'new' },
    });
    expect(qs).toBe('utm_source=mail&k=abc&view=stats&q=new');
  });

  it('round-trips through parseUrlState', () => {
    const state: CollectionUrlState = {
      view: 'review',
      sort: 'year',
      filters: {
        q: 'Szabó Magda',
        topics: ['literary_fiction', 'hungarian_literature'],
        statuses: ['reading'],
        authors: ['Szabó Magda', 'García Márquez, Gabriel'],
        languages: ['hu'],
        decades: [1970, 1950],
        needsReview: true,
        favorites: false,
        lent: true,
      },
      book: 'abc-123',
    };
    const qs = buildSearch(null, state);
    const back = parseUrlState(p(qs), { isOwner: true });
    expect(back).toEqual({ ...state, filters: { ...state.filters, decades: [1950, 1970] } });
    expect(stateKey(back)).toBe(qs);
  });

  it('writes authors as repeated parameters (names may contain commas)', () => {
    const qs = buildSearch(null, {
      ...DEFAULT_URL_STATE,
      filters: { ...EMPTY_FILTERS, authors: ['Doe, John', 'Kovács Anna'] },
    });
    expect(new URLSearchParams(qs).getAll('author')).toEqual(['Doe, John', 'Kovács Anna']);
  });
});

describe('helpers', () => {
  it('withoutParams strips claim parameters only', () => {
    expect(withoutParams(p('k=secret&view=table&r=123.sig'), ['k', 'r'])).toBe('view=table');
    expect(withoutParams(p('k=secret'), ['k', 'r'])).toBe('');
  });

  it('searchStateKey ignores unmanaged params and parameter order', () => {
    expect(searchStateKey(p('fav=1&view=table&x=1'))).toBe(searchStateKey(p('view=table&fav=true')));
    expect(searchStateKey(p('decade=1970,1960'))).toBe(searchStateKey(p('decade=1960&decade=1970')));
  });

  it('filtersEqual compares by value', () => {
    expect(filtersEqual(EMPTY_FILTERS, { ...EMPTY_FILTERS, topics: [] })).toBe(true);
    expect(filtersEqual(EMPTY_FILTERS, { ...EMPTY_FILTERS, q: 'a' })).toBe(false);
    expect(filtersEqual({ ...EMPTY_FILTERS, decades: [1960] }, { ...EMPTY_FILTERS, decades: [1960] })).toBe(true);
    expect(filtersEqual({ ...EMPTY_FILTERS, authors: ['a', 'b'] }, { ...EMPTY_FILTERS, authors: ['a'] })).toBe(false);
    expect(filtersEqual(EMPTY_FILTERS, { ...EMPTY_FILTERS, lent: true })).toBe(false);
  });

  it('hrefWithSearch', () => {
    expect(hrefWithSearch('/123456789', '')).toBe('/123456789');
    expect(hrefWithSearch('/123456789', 'view=table')).toBe('/123456789?view=table');
  });
});
