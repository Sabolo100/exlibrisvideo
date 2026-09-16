/**
 * Cast-bronze bookend seen from the front (matches the look of the Shelf's own bookends, which
 * are not exported). Sized by bookendBox() so the plank packing knows its width.
 */
import type { SpineSize } from '@/components/books/spine-layout';
import { bookendBox } from './shelf-layout';

export function Bookend({ side, size }: { side: 'start' | 'end'; size: SpineSize }) {
  const b = bookendBox(size);
  const boss = Math.max(3, Math.round(b.width * 0.32));
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0 self-end"
      style={{
        width: b.width,
        height: b.height,
        marginLeft: side === 'start' ? b.marginStart : b.marginEnd,
        marginRight: side === 'start' ? b.marginEnd : b.marginStart,
        borderRadius: `${b.width / 2}px ${b.width / 2}px 2px 2px`,
        background:
          'radial-gradient(120% 60% at 30% 18%, rgb(255 236 190 / 0.35), transparent 55%), linear-gradient(90deg, #2a2019 0%, #6b5238 34%, #4a3826 62%, #1d1510 100%)',
        boxShadow:
          'inset 0 0 0 1px rgb(214 170 92 / 0.55), inset 0 2px 0 rgb(255 230 170 / 0.25), 3px 3px 6px rgb(0 0 0 / 0.45)',
      }}
    >
      <span
        className="absolute left-1/2 block -translate-x-1/2 rounded-full"
        style={{
          top: Math.round(b.width * 0.42),
          width: boss,
          height: boss,
          background: 'radial-gradient(circle at 35% 35%, #fbe7ad, #b8893a 60%, #6e4f1c)',
          boxShadow: '0 1px 1px rgb(0 0 0 / 0.5)',
        }}
      />
      <span
        className="absolute inset-x-[18%] block rounded-full"
        style={{ bottom: Math.round(b.height * 0.12), height: 1, background: 'rgb(214 170 92 / 0.6)' }}
      />
    </span>
  );
}
