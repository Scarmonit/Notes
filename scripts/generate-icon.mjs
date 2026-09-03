/**
 * Generates assets/icon.ico (and a 256px PNG preview) from code, no image
 * dependencies. A rounded dark tile holding a lighter "page" with text lines,
 * the first one in the app's gold accent. Shapes are signed distance fields so
 * edges stay crisp at 16px.
 *
 *   node scripts/generate-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets');

const SIZES = [16, 20, 24, 32, 48, 64, 128, 256];
const BMP_MAX = 64;

// palette (mirrors src/renderer/styles.css)
const BG_TOP = [44, 48, 55];
const BG_BOTTOM = [22, 23, 25];
const PAGE = [216, 218, 222];
const LINE = [120, 125, 134];
const ACCENT = [217, 164, 65];
const EDGE = [255, 255, 255];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

const fill = (d) => clamp01(0.5 - d);
const stroke = (d, width) => clamp01(0.5 - (Math.abs(d) - width / 2));

function over(dst, color, alpha) {
  if (alpha <= 0) return;
  const outA = alpha + dst[3] * (1 - alpha);
  if (outA <= 0) {
    dst[0] = dst[1] = dst[2] = dst[3] = 0;
    return;
  }
  for (let i = 0; i < 3; i++) dst[i] = (color[i] * alpha + dst[i] * dst[3] * (1 - alpha)) / outA;
  dst[3] = outA;
}

function geometry(size) {
  const small = size <= 32;
  return {
    tileMargin: size * (small ? 0.02 : 0.035),
    tileRadius: size * 0.225,
    edgeWidth: Math.max(1, size * 0.014),
    pageHalfW: size * (small ? 0.27 : 0.25),
    pageHalfH: size * (small ? 0.33 : 0.31),
    pageRadius: size * 0.05,
    lineH: Math.max(1, size * (small ? 0.075 : 0.06)),
    lineGap: size * (small ? 0.17 : 0.15),
    lineInset: size * 0.08,
  };
}

export function render(size) {
  const g = geometry(size);
  const c = size / 2;
  const tileHalf = c - g.tileMargin;
  const px = Buffer.alloc(size * size * 4);

  // Text lines: first is the accent "title", the rest grey, last one shorter.
  const lines = [
    { y: c - g.lineGap * 1.1, w: g.pageHalfW * 2 - g.lineInset * 2, color: ACCENT },
    { y: c, w: g.pageHalfW * 2 - g.lineInset * 2, color: LINE },
    { y: c + g.lineGap * 1.1, w: (g.pageHalfW * 2 - g.lineInset * 2) * 0.6, color: LINE },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x + 0.5;
      const sy = y + 0.5;
      const acc = [0, 0, 0, 0];

      const dTile = sdRoundRect(sx, sy, c, c, tileHalf, tileHalf, g.tileRadius);
      const tileA = fill(dTile);
      if (tileA > 0) {
        const t = clamp01((sy - g.tileMargin) / (size - 2 * g.tileMargin));
        const e = t * t * (3 - 2 * t);
        over(acc, [mix(BG_TOP[0], BG_BOTTOM[0], e), mix(BG_TOP[1], BG_BOTTOM[1], e), mix(BG_TOP[2], BG_BOTTOM[2], e)], tileA);
        over(acc, EDGE, stroke(dTile, g.edgeWidth) * tileA * mix(0.16, 0.03, e));
      }

      const dPage = sdRoundRect(sx, sy, c, c, g.pageHalfW, g.pageHalfH, g.pageRadius);
      over(acc, PAGE, fill(dPage) * tileA);

      for (const line of lines) {
        const left = c - g.pageHalfW + g.lineInset;
        const dLine = sdRoundRect(sx, sy, left + line.w / 2, line.y, line.w / 2, g.lineH / 2, g.lineH / 2);
        over(acc, line.color, fill(dLine) * tileA);
      }

      const o = (y * size + x) * 4;
      px[o] = Math.round(clamp01(acc[0] / 255) * 255);
      px[o + 1] = Math.round(clamp01(acc[1] / 255) * 255);
      px[o + 2] = Math.round(clamp01(acc[2] / 255) * 255);
      px[o + 3] = Math.round(clamp01(acc[3]) * 255);
    }
  }
  return px;
}

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO ---------------------------------------------------------------------

function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const colors = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      colors[d] = rgba[s + 2];
      colors[d + 1] = rgba[s + 1];
      colors[d + 2] = rgba[s];
      colors[d + 3] = rgba[s + 3];
    }
  }
  const mask = Buffer.alloc(size * 4 * Math.ceil(size / 32));
  return Buffer.concat([header, colors, mask]);
}

function encodeIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

// --- main --------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const images = SIZES.map((size) => {
  const rgba = render(size);
  return { size, data: size <= BMP_MAX ? encodeDib(size, rgba) : encodePng(size, rgba) };
});
const ico = encodeIco(images);
writeFileSync(join(OUT_DIR, 'icon.ico'), ico);
writeFileSync(join(OUT_DIR, 'icon.png'), encodePng(256, render(256)));
console.log(`assets/icon.ico  ${SIZES.join(', ')}px  ${(ico.length / 1024).toFixed(1)} KB`);
console.log('assets/icon.png  256px preview');
