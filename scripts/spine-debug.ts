/**
 * Spine recognition without the database – for tuning and for looking at what the geometry found.
 *
 *   npx tsx scripts/spine-debug.ts <frames dir> [--out dir] [--read] [--provider deepseek|anthropic]
 *
 * Reads the *.jpg frames of a directory in name order, prints the camera motion and the spine
 * candidates, and writes <out>/sheet.jpg: the best view of every candidate, left to right per shelf
 * chain. --read also sends the candidates to the vision provider (the same batches as the pipeline) and
 * prints the readings. .env.local / .env are loaded for the API keys.
 */
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

function loadDotEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) throw new Error('usage: spine-debug <frames dir> [--out dir] [--read] [--provider name]');
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : path.join(dir, 'spine-debug');
  const providerIdx = args.indexOf('--provider');
  if (providerIdx >= 0) process.env.AI_PROVIDER = args[providerIdx + 1];
  await fs.mkdir(out, { recursive: true });

  const { analyzeVideoGeometry } = await import('@/lib/pipeline/spines/geometry');
  const { chooseViews, readSpineCandidates } = await import('@/lib/pipeline/spines/recognize');

  // key frame directories also hold the "_t" thumbnails
  const files = (await fs.readdir(dir)).filter((f) => /\.jpe?g$/i.test(f) && !/_t\.jpe?g$/i.test(f)).sort().map((f) => path.join(dir, f));
  const started = Date.now();
  const geometry = await analyzeVideoGeometry(files);
  geometry.motions.forEach((m, i) => {
    if (m) console.log(`frame ${i}: s ${m.s.toFixed(3)} d ${m.d.toFixed(0)} dy ${m.dy.toFixed(0)} ${m.reliable ? '' : 'UNRELIABLE'}`);
  });
  console.log(`geometry: ${files.length} frames, ${geometry.candidates.length} spine candidates, ${Date.now() - started} ms`);

  const chosen = await chooseViews(geometry, files, files.map(() => null));
  const H = 420;
  const tiles: { data: Buffer; width: number; label: string }[] = [];
  for (const [i, c] of chosen.entries()) {
    const best = c.read[0];
    const resized = await sharp(best.upright).resize({ height: H }).toBuffer({ resolveWithObject: true });
    tiles.push({ data: resized.data, width: Math.max(resized.info.width, 28), label: `${i}` });
  }
  const sheetWidth = tiles.reduce((a, t) => a + t.width + 6, 0) || 1;
  let x = 0;
  const composites: OverlayOptions[] = [];
  for (const t of tiles) {
    composites.push({ input: t.data, left: x, top: 26 });
    composites.push({
      input: Buffer.from(`<svg width="${t.width}" height="24"><text x="1" y="19" font-size="18" font-family="Arial" fill="#c00">${t.label}</text></svg>`),
      left: x,
      top: 0,
    });
    x += t.width + 6;
  }
  await sharp({ create: { width: sheetWidth, height: H + 26, channels: 3, background: '#ffffff' } })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toFile(path.join(out, 'sheet.jpg'));
  console.log(`sheet: ${path.join(out, 'sheet.jpg')}`);

  if (args.includes('--read')) {
    const { getVisionProvider } = await import('@/lib/ai');
    const provider = getVisionProvider();
    const t0 = Date.now();
    const outcome = await readSpineCandidates(geometry, files, files.map(() => null), provider, {
      collectionId: 'debug',
      videoId: 'debug',
      originalFilename: path.basename(dir),
      sourceSha1: null,
      locale: 'hu',
    });
    const { readings, usage, failedBatches } = outcome;
    console.log(`second chance improved ${outcome.secondChance} spines, joined runs ${outcome.joinedRuns}, split ${outcome.splitSpines}, verification ${JSON.stringify(outcome.verification)}`);
    for (const [i] of outcome.chosen.entries()) {
      if (outcome.absorbed.has(i)) continue;
      for (const r of readings.get(i) ?? []) {
        console.log(`${String(i).padStart(3)} ${r.status.padEnd(9)} ${String(r.confidence).padEnd(5)} ${r.author ?? '-'} | ${r.title}${r.canonicalTitle && r.canonicalTitle !== r.title ? ` (${r.canonicalTitle})` : ''}${r.part > 1 ? ` [part ${r.part}]` : ''}`);
      }
    }
    console.log(`read in ${Date.now() - t0} ms, failed batches ${failedBatches}, tokens in ${usage.inputTokens} out ${usage.outputTokens}, ~$${usage.estCostUsd.toFixed(4)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
