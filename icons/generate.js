// Generates the extension icons. Run: node icons/generate.js
//
// The mark is a fingerprint whose right side smears away — the fingerprint is
// the personal detail, the smear is Smudge doing its job.
//
// No dependencies: shapes are rasterised by distance field, the smear is a
// real blur, and the PNGs are encoded with Node's built-in zlib. Each size is
// drawn at its own ridge count and weight — five fine ridges read well at
// 128px and turn to mush at 16px, so the small sizes get three heavy ones.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ACCENT_TOP = [123, 108, 240]; // #7b6cf0
const ACCENT_BOTTOM = [86, 70, 208]; // #5646d0

// --- tiny math helpers ------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Distance from point to line segment.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// --- the fingerprint --------------------------------------------------------

// Each ridge is an arc over the top of an ellipse, dipping past horizontal on
// both sides, which is what reads as a fingerprint. Returned in unit space.
function ridgePolylines(tier) {
  const { ringCount, rxMin, rxMax, ryMin, ryMax } = tier;
  const cx = 0.5;
  const cyBase = 0.47;
  const lines = [];
  for (let i = 0; i < ringCount; i++) {
    const f = ringCount === 1 ? 0 : i / (ringCount - 1);
    // Egg-shaped: taller than wide, like a finger pad. The rings sit slightly
    // lower as they grow rather than nesting concentrically — perfectly
    // nested ovals read as a bullseye.
    const rx = rxMin + f * (rxMax - rxMin);
    const ry = ryMin + f * (ryMax - ryMin);
    const cy = cyBase + f * 0.035;
    // Each ridge wraps most of the way round, with a gap at the bottom that
    // widens on the outer ones, so the ridge ends splay the way a real print
    // does. Arcs spanning only the top read as a wifi symbol; closed ovals
    // read as a target. The innermost ring closes — that's the whorl core.
    const gapHalf = f * 0.72;
    const start = -Math.PI / 2 + gapHalf;
    const sweep = 2 * Math.PI - 2 * gapHalf;
    const steps = 220;
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const th = start + (sweep * s) / steps;
      pts.push([cx + rx * Math.cos(th), cy - ry * Math.sin(th)]);
    }
    lines.push(pts);
  }
  return lines;
}

// Alpha coverage of the ridges, as a Float64Array at `size`.
function renderRidges(size, tier) {
  const lines = ridgePolylines(tier);
  const half = (tier.stroke * size) / 2;
  const feather = size * 0.004 + 0.75; // keeps edges smooth at every scale
  const out = new Float64Array(size * size);

  // Only visit pixels that a ridge could possibly touch.
  const pad = half + feather + 2;
  const segs = [];
  for (const pts of lines) {
    for (let i = 1; i < pts.length; i++) {
      segs.push([
        pts[i - 1][0] * size, pts[i - 1][1] * size,
        pts[i][0] * size, pts[i][1] * size,
      ]);
    }
  }
  let minX = size, minY = size, maxX = 0, maxY = 0;
  for (const s of segs) {
    minX = Math.min(minX, s[0], s[2]);
    maxX = Math.max(maxX, s[0], s[2]);
    minY = Math.min(minY, s[1], s[3]);
    maxY = Math.max(maxY, s[1], s[3]);
  }
  const x0 = Math.max(0, Math.floor(minX - pad));
  const x1 = Math.min(size - 1, Math.ceil(maxX + pad));
  const y0 = Math.max(0, Math.floor(minY - pad));
  const y1 = Math.min(size - 1, Math.ceil(maxY + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let d = Infinity;
      for (const s of segs) {
        const dd = distToSegment(px, py, s[0], s[1], s[2], s[3]);
        if (dd < d) d = dd;
        if (d <= 0.0001) break;
      }
      const a = 1 - smoothstep(half - feather, half + feather, d);
      if (a > 0) out[y * size + x] = a;
    }
  }
  return out;
}

// --- smear ------------------------------------------------------------------

// A directional drag to the right, like ink wiped with a thumb. An even
// gaussian would halo outwards and read as a glow instead.
function smearRight(src, size, length) {
  const out = new Float64Array(size * size);
  // Triangular weights: strongest at the pixel, trailing off behind it.
  const weights = [];
  let total = 0;
  for (let k = 0; k <= length; k++) {
    const w = 1 - k / (length + 1);
    weights.push(w);
    total += w;
  }
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = 0; k <= length; k++) {
        const sx = x - k;
        if (sx < 0) break;
        sum += src[row + sx] * weights[k];
      }
      out[row + x] = sum / total;
    }
  }
  // A touch of vertical softening so the drag doesn't look like clean stripes.
  return softenVertically(out, size, Math.max(1, Math.round(length * 0.18)));
}

function softenVertically(src, size, radius) {
  const out = new Float64Array(size * size);
  const span = radius * 2 + 1;
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      sum += src[clamp(k, 0, size - 1) * size + x];
    }
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / span;
      sum -= src[clamp(y - radius, 0, size - 1) * size + x];
      sum += src[clamp(y + radius + 1, 0, size - 1) * size + x];
    }
  }
  return out;
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

// Optical sizing. A ridge needs roughly a pixel of ink and a pixel of gap to
// stay separate, so the number of ridges is set by how many pixels there are:
// five at 128, three at 32, two at 16. Scaling one drawing down instead turns
// the small sizes into a white blob.
const TIERS = [
  { upTo: 16, ringCount: 2, stroke: 0.085, rxMin: 0.145, rxMax: 0.3, ryMin: 0.175, ryMax: 0.345 },
  { upTo: 32, ringCount: 3, stroke: 0.058, rxMin: 0.1, rxMax: 0.285, ryMin: 0.125, ryMax: 0.33 },
  { upTo: Infinity, ringCount: 5, stroke: 0.036, rxMin: 0.085, rxMax: 0.285, ryMin: 0.105, ryMax: 0.33 },
];

function drawIcon(size) {
  const tier = TIERS.find((t) => size <= t.upTo);
  const detailed = size >= 48;
  const ss = detailed ? 4 : 8; // supersample factor
  const hi = size * ss;

  const sharp = renderRidges(hi, tier);
  // Keep the drag close to the ridge spacing. Much longer and the ridges melt
  // into one another and read as a glow instead of a smudge.
  const dragged = smearRight(sharp, hi, Math.max(2, Math.round(hi * 0.06)));

  // Crisp on the left, dragged on the right. The transition finishes before
  // the tile edge so the smear is visibly a smear and not just a fade-out.
  // Tiny icons start later — at 16px a long smear eats the whole print.
  const smearFrom = detailed ? 0.4 : 0.5;
  const smearTo = detailed ? 0.84 : 0.9;
  const marks = new Float64Array(hi * hi);
  for (let y = 0; y < hi; y++) {
    for (let x = 0; x < hi; x++) {
      const i = y * hi + x;
      const t = smoothstep(smearFrom, smearTo, x / hi);
      const smeared = clamp(dragged[i] * 1.9, 0, 1); // the drag thins it out
      marks[i] = clamp(sharp[i] * (1 - t) + smeared * t, 0, 1);
    }
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
          const grad = hy / hi;
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
