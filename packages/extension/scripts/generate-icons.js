import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.resolve(__dirname, '../icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// CRC32 table implementation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([len, typeBuf, data, crc]);
}

function createPng(width, height, getPixelRgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression deflate
  ihdr.writeUInt8(0, 11); // filter standard
  ihdr.writeUInt8(0, 12); // no interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines: width * 4 + 1 (filter byte 0)
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixelRgba(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Icon generator with rounded rectangle and stylized 'W' + play motif
function drawWatchPartyIcon(size) {
  const radius = Math.floor(size * 0.22);

  return createPng(size, size, (x, y, w, h) => {
    // Check rounded corners
    const left = radius;
    const right = w - 1 - radius;
    const top = radius;
    const bottom = h - 1 - radius;

    let inCorner = false;
    let dist = 0;

    if (x < left && y < top) {
      dist = Math.hypot(x - left, y - top);
      inCorner = true;
    } else if (x > right && y < top) {
      dist = Math.hypot(x - right, y - top);
      inCorner = true;
    } else if (x < left && y > bottom) {
      dist = Math.hypot(x - left, y - bottom);
      inCorner = true;
    } else if (x > right && y > bottom) {
      dist = Math.hypot(x - right, y - bottom);
      inCorner = true;
    }

    if (inCorner && dist > radius) {
      return [0, 0, 0, 0]; // Transparent outside rounded corner
    }

    // Gradient background: #6366f1 (Indigo) to #8b5cf6 (Purple) to #ec4899 (Pink)
    const t = (x + y) / (w + h);
    const bgR = Math.round(99 + (139 - 99) * t);
    const bgG = Math.round(102 + (92 - 102) * t);
    const bgB = Math.round(241 + (246 - 241) * t);

    // Subtle 1px inner glow/border
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || (inCorner && dist >= radius - 1)) {
      return [255, 255, 255, 80];
    }

    // Draw stylized 'W' symbol in the center
    const nx = (x - w / 2) / (w / 2); // -1 to 1
    const ny = (y - h / 2) / (h / 2); // -1 to 1

    // Play triangle or W shape
    // Center play triangle: vertices at (-0.3, -0.4), (-0.3, 0.4), (0.4, 0)
    const px = nx;
    const py = ny;

    // Inside play triangle?
    const inPlay = px >= -0.32 && px <= 0.38 &&
                   py >= -0.45 * (1 - (px - -0.32) / 0.70) &&
                   py <= 0.45 * (1 - (px - -0.32) / 0.70);

    if (inPlay) {
      return [255, 255, 255, 255];
    }

    return [bgR, bgG, bgB, 255];
  });
}

for (const size of [16, 48, 128]) {
  const buf = drawWatchPartyIcon(size);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath} (${size}x${size}, ${buf.length} bytes)`);
}
