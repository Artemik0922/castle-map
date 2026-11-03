import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surface(w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d'), w, h };
}

function toTexture(canvas, { repeat = 1, color = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function tint(hex, factor) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return `rgb(${Math.round(Math.min(c.r, 1) * 255)},${Math.round(Math.min(c.g, 1) * 255)},${Math.round(Math.min(c.b, 1) * 255)})`;
}

function grain(ctx, w, h, amount, random) {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() * 2 - 1) * amount * 255;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

function lattice(size, cells) {
  const random = rng(97);
  const grid = [];
  for (let i = 0; i <= cells; i++) {
    grid[i] = [];
    for (let j = 0; j <= cells; j++) grid[i][j] = random();
  }
  const step = size / cells;
  const out = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / step), gy = Math.floor(y / step);
      const fx = smooth((x - gx * step) / step), fy = smooth((y - gy * step) / step);
      const nx = (gx + 1) % cells, ny = (gy + 1) % cells;
      const a = grid[gx][gy], b = grid[nx][gy], c = grid[gx][ny], d = grid[nx][ny];
      out[y * size + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }
  }
  return out;
}

/** Tiling masonry: courses with half-offset rows. Colour and bump share one seed, so they align. */
function masonry(mode, { tone, mortar, rows, cols, seed }) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  const bump = mode === 'bump';
  ctx.fillStyle = bump ? '#4a4a4a' : mortar;
  ctx.fillRect(0, 0, S, S);
  const rh = S / rows;
  const cw = S / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * 0.5;
    for (let i = -1; i <= cols; i++) {
      const x = (i + offset) * cw + 2;
      const y = r * rh + 2;
      const w = cw - 4;
      const h = rh - 4;
      const shade = 0.8 + random() * 0.34;
      ctx.fillStyle = bump ? `rgb(${Math.round(shade * 200)},${Math.round(shade * 200)},${Math.round(shade * 200)})` : tint(tone, shade);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = bump ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 2, y + 1, w - 4, 2);
      ctx.fillStyle = bump ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 2, y + h - 3, w - 4, 3);
      if (!bump) {
        for (let s = 0; s < 14; s++) {
          const px = x + random() * w, py = y + random() * h;
          ctx.fillStyle = random() > 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)';
          ctx.fillRect(px, py, 2 + random() * 3, 1 + random() * 2);
        }
      }
    }
  }
  grain(ctx, S, S, bump ? 0.05 : 0.05, rng(seed + 5));
  return canvas;
}

export function stone({ tone = '#949aa2', mortar = '#5a5f66', rows = 10, cols = 5, seed = 3 } = {}) {
  const opts = { tone, mortar, rows, cols, seed };
  return { map: masonry('color', opts), bump: masonry('bump', opts) };
}

/** Irregular stonework for the crag / cliff face. */
function rubbleCanvas(seed, light) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  ctx.fillStyle = light ? '#808080' : '#4d5157';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    const cx = random() * S, cy = random() * S;
    const rad = 12 + random() * 34;
    const sides = 5 + Math.floor(random() * 4);
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const rr = rad * (0.66 + random() * 0.5);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    const shade = 0.7 + random() * 0.5;
    ctx.fillStyle = light
      ? `rgba(${Math.round(shade * 255)},${Math.round(shade * 255)},${Math.round(shade * 255)},0.95)`
      : tint('#6d6a63', shade);
    ctx.fill();
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  grain(ctx, S, S, 0.08, rng(seed + 9));
  return canvas;
}

export function rubble() {
  return { map: rubbleCanvas(21, false), bump: rubbleCanvas(21, true) };
}

