import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_GAP_SEC,
  DEFAULT_REDUNDANCY_THRESHOLD,
  buildCandidateArgs,
  filterRedundant,
  JpegStreamSplitter,
  pickWindowBest,
  sampleUniform,
  selectKeyFrames,
  windowSize,
} from './frames';
import { probeMedia } from './probe';
import type { GreySignature } from './sharpness';

const sig = (value: number, w = 9, h = 16): GreySignature => ({ width: w, height: h, data: new Uint8Array(w * h).fill(value) });

describe('windowSize', () => {
  it('is max(1, round(fps × windowSec))', () => {
    expect(windowSize(8, 0.33)).toBe(3); // defaults → ~2.7 key frames per second
    expect(windowSize(4, 0.5)).toBe(2);
    expect(windowSize(10, 0.25)).toBe(3);
    expect(windowSize(1, 0.33)).toBe(1);
    expect(windowSize(30, 0.33)).toBe(10);
    expect(windowSize(8, Number.NaN)).toBe(1);
  });
});

describe('pickWindowBest', () => {
  it('keeps the sharpest of each window of W consecutive candidates', () => {
    const c = [5, 9, 3, 2, 7, 7, 1].map((s, n) => ({ n, timeSec: n / 4, sharpness: s }));
    expect(pickWindowBest(c, 2).map((x) => x.n)).toEqual([1, 2, 4, 6]);
    expect(pickWindowBest(c, 3).map((x) => x.n)).toEqual([1, 4, 6]);
    expect(pickWindowBest(c, 1).map((x) => x.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pickWindowBest([], 2)).toEqual([]);
  });
});

describe('filterRedundant', () => {
  it('drops frames while the camera does not move', () => {
    const frames = [
      { timeSec: 0, signature: sig(100) },
      { timeSec: 0.5, signature: sig(101) }, // shake
      { timeSec: 1.0, signature: sig(130) }, // moved
      { timeSec: 1.5, signature: sig(131) },
      { timeSec: 2.0, signature: sig(160) },
      { timeSec: 2.5, signature: sig(161) },
      { timeSec: 3.0, signature: sig(162) }, // end of the pan: always kept
    ];
    expect(filterRedundant(frames, 5, 2).map((f) => f.timeSec)).toEqual([0, 1.0, 2.0, 3.0]);
  });

  it('compares with the previously KEPT frame so slow drift accumulates', () => {
    const frames = [0, 3, 6, 9, 12].map((v, i) => ({ timeSec: i * 0.5, signature: sig(100 + v) }));
    expect(filterRedundant(frames, 5, 2).map((f) => f.timeSec)).toEqual([0, 1.0, 2.0]);
  });

  it('defaults (MAD 3, gap 0.75 s): a still camera keeps one frame per 0.75 s, a pan keeps everything', () => {
    expect([DEFAULT_REDUNDANCY_THRESHOLD, DEFAULT_MAX_GAP_SEC]).toEqual([3, 0.75]);
    // window bests of W=3 at 8 fps are 0.375 s apart
    const still = Array.from({ length: 9 }, (_, i) => ({ timeSec: i * 0.375, signature: sig(100 + (i % 2)) }));
    const keptStill = filterRedundant(still, DEFAULT_REDUNDANCY_THRESHOLD, DEFAULT_MAX_GAP_SEC).map((f) => f.timeSec);
    expect(keptStill).toEqual([0, 0.75, 1.5, 2.25, 3]);
    const pan = Array.from({ length: 9 }, (_, i) => ({ timeSec: i * 0.375, signature: sig(40 + i * 8) }));
    expect(filterRedundant(pan, DEFAULT_REDUNDANCY_THRESHOLD, DEFAULT_MAX_GAP_SEC)).toHaveLength(9);
    // a slow dark pan (MAD ≈ 4–6 per step) is not mistaken for a still camera
    const slow = Array.from({ length: 6 }, (_, i) => ({ timeSec: i * 0.375, signature: sig(100 + i * 4) }));
    expect(filterRedundant(slow, DEFAULT_REDUNDANCY_THRESHOLD, DEFAULT_MAX_GAP_SEC)).toHaveLength(6);
  });

  it('never leaves a gap longer than maxGapSec', () => {
    const frames = Array.from({ length: 12 }, (_, i) => ({ timeSec: i * 0.5, signature: sig(100) }));
    const kept = filterRedundant(frames, 5, 2).map((f) => f.timeSec);
    expect(kept[0]).toBe(0);
    for (let i = 1; i < kept.length; i++) expect(kept[i] - kept[i - 1]).toBeLessThanOrEqual(2);
    // nothing kept needlessly: static camera → one frame every 2 s (+ the final frame)
    expect(kept).toEqual([0, 2, 4, 5.5]);
  });

  it('treats an orientation change as a change', () => {
    const frames = [
      { timeSec: 0, signature: sig(100, 9, 16) },
      { timeSec: 0.5, signature: sig(100, 16, 9) },
      { timeSec: 1.0, signature: sig(100, 16, 9) },
    ];
    expect(filterRedundant(frames, 5, 2)).toHaveLength(3);
  });
});

describe('sampleUniform', () => {
  it('keeps first and last and spreads evenly', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(sampleUniform(items, 4)).toEqual([0, 3, 6, 9]);
    expect(sampleUniform(items, 10)).toEqual(items);
    expect(sampleUniform(items, 20)).toEqual(items);
    expect(sampleUniform(items, 2)).toEqual([0, 9]);
    expect(sampleUniform(items, 1)).toEqual([0]);
    expect(sampleUniform(items, 0)).toEqual([]);
    const many = sampleUniform(Array.from({ length: 100 }, (_, i) => i), 48);
    expect(many).toHaveLength(48);
    expect(new Set(many).size).toBe(48);
    expect(many[0]).toBe(0);
    expect(many[47]).toBe(99);
  });
});

