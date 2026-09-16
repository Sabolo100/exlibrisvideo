import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  interpretFfprobe,
  normalizeRotation,
  parseRational,
  probeImage,
  probeMedia,
  sniffImageType,
  streamRotation,
  type FfprobeOutput,
} from './probe';

/** Trimmed ffprobe output of Mintavideok/20260912_213028.mp4 (1920×1080 stored, -90° display matrix, 120 fps). */
const PHONE_CLIP: FfprobeOutput = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      r_frame_rate: '120/1',
      avg_frame_rate: '28440000/948059',
      duration: '10.533978',
      nb_frames: '316',
      sample_aspect_ratio: '1:1',
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '10.533978', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
};

describe('parseRational / normalizeRotation', () => {
  it('parses frame rates', () => {
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRational('0/0')).toBeNull();
    expect(parseRational('25')).toBe(25);
    expect(parseRational('4:3')).toBeCloseTo(1.3333, 3);
    expect(parseRational(undefined)).toBeNull();
    expect(parseRational('abc')).toBeNull();
  });
  it('normalises rotations to 0/90/180/270', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation('90')).toBe(90);
    expect(normalizeRotation(-270)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
  });
  it('reads side data (counter-clockwise) before the legacy rotate tag (clockwise)', () => {
    expect(streamRotation({ side_data_list: [{ rotation: -90 }] })).toBe(90);
    expect(streamRotation({ tags: { rotate: '90' } })).toBe(90);
    expect(streamRotation({ tags: { rotate: '270' } })).toBe(270);
    expect(streamRotation({})).toBe(0);
  });
});

describe('interpretFfprobe', () => {
  it('reports display dimensions for rotated phone footage', () => {
    const p = interpretFfprobe(PHONE_CLIP);
    expect(p).toMatchObject({ kind: 'video', width: 1080, height: 1920, codec: 'h264', rotation: 90 });
    expect(p.durationSec).toBeCloseTo(10.534, 3);
    expect(p.fps).toBeCloseTo(30, 0);
  });

  it('swaps for the legacy rotate tag and ignores 180°', () => {
    const tagged = interpretFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, tags: { rotate: '270' }, avg_frame_rate: '30/1' }],
      format: { duration: '5.0' },
    });
    expect([tagged.width, tagged.height]).toEqual([2160, 3840]);
    const upside = interpretFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, side_data_list: [{ rotation: 180 }] }],
      format: { duration: '1' },
    });
    expect([upside.width, upside.height]).toEqual([1280, 720]);
  });

  it('applies non-square pixels and falls back for missing durations', () => {
    const p = interpretFfprobe({
      streams: [
        { codec_type: 'video', codec_name: 'mpeg2video', width: 720, height: 576, sample_aspect_ratio: '16:15', avg_frame_rate: '25/1', nb_frames: '100' },
      ],
      format: { format_name: 'mpeg' },
    });
    expect(p.width).toBe(768);
    expect(p.durationSec).toBe(4);
    const mkv = interpretFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'vp9', width: 640, height: 360, tags: { DURATION: '00:01:02.500000000' } }],
      format: { format_name: 'matroska,webm' },
    });
    expect(mkv.durationSec).toBeCloseTo(62.5, 3);
  });

  it('skips attached cover art and rejects audio-only files', () => {
    const p = interpretFfprobe({
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 300, height: 300, disposition: { attached_pic: 1 } },
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1' },
      ],
      format: { duration: '3', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    });
    expect(p.codec).toBe('h264');
    expect(() => interpretFfprobe({ streams: [{ codec_type: 'audio' }], format: {} })).toThrow(/no decodable video/);
  });

  it('recognises still images probed through ffmpeg', () => {
    const p = interpretFfprobe({
      streams: [{ codec_type: 'video', codec_name: 'png', width: 800, height: 600 }],
      format: { format_name: 'png_pipe' },
    });
    expect(p.kind).toBe('image');
    expect(p.durationSec).toBe(0);
  });
});

describe('sniffImageType', () => {
  it('detects image magic bytes', () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImageType(Buffer.from('\0\0\0\x18ftypmp42'))).toBe('other');
  });
});

describe('probe images (sharp)', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'exl-probe-test-'));
  });
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('swaps width/height for EXIF orientations 5–8 only', async () => {
    for (const [orientation, expected] of [
      [1, [400, 200]],
      [3, [400, 200]],
      [6, [200, 400]],
      [8, [200, 400]],
    ] as const) {
      const file = path.join(dir, `o${orientation}.jpg`);
      await sharp({ create: { width: 400, height: 200, channels: 3, background: '#fff' } })
        .jpeg()
        .withMetadata({ orientation })
        .toFile(file);
      const p = await probeImage(file);
      expect([p.width, p.height]).toEqual(expected);
      expect(p.kind).toBe('image');
    }
  });

  it('probeMedia routes images by magic bytes and flags empty / missing files', async () => {
    const png = path.join(dir, 'a.png');
    await sharp({ create: { width: 10, height: 20, channels: 4, background: '#0000' } }).png().toFile(png);
    expect(await probeMedia(png)).toMatchObject({ kind: 'image', width: 10, height: 20, codec: 'png' });
    const empty = path.join(dir, 'empty.mp4');
    await fs.writeFile(empty, '');
    await expect(probeMedia(empty)).rejects.toMatchObject({ code: 'unreadable' });
    await expect(probeMedia(path.join(dir, 'nope.mp4'))).rejects.toMatchObject({ code: 'unreadable' });
  });
});
