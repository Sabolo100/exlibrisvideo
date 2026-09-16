import { describe, expect, it } from 'vitest';
import { sniffMedia } from './sniff';
import { extensionFor, isAllowedUploadMime, normalizeMime, resolveUploadMime, sanitizeFilename } from './uploads';

const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

describe('sniffMedia', () => {
  it('detects supported containers and images', () => {
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'ftypisom', [0, 0, 2, 0]))).toMatchObject({ kind: 'video', format: 'mp4' });
    expect(sniffMedia(bytes([0, 0, 0, 0x14], 'ftypqt  ', [0, 0, 0, 0]))).toMatchObject({ kind: 'video', mimeType: 'video/quicktime' });
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ kind: 'video', format: 'matroska' });
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ kind: 'image', format: 'jpeg' });
    expect(sniffMedia(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toMatchObject({ kind: 'image', format: 'png' });
    expect(sniffMedia(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toMatchObject({ kind: 'image', format: 'webp' });
  });

  it('rejects unknown data, HEIC/AVIF stills and truncated headers', () => {
    expect(sniffMedia(bytes('%PDF-1.7 hello world'))).toBeNull();
    expect(sniffMedia(bytes('<html><script>alert(1)'))).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]))).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'ftypavif', [0, 0, 0, 0]))).toBeNull();
    expect(sniffMedia(bytes('RIFF', [0, 0, 0, 0], 'AVI LIST'))).toBeNull();
    expect(sniffMedia(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffMedia(new Uint8Array(0))).toBeNull();
  });
});

describe('upload helpers', () => {
  it('mime allow-list', () => {
    expect(isAllowedUploadMime('video/mp4')).toBe(true);
    expect(isAllowedUploadMime('Video/QuickTime; codecs="hvc1"')).toBe(true);
    expect(isAllowedUploadMime('image/jpeg')).toBe(true);
    expect(isAllowedUploadMime('image/webp')).toBe(true);
    expect(isAllowedUploadMime('image/heic')).toBe(false);
    expect(isAllowedUploadMime('image/svg+xml')).toBe(false);
    expect(isAllowedUploadMime('text/html')).toBe(false);
    expect(isAllowedUploadMime('video/')).toBe(false);
    expect(normalizeMime(' VIDEO/MP4 ;x=y')).toBe('video/mp4');
    // containers the magic-byte check can never accept are refused up front
    expect(isAllowedUploadMime('video/x-msvideo')).toBe(false);
    expect(isAllowedUploadMime('video/mpeg')).toBe(false);
    expect(isAllowedUploadMime('video/x-matroska')).toBe(true);
    expect(isAllowedUploadMime('video/3gpp')).toBe(true);
  });

  it('resolveUploadMime falls back to the extension only for unknown types', () => {
    expect(resolveUploadMime('', 'IMG_2031.MOV')).toBe('video/quicktime');
    expect(resolveUploadMime('application/octet-stream', 'polc.mkv')).toBe('video/x-matroska');
    expect(resolveUploadMime(undefined, 'foto.JPEG')).toBe('image/jpeg');
    expect(resolveUploadMime('', 'noext')).toBe('application/octet-stream');
    expect(resolveUploadMime('', 'x.constructor')).toBe('application/octet-stream');
    expect(resolveUploadMime('', 'evil.html')).toBe('application/octet-stream');
    // a declared type always wins (the content is sniffed at completion anyway)
    expect(resolveUploadMime('text/html', 'clip.mp4')).toBe('text/html');
    expect(resolveUploadMime('Video/MP4; codecs=avc1', 'a.bin')).toBe('video/mp4');
  });

  it('extensions and filenames', () => {
    expect(extensionFor('video/quicktime', 'IMG_1.MOV')).toBe('.mov');
    expect(extensionFor('video/x-msvideo', 'clip.AVI')).toBe('.avi');
    expect(extensionFor('video/x-unknown', 'noext')).toBe('.bin');
    expect(extensionFor('video/x-unknown', 'evil.mp4/../../x')).toBe('.bin');
    expect(sanitizeFilename('C:\\Users\\me\\Videos\\polc 1.mp4')).toBe('polc 1.mp4');
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a\u0000b\u202ec.mp4')).toBe('abc.mp4');
    expect(sanitizeFilename('   ')).toBe('upload');
    expect(sanitizeFilename('x'.repeat(400))).toHaveLength(255);
  });
});
