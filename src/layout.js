import * as THREE from 'three';
import * as T from './textures.js';

const { smoothstep, clamp, lerp } = THREE.MathUtils;

/** Size of the world the terrain mesh covers. */
export const EXTENT = 820;

/** Signed distance to a rounded rectangle in the XZ plane (negative inside). */
function sdRoundRect(dx, dz, hx, hz, r = 8) {
  const qx = Math.abs(dx) - hx + r;
  const qz = Math.abs(dz) - hz + r;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.min(Math.max(qx, qz), 0) + Math.hypot(ox, oz) - r;
}

function distToSegment(px, pz, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 ? clamp(((px - a.x) * vx + (pz - a.z) * vz) / len2, 0, 1) : 0;
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}

/**
 * Deterministic layout of the whole location: relief, river, roads and the
 * zones every other builder queries. Pure data — no materials, no meshes.
 */
export function makeLayout(cfg) {
  const s = cfg.site;
  const random = T.rng(cfg.seed + 7007);
  const relief = T.fbm(cfg.seed + 5, 4);
  const relief2 = T.fbm(cfg.seed + 13, 8);
  const meadowNoise = T.fbm(cfg.seed + 21, 11);
  const speck = T.fbm(cfg.seed + 37, 29);

  const river = { half: 15, waterY: -1.15 };
  river.centerZ = (x) => 252 + Math.sin(x * 0.0118 + 0.62) * 23 + Math.sin(x * 0.0305 + 2.15) * 8;
  river.dirAt = (x) => {
    const dz = river.centerZ(x + 8) - river.centerZ(x - 8);
    return Math.atan2(dz, 16);
  };

  const zone = (kind, cx, cz, hx, hz, opts = {}) => ({
    kind, cx, cz, hx, hz,
    r: opts.r ?? Math.min(10, Math.min(hx, hz)),
    pad: opts.pad ?? 13,
    strength: opts.strength ?? 1,
    crop: opts.crop ?? null,
    y: 0,
  });

  const town = zone('town', 0, 152, 66, 54, { r: 14, pad: 16 });
  const camp = zone('camp', 188, -98, 44, 32, { r: 12, pad: 15 });
  const docks = zone('docks', 74, river.centerZ(74) - 16, 30, 18, { r: 8, pad: 12 });
  const orchard = zone('orchard', -98, 198, 34, 26, { r: 10, pad: 12 });
  const pasture = zone('pasture', -172, 150, 42, 34, { r: 12, pad: 14 });
  const lumber = zone('lumber', -232, 96, 26, 22, { r: 9, pad: 12 });
  const millYard = zone('mill', -118, river.centerZ(-118) - 14, 20, 16, { r: 8, pad: 11 });
  const pond = zone('pond', -150, 60, 26, 20, { r: 18, pad: 14, strength: 0.9 });
  const quarry = zone('quarry', -178, -74, 22, 22, { r: 11, pad: 12 });
  const shrine = zone('shrine', 62, -168, 16, 16, { r: 14, pad: 10 });
  const cemetery = zone('cemetery', -58, 214, 17, 13, { r: 8, pad: 10 });
  const garrison = zone('garrison', -98, 14, 32, 24, { r: 10, pad: 14 });
  const range = zone('range', -206, -18, 62, 40, { r: 14, pad: 16 });

  const fields = [];
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      if (random() < 0.14) continue;
      const crops = ['wheat', 'wheat', 'barley', 'roots', 'fallow', 'peas'];
      fields.push(zone(
        'field',
        104 + ix * 44 + (random() - 0.5) * 6,
        86 + iz * 42 + (random() - 0.5) * 6,
        17 + random() * 4,
        16 + random() * 3,
        { r: 5, pad: 9, crop: crops[Math.floor(random() * crops.length)] },
      ));
    }
  }

  const watchtowers = [
    { x: -214, z: -150, seed: 3 },
    { x: 148, z: -214, seed: 8 },
    { x: 250, z: 26, seed: 12 },
    { x: -40, z: -252, seed: 17 },
  ];

  const roads = [
    {
      id: 'main',
      width: 7,
      pts: [
        new THREE.Vector3(0, 0, s.moatOuterHalf + 2),
        new THREE.Vector3(0, 0, 96),
        new THREE.Vector3(0, 0, 206),
        new THREE.Vector3(0, 0, river.centerZ(0)),
        new THREE.Vector3(4, 0, river.centerZ(4) + 26),
      ],
    },
    {
      id: 'cross',
      width: 5.6,
      pts: [
        new THREE.Vector3(-232, 0, 96),
        new THREE.Vector3(-172, 0, 148),
        new THREE.Vector3(-66, 0, 152),
        new THREE.Vector3(66, 0, 152),
        new THREE.Vector3(104, 0, 150),
        new THREE.Vector3(214, 0, 128),
        new THREE.Vector3(250, 0, 26),
      ],
    },
    {
      id: 'north',
      width: 4.6,
      pts: [
        new THREE.Vector3(0, 0, s.moatOuterHalf - 4),
        new THREE.Vector3(-54, 0, -34),
        new THREE.Vector3(-120, 0, -66),
        new THREE.Vector3(-178, 0, -74),
      ],
    },
    {
      id: 'ridge',
      width: 4.2,
      pts: [
        new THREE.Vector3(-178, 0, -74),
        new THREE.Vector3(-120, 0, -160),
        new THREE.Vector3(-20, 0, -196),
        new THREE.Vector3(70, 0, -172),
        new THREE.Vector3(148, 0, -214),
        new THREE.Vector3(188, 0, -128),
      ],
    },
    {
      id: 'field',
      width: 3.8,
      pts: [
        new THREE.Vector3(66, 0, 152),
        new THREE.Vector3(104, 0, 120),
        new THREE.Vector3(148, 0, 168),
        new THREE.Vector3(192, 0, 120),
        new THREE.Vector3(214, 0, 190),
      ],
    },
    {
      id: 'mill',
      width: 3.6,
      pts: [
        new THREE.Vector3(-66, 0, 152),
        new THREE.Vector3(-98, 0, 186),
        new THREE.Vector3(-140, 0, 176),
        new THREE.Vector3(-152, 0, 82),
      ],
    },
    {
      id: 'wharf',
      width: 3.4,
      pts: [
        new THREE.Vector3(0, 0, river.centerZ(0)),
        new THREE.Vector3(40, 0, river.centerZ(40) - 6),
        new THREE.Vector3(74, 0, docks.cz),
        new THREE.Vector3(118, 0, river.centerZ(118) - 10),
      ],
    },
    {
      id: 'garrison',
      width: 5,
      pts: [
        new THREE.Vector3(0, 0, 74),
        new THREE.Vector3(-26, 0, 56),
        new THREE.Vector3(-54, 0, 30),
        new THREE.Vector3(-66, 0, 14),
      ],
    },
    {
      id: 'range',
      width: 4.4,
      pts: [
        new THREE.Vector3(-130, 0, 12),
        new THREE.Vector3(-148, 0, -2),
        new THREE.Vector3(-168, 0, -14),
        new THREE.Vector3(-186, 0, -18),
      ],
    },
    {
      id: 'lumber',
      width: 3.2,
      pts: [
        new THREE.Vector3(-172, 0, 148),
        new THREE.Vector3(-206, 0, 122),
        new THREE.Vector3(-232, 0, 96),
      ],
    },
  ];

  const zones = [town, camp, docks, orchard, pasture, lumber, millYard, pond, quarry, shrine, cemetery, garrison, range, ...fields];
  const pads = watchtowers.map((w) => zone('watch', w.x, w.z, 9, 9, { r: 9, pad: 12 }));

  /** Relief before any zone is flattened — used to seat pads on the slope. */
  function rawHeight(x, z) {
    const u = x / EXTENT + 0.5;
    const v = z / EXTENT + 0.5;
    const r = Math.hypot(x, z);
    const flatR = s.moatOuterHalf + 16;
    const castleMask = smoothstep(r, flatR, flatR + 74);
    const roll = (meadowNoise(u, v) - 0.5) * 5.2 * castleMask;
    const rim = smoothstep(r, 208, 344);
    const ridge = Math.pow(relief(u, v), 1.45) * 34 + relief2(u, v) * 11;
    const hills = (ridge - 7) * rim;
    const micro = Math.sin(x * 0.055) * Math.cos(z * 0.048) * 0.3 * (1 - castleMask);
    return roll * (1 - rim * 0.45) + hills + micro;
  }

  for (const p of pads) p.y = rawHeight(p.cx, p.cz);

  function zoneAt(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const z0 of zones) {
      const d = sdRoundRect(x - z0.cx, z - z0.cz, z0.hx, z0.hz, z0.r);
      if (d < z0.pad && d < bestD) {
        bestD = d;
        best = z0;
      }
    }
    return best;
  }

  function roadDist(x, z) {
    let min = Infinity;
    for (const road of roads) {
      for (let i = 0; i < road.pts.length - 1; i++) {
        const d = distToSegment(x, z, road.pts[i], road.pts[i + 1]) - road.width * 0.5;
        if (d < min) min = d;
      }
    }
    return min;
  }

  function riverDist(x, z) {
    return Math.abs(z - river.centerZ(x));
  }

  /** Carve the river valley and the mill pond into an otherwise natural relief. */
  function carve(x, z, h) {
    const d = riverDist(x, z);
    if (d < 78) {
      const bankTop = Math.max(rawHeight(x, z), 0.9);
      const t = smoothstep(d, 2, river.half * 1.75);
      const profile = lerp(river.waterY - 2.9, bankTop + 0.5, t);
      const blend = 1 - smoothstep(d, river.half + 12, 74);
      h = lerp(h, profile, blend);
    }
    const pr = Math.hypot(x - pond.cx, z - pond.cz) / pond.hx;
    if (pr < 3.2) {
      const t = smoothstep(pr, 0.55, 1.35);
      const target = lerp(pondWaterY - 1.9, Math.max(rawHeight(x, z), 1.1), t);
      h = lerp(h, target, 1 - smoothstep(pr, 1.3, 2.6));
    }
    const qr = Math.hypot((x - quarry.cx) / quarry.hx, (z - quarry.cz) / quarry.hz);
    if (qr < 2.2) {
      const bench = qr < 0.5 ? -11 : qr < 0.78 ? -7.4 : qr < 1.06 ? -3.8 : 0.6;
      h = lerp(h, bench, 1 - smoothstep(qr, 1.06, 1.85));
    }
    /* town ditch: a shallow ring outside the burgage wall */
    const td = Math.abs(sdRoundRect(x - town.cx, z - town.cz, town.hx + 9, town.hz + 9, town.r + 6));
    if (td < 4.5) h = lerp(h, -0.9, 1 - smoothstep(td, 0, 4.5));
    return h;
  }

  const pondWaterY = -0.85;

  /** Carve the dry moat so the trench geometry is not buried by the plain. */
  function moatCarve(x, z, h) {
    const inner = sdRoundRect(x, z, s.cragHalf + 1.4, s.cragHalf + 1.4, 5);
    const outer = -sdRoundRect(x, z, s.moatOuterHalf + 1, s.moatOuterHalf + 1, 13);
    const w = Math.min(smoothstep(inner, -1, 5), smoothstep(outer, -1, 5));
    if (w <= 0) return h;
    return lerp(h, s.moatBottomY, w);
  }

  function groundY(x, z) {
    let h = rawHeight(x, z);
    const z0 = zoneAt(x, z);
    if (z0) {
      const d = sdRoundRect(x - z0.cx, z - z0.cz, z0.hx, z0.hz, z0.r);
      const w = (1 - smoothstep(d, -6, z0.pad)) * z0.strength;
      h = lerp(h, z0.y, w);
    }
    const rd = roadDist(x, z);
    if (rd < 10) {
      const w = 1 - smoothstep(rd, -1, 9);
      h = lerp(h, h * 0.35 + (z0 ? z0.y : 0) * 0.65 + 0.05, w * 0.55);
    }
    h = carve(x, z, h);
    return moatCarve(x, z, h);
  }

  const out = new THREE.Color();

  /**
   * Ground tint per biome. Vertex colors multiply the ground texture, so they
   * hover near white and only steer hue and patchiness — the texture carries
   * the detail, which keeps the map bright instead of muddy.
   */
  function biomeAt(x, z, h, outColor) {
    const u = x / EXTENT + 0.5;
    const v = z / EXTENT + 0.5;
    const s0 = speck(u * 1.15, v * 1.15);
    const s1 = speck(u * 2.7 + 0.17, v * 2.7 + 0.41);
    out.setRGB(0.86 + s1 * 0.1, 1.12, 0.66 + s1 * 0.1);
    out.lerp(new THREE.Color(1.04, 0.98, 0.7), smoothstep(s0, 0.42, 0.72) * 0.42);
    if (cfg.hillTone === 'autumn') out.lerp(new THREE.Color(1.05, 0.84, 0.5), 0.3);
    if (cfg.hillTone === 'moor') out.lerp(new THREE.Color(0.82, 0.98, 0.8), 0.28);

    const alt = clamp((h - 5) / 26, 0, 1);
    if (alt > 0) out.lerp(new THREE.Color(0.92, 0.93, 0.96), alt * 0.8);
    if (h > 23) out.lerp(new THREE.Color(1.06, 1.08, 1.12), clamp((h - 23) / 13, 0, 1) * 0.6);

    const d = riverDist(x, z);
    if (d < river.half + 10) out.lerp(new THREE.Color(1.06, 0.99, 0.78), 1 - smoothstep(d, river.half - 3, river.half + 10));

    const z0 = zoneAt(x, z);
    if (z0 && sdRoundRect(x - z0.cx, z - z0.cz, z0.hx, z0.hz, z0.r) < 0) {
      const soil = {
        town: [0.9, 0.79, 0.58], docks: [0.9, 0.8, 0.6], camp: [0.88, 0.78, 0.6],
        lumber: [0.86, 0.76, 0.58], mill: [0.9, 0.8, 0.62], quarry: [0.96, 0.96, 1],
        pond: [0.8, 0.9, 0.68], orchard: [0.86, 1.02, 0.76], pasture: [0.88, 1.04, 0.78],
        shrine: [0.92, 0.98, 0.86], cemetery: [0.9, 0.96, 0.84], garrison: [0.9, 0.8, 0.6],
        range: [0.94, 0.86, 0.68],
        wheat: [1.06, 1, 0.6], barley: [1.02, 0.98, 0.7], roots: [0.86, 0.76, 0.58],
        fallow: [0.92, 0.82, 0.62], peas: [0.78, 1.04, 0.7],
      };
      const key = z0.kind === 'field' ? z0.crop : z0.kind;
      const c = soil[key];
      if (c) out.lerp(new THREE.Color(c[0], c[1], c[2]), z0.kind === 'field' ? 0.85 : 0.6);
    }

    const rd = roadDist(x, z);
    if (rd < 3.8) out.lerp(new THREE.Color(0.94, 0.83, 0.62), 1 - smoothstep(rd, 0.2, 3.8));

    if (s1 > 0.9 && h < 5 && !z0) out.lerp(new THREE.Color(1.08, 1.04, 1.02), 0.55);

    return outColor.copy(out);
  }

  /** Reeds and willows like it wet; used by the vegetation scatter. */
  function isWet(x, z) {
    return riverDist(x, z) < river.half + 12
      || Math.hypot(x - pond.cx, z - pond.cz) < pond.hx + 9;
  }

  function isBuilt(x, z) {
    const z0 = zoneAt(x, z);
    if (!z0) return false;
    return sdRoundRect(x - z0.cx, z - z0.cz, z0.hx, z0.hz, z0.r) < -1;
  }

  return {
    cfg,
    site: s,
    random,
    roads,
    zones,
    town,
    camp,
    docks,
    orchard,
    pasture,
    lumber,
    millYard,
    pond,
    pondWaterY,
    quarry,
    shrine,
    cemetery,
    garrison,
    range,
    fields,
    watchtowers,
    river,
    riverDist,
    groundY,
    rawHeight,
    biomeAt,
    zoneAt,
    roadDist,
    isWet,
    isBuilt,
    speck,
    relief,
    relief2,
    meadowNoise,
    sdRoundRect,
    distToSegment,
  };
}
