import * as THREE from 'three';
import * as T from './textures.js';

const cache = new Map();
const key = (name, opts) => `${name}:${JSON.stringify(opts)}`;
const memo = (name, opts, build) => {
  const k = key(name, opts);
  if (!cache.has(k)) cache.set(k, build());
  return cache.get(k);
};

function makeMap(canvas, tag, repeat = 1, color = true) {
  const k = `map:${tag}:${repeat}:${color}`;
  if (!cache.has(k)) cache.set(k, T.toTexture(canvas, { repeat, color }));
  return cache.get(k);
}

/** Tri-planar-ish UV for boxes so one material tiles at a fixed world size. */
export function boxUV(geo, tile = 4) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x / tile, z / tile);
    else if (nx >= nz) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

const STONE_TONES = {
  grey: { tone: '#9aa0a8', mortar: '#5c616a' },
  warm: { tone: '#a89b86', mortar: '#6b6154' },
  cool: { tone: '#8b96a6', mortar: '#515a66' },
  dark: { tone: '#6e737b', mortar: '#3f434a' },
};

export function stone(kind = 'grey', { roughness = 0.92, tile = 4 } = {}) {
  return memo('stone', { kind, roughness }, () => {
    const { map, bump } = T.stone({ ...STONE_TONES[kind], rows: 11, cols: 6, seed: kind.length * 7 + 3 });
    return new THREE.MeshStandardMaterial({
      map: makeMap(map, `stone-${kind}`),
      bumpMap: makeMap(bump, `stone-${kind}-b`, 1, false),
      bumpScale: 0.6,
      roughness,
      metalness: 0.02,
    });
  });
}

export function rubble({ roughness = 0.95 } = {}) {
  return memo('rubble', { roughness }, () => {
    const { map, bump } = T.rubble();
    return new THREE.MeshStandardMaterial({
      map: makeMap(map, 'rubble'),
      bumpMap: makeMap(bump, 'rubble-b', 1, false),
      bumpScale: 0.9,
      roughness,
      metalness: 0,
    });
  });
}

export function ground({ tone = 'green', roughness = 1 } = {}) {
  const palettes = {
    green: {},
    autumn: { grass: '#7a7a3a', dry: '#a8863c', dirt: '#6f5a3c' },
    moor: { grass: '#5d7a55', dry: '#8f9a6a', dirt: '#6a5c48' },
    path: { grass: '#8a7350', dry: '#9c8459', dirt: '#6f5b41' },
  };
  return memo('ground', { tone, roughness }, () => {
    const c = T.ground(palettes[tone] || palettes.green);
    return new THREE.MeshStandardMaterial({
      map: makeMap(c, `ground-${tone}`),
      bumpMap: makeMap(c, `ground-${tone}`, 1, false),
      bumpScale: 0.25,
      roughness,
      metalness: 0,
    });
  });
}

export function planks({ tone = '#7c5a38', roughness = 0.85 } = {}) {
  return memo('planks', { tone, roughness }, () => {
    const { map, bump } = T.planks({ tone, boards: 6 });
    return new THREE.MeshStandardMaterial({
      map: makeMap(map, `planks-${tone}`),
      bumpMap: makeMap(bump, `planks-${tone}-b`, 1, false),
      bumpScale: 0.4,
      roughness,
      metalness: 0.05,
    });
  });
}

export function shingles({ tone = '#4b6f70', roughness = 0.8 } = {}) {
  return memo('shingles', { tone, roughness }, () => {
    const { map, bump } = T.shingles({ tone });
    return new THREE.MeshStandardMaterial({
      map: makeMap(map, `shingles-${tone}`),
      bumpMap: makeMap(bump, `shingles-${tone}-b`, 1, false),
      bumpScale: 0.7,
      roughness,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
  });
}

export function tiles({ tone = '#a4563c', roughness = 0.75 } = {}) {
  return memo('tiles', { tone, roughness }, () => {
    const { map, bump } = T.tiles({ tone });
    return new THREE.MeshStandardMaterial({
      map: makeMap(map, `tiles-${tone}`),
      bumpMap: makeMap(bump, `tiles-${tone}-b`, 1, false),
      bumpScale: 0.7,
      roughness,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
  });
}

export function thatch({ tone = '#b5924f' } = {}) {
  return memo('thatch', { tone }, () => {
    const c = T.thatch({ tone });
    return new THREE.MeshStandardMaterial({
      map: makeMap(c, `thatch-${tone}`),
      bumpMap: makeMap(c, `thatch-${tone}`, 1, false),
      bumpScale: 0.6,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  });
}

export function metal({ color = '#3a3f45', roughness = 0.42, metalness = 0.9 } = {}) {
  return memo('metal', { color, roughness, metalness }, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.9 }));
}

export function paint({ color = '#6b6257', roughness = 0.85 } = {}) {
  return memo('paint', { color, roughness }, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
}

export function foliage({ color = '#3f7a3a', roughness = 1 } = {}) {
  return memo('foliage', { color, roughness }, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true }));
}

export function bannerMaterial({ base, accent, motif, seed }) {
  return memo('banner', { base, accent, motif, seed }, () => {
    const c = T.banner({ base, accent, motif, seed });
    return new THREE.MeshStandardMaterial({
      map: makeMap(c, `banner-${base}-${motif}-${seed}`),
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  });
}

export function glow({ color = '#ffb347', intensity = 1 } = {}) {
  return memo('glow', { color, intensity }, () =>
    new THREE.MeshStandardMaterial({
      color: '#1a1208',
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      roughness: 0.6,
      metalness: 0,
    }));
}

export function water({ color = '#1f4f5a', opacity = 0.86, roughness = 0.06 } = {}) {
  return memo('water', { color, opacity, roughness }, () => {
    const normalMap = T.toTexture(T.waveNormals(256), { repeat: 1, color: false });
    return new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      roughness,
      metalness: 0.15,
      normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      envMapIntensity: 1.6,
      depthWrite: false,
    });
  });
}

export function sprite({ tag, canvas, color = '#ffffff', blending = THREE.AdditiveBlending, opacity = 1, repeat = 1 }) {
  return memo('sprite', { tag, color, blending, opacity }, () =>
    new THREE.SpriteMaterial({
      map: makeMap(canvas, `sprite-${tag}`, repeat),
      color,
      blending,
      transparent: true,
      opacity,
      depthWrite: false,
    }));
}

export function points({ tag, canvas, color = '#ffffff', size = 6, blending = THREE.NormalBlending, opacity = 0.8 }) {
  return memo('points', { tag, color, size, blending, opacity }, () =>
    new THREE.PointsMaterial({
      map: makeMap(canvas, `points-${tag}`),
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      blending,
      depthWrite: false,
    }));
}

/** Cheap fake contact shadow for units and trees. */
export function blobShadow({ opacity = 0.35 } = {}) {
  return memo('blob', { opacity }, () => {
    const c = T.softCircle({ inner: 'rgba(255,255,255,0.9)', outer: 'rgba(255,255,255,0)' });
    return new THREE.MeshBasicMaterial({
      map: makeMap(c, 'blob'),
      color: '#0b1012',
      transparent: true,
      opacity,
      depthWrite: false,
    });
  });
}

export function disposeAll() {
  for (const value of cache.values()) {
    if (value.isMaterial) value.dispose();
    else if (value.isTexture) value.dispose();
  }
  cache.clear();
}