describe('JpegStreamSplitter', () => {
  it('splits a concatenated JPEG stream regardless of chunk boundaries', async () => {
    const images = await Promise.all(
      [
        { w: 64, h: 48, c: '#ff0000' },
        { w: 33, h: 17, c: '#00ff00' },
        { w: 120, h: 90, c: '#0000ff' },
      ].map(async ({ w, h, c }) => {
        // noise makes the entropy-coded data contain plenty of 0xFF bytes
        const noise = Buffer.alloc(w * h * 3);
        for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + 13) % 256;
        return sharp(noise, { raw: { width: w, height: h, channels: 3 } })
          .composite([{ input: { create: { width: 4, height: 4, channels: 3, background: c } }, left: 1, top: 1 }])
          .jpeg({ quality: 95, progressive: w === 33 })
          .toBuffer();
      }),
    );
    const stream = Buffer.concat([Buffer.from([0x00, 0x13]), ...images]); // leading garbage
    for (const chunkSize of [1, 7, 64, 1000, stream.length]) {
      const splitter = new JpegStreamSplitter();
      const out: Buffer[] = [];
      for (let i = 0; i < stream.length; i += chunkSize) out.push(...splitter.push(stream.subarray(i, i + chunkSize)));
      expect(out.length).toBe(3);
      out.forEach((img, i) => expect(img.equals(images[i])).toBe(true));
      expect(splitter.pending).toBe(0);
    }
    const metas = await Promise.all(images.map((b) => sharp(b).metadata()));
    expect(metas.map((m) => [m.width, m.height])).toEqual([
      [64, 48],
      [33, 17],
      [120, 90],
    ]);
  });
});

