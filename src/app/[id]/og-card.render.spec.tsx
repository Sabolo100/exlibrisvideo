/**
 * Renders the OG card through next/og (satori + resvg). JSX modules need the automatic runtime, which the
 * root vitest config does not enable (tsconfig "jsx": "preserve" for Next) – run with
 *   npx vitest run <this file>  (root vitest.config.ts compiles JSX)
 */
import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import { OgCard } from './og-card';
import { OG_SIZE, loadOgFonts } from './og-model';

describe('OgCard rendering', () => {
  it('renders a PNG with the embedded Noto fonts (incl. ő/ű)', async () => {
    const fonts = await loadOgFonts();
    expect(fonts.map((f) => f.name)).toEqual(['ExlSerif', 'ExlSerifExt', 'ExlSerif', 'ExlSerifExt', 'ExlSans', 'ExlSansExt']);
    const element = OgCard({
      id: '334345435',
      locale: 'hu',
      host: 'exlibrisvideo.hu',
      summary: { title: 'Kőszegi dolgozószoba', ownerName: 'Szűcs Ödön', bookCount: 312, authorCount: 148, spineColors: ['#7a2e3a'], titles: [] },
    });
    const response = new ImageResponse(element, { ...OG_SIZE, fonts });
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    // IHDR width/height
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('renders the generic card without a summary', async () => {
    const response = new ImageResponse(OgCard({ id: '111111111', locale: 'en', host: 'exlibrisvideo.hu', summary: null }), {
      ...OG_SIZE,
      fonts: await loadOgFonts(),
    });
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.length).toBeGreaterThan(10_000);
  });
});