function plankCanvas(mode, { tone, boards, seed }) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  const bump = mode === 'bump';
  ctx.fillStyle = bump ? '#888' : tint(tone, 0.7);
  ctx.fillRect(0, 0, S, S);
  const bh = S / boards;
  for (let b = 0; b < boards; b++) {
    const y = b * bh;
    const shade = 0.78 + random() * 0.4;
    ctx.fillStyle = bump ? `rgb(${Math.round(shade * 210)},${Math.round(shade * 210)},${Math.round(shade * 210)})` : tint(tone, shade);
    ctx.fillRect(0, y + 1, S, bh - 2);
    ctx.fillStyle = bump ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, y, S, 2);
    for (let g = 0; g < 60; g++) {
      const gy = y + 4 + random() * (bh - 8);
      ctx.strokeStyle = random() > 0.5 ? (bump ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)') : (bump ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)');
      ctx.lineWidth = 1 + random();
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= S; x += 32) ctx.lineTo(x, gy + Math.sin((x / S) * 6.283 + g) * 1.6);
      ctx.stroke();
    }
    if (random() > 0.55) {
      const kx = random() * S, ky = y + bh * 0.5;
      for (let ring = 5; ring > 0; ring--) {
        ctx.strokeStyle = bump ? `rgba(0,0,0,${0.1 * ring})` : 'rgba(0,0,0,0.16)';
        ctx.beginPath();
        ctx.ellipse(kx, ky, ring * 2.6, ring * 1.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  grain(ctx, S, S, 0.05, rng(seed + 3));
  return canvas;
}

export function planks({ tone = '#7c5a38', boards = 7, seed = 11 } = {}) {
  return { map: plankCanvas('color', { tone, boards, seed }), bump: plankCanvas('bump', { tone, boards, seed }) };
}

/** Scalloped wooden shingles, used on round tower roofs. */
function shingleCanvas(mode, { tone, seed }) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  const bump = mode === 'bump';
  ctx.fillStyle = bump ? '#777' : tint(tone, 0.55);
  ctx.fillRect(0, 0, S, S);
  const rows = 12, cols = 10;
  const rh = S / rows, cw = S / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * 0.5 * cw;
    for (let i = -1; i <= cols; i++) {
      const x = i * cw + offset, y = r * rh;
      const shade = 0.75 + random() * 0.45;
      ctx.fillStyle = bump ? `rgb(${Math.round(shade * 200)},${Math.round(shade * 200)},${Math.round(shade * 200)})` : tint(tone, shade);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + cw, y);
      ctx.lineTo(x + cw, y + rh);
      ctx.quadraticCurveTo(x + cw * 0.5, y + rh * 1.55, x, y + rh);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bump ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + rh - 2, cw, 2);
    }
  }
  grain(ctx, S, S, 0.06, rng(seed + 7));
  return canvas;
}

export function shingles({ tone = '#4a6b6d', seed = 31 } = {}) {
  return { map: shingleCanvas('color', { tone, seed }), bump: shingleCanvas('bump', { tone, seed }) };
}

/** Clay roof tiles for rectangular roofs. */
function tileCanvas(mode, { tone, seed }) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  const bump = mode === 'bump';
  ctx.fillStyle = bump ? '#707070' : tint(tone, 0.6);
  ctx.fillRect(0, 0, S, S);
  const rows = 9, cols = 8;
  const rh = S / rows, cw = S / cols;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cw, y = r * rh;
      const shade = 0.8 + random() * 0.38;
      ctx.fillStyle = bump ? `rgb(${Math.round(shade * 220)},${Math.round(shade * 220)},${Math.round(shade * 220)})` : tint(tone, shade);
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1, cw - 3, rh * 1.12, 5);
      ctx.fill();
      ctx.fillStyle = bump ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 1.5, y + rh * 1.0, cw - 3, 3);
    }
  }
  grain(ctx, S, S, 0.05, rng(seed + 13));
  return canvas;
}

export function tiles({ tone = '#a4563c', seed = 41 } = {}) {
  return { map: tileCanvas('color', { tone, seed }), bump: tileCanvas('bump', { tone, seed }) };
}

export function thatch({ tone = '#b5924f', seed = 51 } = {}) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  ctx.fillStyle = tint(tone, 0.6);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = random() * S, y = random() * S;
    const len = 10 + random() * 26;
    ctx.strokeStyle = tint(tone, 0.6 + random() * 0.75);
    ctx.globalAlpha = 0.5 + random() * 0.5;
    ctx.lineWidth = 1 + random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y + 3 + random() * 4, x + len, y + random() * 7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  grain(ctx, S, S, 0.07, rng(seed + 3));
  return canvas;
}

export function ground({ grass = '#6fa854', dry = '#a3b762', dirt = '#8a7352', seed = 61 } = {}) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const random = rng(seed);
  const n1 = lattice(S, 4);
  const n2 = lattice(S, 12);
  const n3 = lattice(S, 32);
  ctx.clearRect(0, 0, S, S);
  const image = ctx.createImageData(S, S);
  const d = image.data;
  const cg = new THREE.Color(grass), cd = new THREE.Color(dry), ce = new THREE.Color(dirt);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = n1[i] * 0.6 + n2[i] * 0.3 + n3[i] * 0.1;
      let col = cg.clone().lerp(cd, Math.max(0, (v - 0.45) * 2.1));
      if (n3[i] > 0.72) col = col.clone().lerp(ce, (n3[i] - 0.72) * 2.2);
      const p = i * 4;
      d[p] = col.r * 255;
      d[p + 1] = col.g * 255;
      d[p + 2] = col.b * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 5200; i++) {
    const x = random() * S, y = random() * S;
    ctx.strokeStyle = random() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() * 4 - 2), y - 3 - random() * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  grain(ctx, S, S, 0.05, rng(seed + 17));
  return canvas;
}

