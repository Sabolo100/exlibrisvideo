import sharp from 'sharp';
import path from 'node:path';
// usage: node scripts/make-icons.mjs  (regenerates the PWA / favicon PNGs from the logo mark)
const ROOT = process.argv[2] ?? process.cwd();
const mark = (fg = { primary: '#1f4d3a', accent: '#a87a2e', ink: '#fbf6ec' }) => `
  <path d="M6.5 1.5h19a5 5 0 0 0 5 5v23a5 5 0 0 0-5 5h-19a5 5 0 0 0-5-5v-23a5 5 0 0 0 5-5Z" fill="${fg.primary}"/>
  <path d="M8 4h16a4.5 4.5 0 0 0 4 4v20a4.5 4.5 0 0 0-4 4H8a4.5 4.5 0 0 0-4-4V8a4.5 4.5 0 0 0 4-4Z" fill="none" stroke="${fg.accent}" stroke-width="0.9" opacity="0.9"/>
  <rect x="8.6" y="12.2" width="4" height="14.8" rx="0.6" fill="${fg.ink}" opacity="0.92"/>
  <rect x="8.6" y="14" width="4" height="0.8" fill="${fg.primary}" opacity="0.55"/>
  <rect x="13.6" y="9" width="5.6" height="18" rx="0.7" fill="${fg.ink}"/>
  <rect x="13.6" y="10.8" width="5.6" height="1" fill="${fg.accent}"/>
  <rect x="13.6" y="24.2" width="5.6" height="1" fill="${fg.accent}"/>
  <path d="M14.9 15.4v5.2l4-2.6Z" fill="${fg.primary}"/>
  <rect x="21.2" y="13.2" width="3.6" height="14.4" rx="0.6" fill="${fg.ink}" opacity="0.8" transform="rotate(9 23 27.4)"/>
  <rect x="6.8" y="27.2" width="18.4" height="1.5" rx="0.5" fill="${fg.accent}"/>`;
// the mark's viewBox is 32 x 36; `scale` = share of the icon height it takes
function svg(size, bg, scale) {
  const h = size * scale;
  const k = h / 36;
  const w = 32 * k;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${bg}"/>
    <g transform="translate(${x} ${y}) scale(${k})">${mark()}</g>
  </svg>`;
}
const jobs = [
  ['public/icons/icon-192.png', 192, '#f6efe2', 0.74],
  ['public/icons/icon-512.png', 512, '#f6efe2', 0.74],
  // maskable: the platform crops to a circle / squircle – keep the mark inside the 80 % safe zone
  ['public/icons/maskable-512.png', 512, '#f6efe2', 0.56],
  ['src/app/apple-icon.png', 180, '#f6efe2', 0.7],
  ['src/app/icon.png', 96, '#f6efe2', 0.8],
];
for (const [out, size, bg, scale] of jobs) {
  await sharp(Buffer.from(svg(size, bg, scale))).png().toFile(path.join(ROOT, out));
  console.log('icon', out, size);
}
