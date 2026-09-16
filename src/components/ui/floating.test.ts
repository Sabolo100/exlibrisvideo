import { describe, expect, it } from 'vitest';
import { computeFloatingPosition, type FloatingOptions } from './floating';

const viewport = { width: 400, height: 800 };
const base: FloatingOptions = { side: 'bottom', align: 'start', offset: 8, padding: 8, viewport };

describe('computeFloatingPosition', () => {
  it('places below, start aligned', () => {
    const p = computeFloatingPosition({ top: 100, left: 50, width: 80, height: 40 }, { width: 200, height: 100 }, base);
    expect(p).toMatchObject({ x: 50, y: 148, side: 'bottom' });
  });
  it('flips to top when there is no room below', () => {
    const p = computeFloatingPosition({ top: 700, left: 50, width: 80, height: 40 }, { width: 200, height: 200 }, base);
    expect(p.side).toBe('top');
    expect(p.y).toBe(700 - 8 - 200);
  });
  it('keeps the side when neither fits but it has more room', () => {
    const p = computeFloatingPosition({ top: 300, left: 50, width: 80, height: 40 }, { width: 200, height: 780 }, base);
    expect(p.side).toBe('bottom');
    expect(p.y).toBe(800 - 780 - 8);
  });
  it('shifts inside the viewport on the cross axis', () => {
    const p = computeFloatingPosition(
      { top: 100, left: 360, width: 30, height: 30 },
      { width: 200, height: 50 },
      { ...base, align: 'center' },
    );
    expect(p.x).toBe(400 - 200 - 8);
  });
  it('end-aligns and centres for left/right sides', () => {
    const end = computeFloatingPosition({ top: 100, left: 300, width: 80, height: 40 }, { width: 120, height: 60 }, { ...base, align: 'end' });
    expect(end.x).toBe(260);
    const right = computeFloatingPosition({ top: 100, left: 20, width: 40, height: 40 }, { width: 100, height: 20 }, { ...base, side: 'right', align: 'center' });
    expect(right).toMatchObject({ x: 68, y: 110, side: 'right' });
    const flipped = computeFloatingPosition({ top: 100, left: 20, width: 40, height: 40 }, { width: 100, height: 20 }, { ...base, side: 'left', align: 'center' });
    expect(flipped.side).toBe('right');
  });
});
