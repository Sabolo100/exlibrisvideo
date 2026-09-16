import { describe, expect, it } from 'vitest';
import { collectionRefHref, parseCollectionRef } from './collection-ref';

describe('parseCollectionRef', () => {
  it('accepts bare ids with separators', () => {
    expect(parseCollectionRef('334345435')).toEqual({ id: '334345435' });
    expect(parseCollectionRef(' 334 345 435 ')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('334-345-435')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('334.345.435')).toEqual({ id: '334345435' });
  });

  it('rejects ids of the wrong shape', () => {
    expect(parseCollectionRef('')).toBeNull();
    expect(parseCollectionRef('   ')).toBeNull();
    expect(parseCollectionRef('12345678')).toBeNull();
    expect(parseCollectionRef('1234567890')).toBeNull();
    expect(parseCollectionRef('034345435')).toBeNull();
    expect(parseCollectionRef('hello')).toBeNull();
    expect(parseCollectionRef('https://www.exlibrisvideo.hu/about')).toBeNull();
  });

  it('extracts the id from pasted links', () => {
    expect(parseCollectionRef('https://www.exlibrisvideo.hu/334345435')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('www.exlibrisvideo.hu/334345435')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('exlibrisvideo.hu/334345435/')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('http://localhost:3000/334345435?view=table#x')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('/334345435')).toEqual({ id: '334345435' });
  });

  it('keeps owner tokens and recovery signatures from pasted links', () => {
    const token = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg';
    expect(parseCollectionRef(`https://www.exlibrisvideo.hu/334345435?k=${token}`)).toEqual({ id: '334345435', token });
    expect(parseCollectionRef('https://www.exlibrisvideo.hu/334345435?r=1790000000.abcdefghijklmnopqrstuv_-12')).toEqual({
      id: '334345435',
      recovery: '1790000000.abcdefghijklmnopqrstuv_-12',
    });
    // malformed credentials are dropped, the id still opens
    expect(parseCollectionRef('https://www.exlibrisvideo.hu/334345435?k=<script>')).toEqual({ id: '334345435' });
  });

  it('finds a lone id inside other text', () => {
    expect(parseCollectionRef('katalógus #334345435')).toEqual({ id: '334345435' });
    expect(parseCollectionRef('id: 3343454350')).toBeNull();
  });
});

describe('collectionRefHref', () => {
  it('builds in-app paths', () => {
    expect(collectionRefHref({ id: '334345435' })).toBe('/334345435');
    expect(collectionRefHref({ id: '334345435', token: 'abc_DEF-123' })).toBe('/334345435?k=abc_DEF-123');
    expect(collectionRefHref({ id: '334345435', recovery: '1790000000.sig' })).toBe('/334345435?r=1790000000.sig');
  });
});
