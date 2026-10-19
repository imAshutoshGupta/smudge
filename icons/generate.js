// Generates the extension icons. Run: node icons/generate.js
//
// The mark is two dots: one sharp, one blurred away beside it. That is the
// whole product in two shapes — a personal detail, and the same detail after
// Smudge has been over it. It is the same mark the popup draws in CSS, so
// the two stay in step.
//
// No dependencies: the dots are rasterised by distance field, the blur is a
// real separable gaussian, and the PNGs are encoded with Node's built-in
// zlib. Each size is drawn at its own geometry — see TIERS.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// The popup's light-theme accent pair, so the icon and the in-popup mark are
// the same object.
const ACCENT_TOP = [141, 124, 243]; // #8d7cf3
const ACCENT_BOTTOM = [108, 92, 231]; // #6c5ce7

// --- tiny math helpers ------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- the dots ---------------------------------------------------------------

// Alpha coverage of one disc, as a Float64Array at `size`. Unit coordinates.
function renderDisc(size, cx, cy, r) {
  const out = new Float64Array(size * size);
  const px = cx * size;
  const py = cy * size;
  const rad = r * size;
  const feather = size * 0.004 + 0.75; // keeps the edge smooth at every scale
  const x0 = Math.max(0, Math.floor(px - rad - feather - 2));
  const x1 = Math.min(size - 1, Math.ceil(px + rad + feather + 2));
  const y0 = Math.max(0, Math.floor(py - rad - feather - 2));
  const y1 = Math.min(size - 1, Math.ceil(py + rad + feather + 2));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      out[y * size + x] = 1 - smoothstep(rad - feather, rad + feather, d);
    }
  }
  return out;
}

// Separable gaussian. An even blur, not a directional smear: the second dot
// is the first one *out of focus*, which is what blurring does to a face or a
// card number on screen.
function blur(src, size, sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    total += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

  const mid = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += src[y * size + clamp(x + k, 0, size - 1)] * kernel[k + radius];
      }
      mid[y * size + x] = sum;
    }
  }
  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += mid[clamp(y + k, 0, size - 1) * size + x] * kernel[k + radius];
      }
      out[y * size + x] = sum;
    }
  }
  return out;
}

// Blurring spreads a disc's alpha out, and how much it loses depends on the
// ratio of blur to radius — which changes with size. Rescaling to a fixed
// peak keeps the soft dot equally present in a 16px icon and a 128px one.
function normalisePeak(field, target) {
  let peak = 0;
  for (const v of field) if (v > peak) peak = v;
  if (peak <= 0) return field;
  const gain = target / peak;
  for (let i = 0; i < field.length; i++) field[i] = clamp(field[i] * gain, 0, 1);
  return field;
}

// --- composite + encode -----------------------------------------------------

// Rounded-square tile, antialiased.
function tileAlpha(x, y, size) {
  const r = size * 0.22;
  const px = x + 0.5;
  const py = y + 0.5;
  const dx = Math.max(r - px, px - (size - r), 0);
  const dy = Math.max(r - py, py - (size - r), 0);
  const d = Math.hypot(dx, dy) - r;
  return 1 - smoothstep(-1, 1, d);
}

// Optical sizing. At 16px the dots are barely two pixels across and the gap
// between them is one, so a blur wide enough to look soft at 128px simply
// swallows the gap. The small sizes get a tighter blur, a wider gap and more
// alpha to compensate; scaling one drawing down instead merges them into a
// single blob. The blur stays well under the dot's radius at every size —
// spread much wider than that and the soft dot stops reading as a dot and
// starts reading as a glow behind the sharp one.
const TIERS = [
  { upTo: 16, r: 0.125, sharpX: 0.3, blurX: 0.7, sigma: 0.04, peak: 1 },
  { upTo: 32, r: 0.13, sharpX: 0.315, blurX: 0.685, sigma: 0.048, peak: 0.97 },
  { upTo: Infinity, r: 0.135, sharpX: 0.325, blurX: 0.675, sigma: 0.058, peak: 0.93 },
];

function drawIcon(size) {
  const tier = TIERS.find((t) => size <= t.upTo);
  const ss = size >= 48 ? 4 : 8; // supersample factor
  const hi = size * ss;

  const sharp = renderDisc(hi, tier.sharpX, 0.5, tier.r);
  const soft = normalisePeak(
    blur(renderDisc(hi, tier.blurX, 0.5, tier.r), hi, tier.sigma * hi),
    tier.peak
  );

  // Composite the soft dot under the sharp one rather than adding them, so
  // where they overlap the alpha still tops out at 1.
  const marks = new Float64Array(hi * hi);
  for (let i = 0; i < marks.length; i++) {
    marks[i] = clamp(sharp[i] + soft[i] * (1 - sharp[i]), 0, 1);
  }

  // Composite white marks over the gradient tile, then downsample to `size`.
  const out = Buffer.alloc(size * size * 4);
  const area = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const hx = x * ss + sx;
          const hy = y * ss + sy;
          const ta = tileAlpha(hx, hy, hi);
          const grad = (hx / hi + hy / hi) / 2; // 135°, as in the popup's CSS
          const tr = ACCENT_TOP[0] + (ACCENT_BOTTOM[0] - ACCENT_TOP[0]) * grad;
          const tg = ACCENT_TOP[1] + (ACCENT_BOTTOM[1] - ACCENT_TOP[1]) * grad;
          const tb = ACCENT_TOP[2] + (ACCENT_BOTTOM[2] - ACCENT_TOP[2]) * grad;
          const m = marks[hy * hi + hx] * ta; // marks never spill past the tile
          r += (tr * (1 - m) + 255 * m) * ta;
          g += (tg * (1 - m) + 255 * m) * ta;
          b += (tb * (1 - m) + 255 * m) * ta;
          a += ta;
        }
      }
      const i = (y * size + x) * 4;
      const alpha = a / area;
      // Un-premultiply so edge pixels keep their colour.
      out[i] = Math.round(alpha > 0 ? r / a : 0);
      out[i + 1] = Math.round(alpha > 0 ? g / a : 0);
      out[i + 2] = Math.round(alpha > 0 ? b / a : 0);
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

// --- PNG encoding (no dependencies) -----------------------------------------

const crc32 =
  zlib.crc32 ||
  (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return (buf) => {
      let c = ~0;
      for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
      return ~c >>> 0;
    };
  })();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- go ---------------------------------------------------------------------

if (require.main === module) {
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(__dirname, `icon-${size}.png`);
    fs.writeFileSync(file, encodePNG(size, drawIcon(size)));
    console.log("wrote", path.relative(process.cwd(), file));
  }
}

module.exports = { drawIcon, encodePNG };