describe('buildCandidateArgs', () => {
  it('builds an argument array (no shell) with fps + scale and pipes MJPEG', () => {
    const args = buildCandidateArgs('/data/in put.mp4', { sampleFps: 4, maxEdge: 1920 });
    expect(args[args.indexOf('-i') + 1]).toBe('/data/in put.mp4');
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf.startsWith('fps=4,scale=')).toBe(true);
    expect(vf).toContain('min(1920,iw)');
    expect(args.slice(-3)).toEqual(['-f', 'image2pipe', 'pipe:1']);
    const sar = buildCandidateArgs('x', { sampleFps: 4, maxEdge: 1280, sampleAspectRatio: 4 / 3 });
    expect(sar[sar.indexOf('-vf') + 1]).toContain('setsar=1');
    const first = buildCandidateArgs('x', { sampleFps: 4, maxEdge: 1280, firstFrameOnly: true });
    expect(first).toContain('-frames:v');
    expect(first[first.indexOf('-vf') + 1].startsWith('fps=')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* ffmpeg integration on synthetic clips                               */
/* ------------------------------------------------------------------ */

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasFfmpeg)('selectKeyFrames on synthetic media', () => {
  let dir = '';
  const ff = (args: string[]) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'exl-frames-test-'));
  });
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('handles a rotated 120 fps clip with odd dimensions (portrait output, even dims)', async () => {
    const src = path.join(dir, 'rot.mp4');
    // stored 641x361 landscape (odd dimensions) with a display matrix rotation, like phone footage
    ff([
      // (testsrc2 rounds sizes to even numbers – colour source + moving box keeps 641×361)
      '-f', 'lavfi', '-i', 'color=c=gray:size=641x361:rate=120:duration=3',
      '-vf', 'drawbox=x=t*150:y=100:w=40:h=100:color=red:t=fill',
      '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-preset', 'ultrafast',
      path.join(dir, 'raw.mp4'),
    ]);
    ff(['-display_rotation', '90', '-i', path.join(dir, 'raw.mp4'), '-c', 'copy', src]);
    const out = path.join(dir, 'out-rot');
    // private temp root: other test files extract frames in parallel into os.tmpdir()
    const tempRoot = path.join(dir, 'tmp-rot');
    const probe = await probeMedia(src);
    // -display_rotation is counter-clockwise → 270° clockwise; either way width/height swap
    expect([probe.width, probe.height, probe.rotation]).toEqual([361, 641, 270]);
    expect(probe.fps).toBeCloseTo(120, 0);
    const res = await selectKeyFrames(src, out, {
      sampleFps: 4,
      windowSec: 0.5,
      maxFrames: 48,
      maxEdge: 320,
      collectDiagnostics: true,
      tempRoot,
    });
    expect(res.durationSec).toBeGreaterThan(2.9);
    expect(res.frames.length).toBeGreaterThan(0);
    expect(res.stats.candidates).toBeGreaterThanOrEqual(11);
    for (const f of res.frames) {
      expect(f.height).toBeGreaterThan(f.width); // display orientation (portrait)
      expect(f.height).toBeLessThanOrEqual(320);
      expect(f.width % 2).toBe(0);
      const thumb = await sharp(f.thumbPath).metadata();
      expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(480);
    }
    const names = (await fs.readdir(out)).sort();
    expect(names[0]).toBe('0000.jpg');
    expect(names).toContain('0000_t.jpg');
    // idx is sequential, times increase
    res.frames.forEach((f, i) => expect(f.idx).toBe(i));
    for (let i = 1; i < res.frames.length; i++) expect(res.frames[i].timeSec).toBeGreaterThan(res.frames[i - 1].timeSec);
    // the candidate temp dir is always removed
    expect(await fs.readdir(tempRoot)).toEqual([]);
    // 120 fps input sampled at 4 fps: candidates are 0.25 s apart, windows of 2 → key frames ≥ 0.25 s apart
    expect(res.diagnostics?.filter((d) => d.windowBest)).toHaveLength(res.stats.windowBest);
  });

  it('extracts at least one frame from a clip shorter than one sample interval', async () => {
    const src = path.join(dir, 'short.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-frames:v', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
    const res = await selectKeyFrames(src, path.join(dir, 'out-short'), { sampleFps: 4 });
    expect(res.frames.length).toBe(1);
    expect(res.frames[0].timeSec).toBe(0);
    expect([res.frames[0].width, res.frames[0].height]).toEqual([320, 240]);
  });

  it('caps kept frames with uniform sampling', async () => {
    const src = path.join(dir, 'long.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
    const res = await selectKeyFrames(src, path.join(dir, 'out-long'), { sampleFps: 4, windowSec: 0.5, maxFrames: 5, redundancyThreshold: 0 });
    expect(res.frames.length).toBe(5);
    expect(res.stats.afterRedundancy).toBeGreaterThan(5);
  });

  it('turns an EXIF-rotated photo into a single upright frame', async () => {
    const src = path.join(dir, 'photo.jpg');
    await sharp({ create: { width: 400, height: 200, channels: 3, background: '#884422' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(src);
    const res = await selectKeyFrames(src, path.join(dir, 'out-photo'), { maxEdge: 300 });
    expect(res.frames).toHaveLength(1);
    expect(res.durationSec).toBe(0);
    expect([res.frames[0].width, res.frames[0].height]).toEqual([150, 300]);
  });

  it('rejects garbage as unreadable', async () => {
    const src = path.join(dir, 'garbage.mp4');
    await fs.writeFile(src, Buffer.from('definitely not a video file'.repeat(100)));
    await expect(selectKeyFrames(src, path.join(dir, 'out-garbage'))).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('aborts on signal', async () => {
    const src = path.join(dir, 'rot.mp4');
    const controller = new AbortController();
    controller.abort();
    const tempRoot = path.join(dir, 'tmp-abort');
    const probe = await probeMedia(src);
    await expect(
      selectKeyFrames(src, path.join(dir, 'out-abort'), { signal: controller.signal, sampleFps: 4, probe, tempRoot }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // temp dir removed on failure as well
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });
});