/** Wave normal map from a tileable height field. */
export function waveNormals(size = 256) {
  const n = lattice(size, 6), m = lattice(size, 16);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = n[i] * 0.7 + m[i] * 0.3;
  const { canvas, ctx } = surface(size);
  const image = ctx.createImageData(size, size);
  const d = image.data;
  const strength = 3.2;
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const p = (y * size + x) * 4;
      d[p] = ((-dx / len) * 0.5 + 0.5) * 255;
      d[p + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      d[p + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function foam({ seed = 71 } = {}) {
  const S = 512;
  const { canvas, ctx } = surface(S);
  const n = lattice(S, 8), m = lattice(S, 24);
  const image = ctx.createImageData(S, S);
  const d = image.data;
  for (let i = 0; i < n.length; i++) {
    const v = n[i] * 0.55 + m[i] * 0.45;
    const a = Math.max(0, (v - 0.52) * 3.1);
    const p = i * 4;
    d[p] = d[p + 1] = d[p + 2] = 255;
    d[p + 3] = Math.min(1, a) * 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function softCircle({ inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128 } = {}) {
  const { canvas, ctx } = surface(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer.replace(/,0\)$/, ',0.35)').replace('1)', '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export function puff({ size = 128, seed = 5 } = {}) {
  const { canvas, ctx } = surface(size);
  const random = rng(seed);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const x = random() * size, y = random() * size, r = 4 + random() * 16;
    const bite = ctx.createRadialGradient(x, y, 0, x, y, r);
    bite.addColorStop(0, `rgba(0,0,0,${0.25 + random() * 0.5})`);
    bite.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bite;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Pennant with a heraldic charge, drawn for a faction palette. */
export function banner({ base = '#2f6fb2', accent = '#e8e2cf', motif = 'chevron', seed = 9 } = {}) {
  const W = 256, H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const random = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H * 0.42);
  ctx.fillStyle = accent;
  if (motif === 'chevron') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-70, -46 + i * 34);
      ctx.lineTo(0, -8 + i * 34);
      ctx.lineTo(70, -46 + i * 34);
      ctx.lineTo(70, -26 + i * 34);
      ctx.lineTo(0, 12 + i * 34);
      ctx.lineTo(-70, -26 + i * 34);
      ctx.closePath();
      ctx.globalAlpha = 0.9 - i * 0.18;
      ctx.fill();
    }
  } else if (motif === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 34 : 76;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const p = i === 0 ? 'moveTo' : 'lineTo';
      ctx[p](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  } else if (motif === 'cross') {
    ctx.fillRect(-16, -80, 32, 160);
    ctx.fillRect(-72, -16, 144, 32);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(30, 22);
    ctx.lineTo(-30, 22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = accent;
  for (let y = 12; y < H - 8; y += 26) ctx.fillRect(6, y, 5, 12);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(random() * W, random() * H, 3, 2);
  }
  return canvas;
}

export function skyGradient({ top = '#2a6ba8', bottom = '#cfe3ee', sun = '#ffffff', sunAt = 0.6 } = {}) {
  const W = 256, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * sunAt, H * 0.32, 0, W * sunAt, H * 0.32, H * 0.55);
  glow.addColorStop(0, sun);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  return canvas;
}

/** Tileable value-noise sampler; x,y in [0,1). */
export function noise2D(seed = 1, cells = 16) {
  const random = rng(seed);
  const grid = [];
  for (let i = 0; i < cells; i++) {
    grid[i] = [];
    for (let j = 0; j < cells; j++) grid[i][j] = random();
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x * cells, fy = y * cells;
    const x0 = Math.floor(fx) % cells, y0 = Math.floor(fy) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const u = smooth(fx - Math.floor(fx)), v = smooth(fy - Math.floor(fy));
    const a = grid[x0][y0], b = grid[x1][y0], c = grid[x0][y1], d = grid[x1][y1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
}

export function fbm(seed = 1, cells = 8) {
  const a = noise2D(seed, cells), b = noise2D(seed + 31, cells * 2), c = noise2D(seed + 57, cells * 4);
  return (x, y) => a(x, y) * 0.55 + b(x, y) * 0.29 + c(x, y) * 0.16;
}

export const tex = {
  stone: (opts) => toTexture(stone(opts).map, opts),
};

export { toTexture, surface, tint, lattice, grain };
