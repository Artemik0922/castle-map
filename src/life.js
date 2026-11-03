import * as THREE from 'three';
import { onTick } from './runtime.js';
import { G, quadruped, figure, bird, wanderers, loopers } from './agents.js';

/**
 * The living layer: herds, flocks and working folk. Every population is one
 * InstancedMesh of a merged low-poly template with baked vertex colors, so a
 * whole herd costs one draw call and a few hundred triangles.
 */

/* ------------------------------------------------------------------ build */

export function buildLife(cfg, L) {
  const group = new THREE.Group();
  const near = new THREE.Group();
  const mid = new THREE.Group();
  group.add(mid, near);
  const agents = [];
  const groundY = (x, z) => L.groundY(x, z);

  const add = (list, spec) => {
    const a = spec.loop ? loopers(spec.parent || mid, spec) : wanderers(spec.parent || mid, spec);
    list.push(a);
    return a;
  };

  const robePalette = ['#7a6a52', '#6b5b8a', '#5b7a6b', '#8a6b5b', '#5f6b7a', '#8a7355', '#6d6a5b'];
  const tintRandom = (colors) => (i, rnd) => colors[Math.floor(rnd() * colors.length)];

  /* livestock */
  const cowGeo = quadruped({ body: '#6b4a38', head: '#4a352a', size: 1.3, tail: true, hump: false });
  add(agents, {
    geo: cowGeo, count: 9, seed: cfg.seed + 11, speed: 0.9, graze: true, scale: 1.25,
    radius: 26, heightAt: groundY, parent: mid,
    spot: (i, r) => ({ x: L.pasture.cx + (r() - 0.5) * 52, z: L.pasture.cz + (r() - 0.5) * 44, r: 12 + r() * 8 }),
    tint: tintRandom(['#6b4a38', '#8a6a4a', '#4f3a2c', '#a08059']),
  });

  const pigGeo = quadruped({ body: '#8a6f72', head: '#6f575a', size: 0.9, tail: true });
  const pigSty = { x: L.town.hx - 6, z: L.town.cz + L.town.hz * 0.55 };
  add(agents, {
    geo: pigGeo, count: 7, seed: cfg.seed + 12, speed: 0.8, graze: true, scale: 0.95,
    heightAt: groundY, parent: near,
    spot: (i, r) => ({ x: pigSty.x + (r() - 0.5) * 18, z: pigSty.z + (r() - 0.5) * 16, r: 7 }),
    tint: tintRandom(['#8a6f72', '#5f4b4e', '#a08588']),
  });

  const goatGeo = quadruped({ body: '#c8bda6', head: '#a89a80', size: 0.8, tail: true, horns: '#8a8072' });
  add(agents, {
    geo: goatGeo, count: 7, seed: cfg.seed + 13, speed: 1.3, graze: true, scale: 0.8,
    heightAt: groundY, parent: mid,
    spot: (i, r) => ({ x: L.orchard.cx + (r() - 0.5) * 44, z: L.orchard.cz + 22 + (r() - 0.5) * 16, r: 11 }),
  });

  const henGeo = bird({ body: '#d8cdb4', beak: '#d8a23a', size: 0.5, wings: true });
  add(agents, {
    geo: henGeo, count: 34, seed: cfg.seed + 14, speed: 1.5, graze: true, scale: 0.55,
    heightAt: groundY, parent: near,
    spot: (i, r) => {
      const inOrchard = i % 3 === 0;
      return inOrchard
        ? { x: L.orchard.cx + (r() - 0.5) * 40, z: L.orchard.cz + (r() - 0.5) * 30, r: 6 }
        : { x: (r() - 0.5) * 90, z: L.town.cz + (r() - 0.5) * 70, r: 7 };
    },
    tint: tintRandom(['#d8cdb4', '#b0703a', '#8a8072', '#e0d8c0']),
  });

  const duckGeo = bird({ body: '#e4e0d2', beak: '#d8a23a', wings: true, neck: 0.16 });
  add(agents, {
    geo: duckGeo, count: 11, seed: cfg.seed + 15, speed: 1.1, scale: 0.7,
    y: L.pondWaterY + 0.2, float: 0.05, parent: near,
    spot: (i, r) => (i % 2
      ? { x: L.pond.cx + (r() - 0.5) * 26, z: L.pond.cz + (r() - 0.5) * 20, r: 9 }
      : { x: -140 + r() * 280, z: L.river.centerZ(-140 + r() * 280) + (r() - 0.5) * 12, r: 14 }),
  });

  const horseGeo = quadruped({ body: '#6b5540', head: '#4f3d2c', size: 1.6, tail: true, mane: '#3a2c20' });
  add(agents, {
    geo: horseGeo, count: 8, seed: cfg.seed + 16, speed: 0.5, graze: false, scale: 1.35,
    heightAt: groundY, parent: mid,
    spot: (i, r) => ({ x: L.camp.cx - 30 + (i % 4) * 4.5, z: L.camp.cz + 14 + Math.floor(i / 4) * 4, r: 3 }),
    tint: tintRandom(['#6b5540', '#4a3b2a', '#8a7056', '#3f342a']),
  });
  add(agents, {
    geo: horseGeo, count: 3, seed: cfg.seed + 17, speed: 0.4, scale: 1.3,
    heightAt: groundY, parent: mid,
    spot: (i, r) => {
      const f = L.fields[i % L.fields.length] || L.town;
      return { x: f.cx + f.hx + 5, z: f.cz + 6, r: 4 };
    },
    tint: tintRandom(['#5f4a34', '#7a6248']),
  });

  const dogGeo = quadruped({ body: '#8a7350', head: '#6b5540', size: 0.6, tail: true });
  add(agents, {
    geo: dogGeo, count: 7, seed: cfg.seed + 18, speed: 2.1, scale: 0.72,
    heightAt: groundY, parent: near,
    spot: (i, r) => (i < 4
      ? { x: (r() - 0.5) * 80, z: L.town.cz + (r() - 0.5) * 60, r: 16 }
      : { x: L.camp.cx + (r() - 0.5) * 40, z: L.camp.cz + (r() - 0.5) * 30, r: 14 }),
    tint: tintRandom(['#8a7350', '#4a3b2a', '#a89068']),
  });

  const deerGeo = quadruped({ body: '#a8895c', head: '#8a6f48', size: 1.2, tail: true, horns: '#c8bda6' });
  add(agents, {
    geo: deerGeo, count: 6, seed: cfg.seed + 19, speed: 3.4, scale: 1.15,
    heightAt: groundY, parent: mid,
    spot: (i, r) => ({ x: -250 + r() * 90, z: -120 + r() * 160, r: 40 }),
    tint: tintRandom(['#a8895c', '#93764c']),
  });

  /* birds on the ground and on the wing */
  const crowGeo = bird({ body: '#282c31', beak: '#6b6257', wings: true });
  add(agents, {
    geo: crowGeo, count: 13, seed: cfg.seed + 20, speed: 1.6, graze: true, scale: 0.62,
    heightAt: groundY, parent: near,
    spot: (i, r) => (i % 2
      ? { x: L.shrine.cx + (r() - 0.5) * 26, z: L.shrine.cz + (r() - 0.5) * 26, r: 9 }
      : { x: L.quarry.cx + (r() - 0.5) * 40, z: L.quarry.cz + (r() - 0.5) * 34, r: 13 }),
  });

  const gullGeo = bird({ body: '#e8e6df', beak: '#d8a23a', wings: true });
  add(agents, {
    geo: gullGeo, count: 5, seed: cfg.seed + 21, speed: 4.2, scale: 0.9,
    y: L.river.waterY + 9, float: 1.6, parent: mid,
    spot: (i, r) => ({ x: -180 + r() * 360, z: L.river.centerZ(r() * 300 - 150) + (r() - 0.5) * 30, r: 60 }),
  });

  /* working folk */
  const shepherdGeo = figure({ robe: '#6d6a5b', hat: '#8a7355', pack: '#5b4630' });
  add(agents, {
    geo: shepherdGeo, count: 2, seed: cfg.seed + 22, speed: 1.2, spread: 5,
    heightAt: groundY, parent: mid,
    loop: [
      { x: L.pasture.cx - 24, z: L.pasture.cz },
      { x: L.pasture.cx, z: L.pasture.cz - 20 },
      { x: L.pasture.cx + 24, z: L.pasture.cz },
      { x: L.pasture.cx, z: L.pasture.cz + 20 },
    ],
  });

  const reaperGeo = figure({ robe: '#8a7355', bend: 0.7, prop: { geo: G.cyl(0.04, 1.5), pos: [0.7, 0.9, 0.3], rot: [0.9, 0, 0.6], color: '#b9bec4' } });
  const wheatField = L.fields.find((f) => f.crop === 'wheat') || L.fields[0];
  if (wheatField) {
    add(agents, {
      geo: reaperGeo, count: 4, seed: cfg.seed + 23, speed: 0.7, graze: true,
      heightAt: groundY, parent: near,
      spot: (i, r) => ({ x: wheatField.cx + (r() - 0.5) * wheatField.hx * 1.4, z: wheatField.cz + (r() - 0.5) * wheatField.hz * 1.4, r: 5 }),
      tint: tintRandom(robePalette),
    });
  }

  const masonGeo = figure({ robe: '#9a8b72', hat: '#c8bda6', prop: { geo: G.box(0.5, 0.4, 0.5), pos: [0.5, 0.9, 0], color: '#a8a8a2' } });
  add(agents, {
    geo: masonGeo, count: 3, seed: cfg.seed + 24, speed: 0.9, graze: true,
    heightAt: groundY, parent: near,
    spot: (i, r) => ({ x: L.quarry.cx + (r() - 0.5) * 22, z: L.quarry.cz + (r() - 0.5) * 20, r: 8 }),
  });

  const washerGeo = figure({ robe: '#cdd5dd', bend: 0.9, height: 0.8 });
  add(agents, {
    geo: washerGeo, count: 3, seed: cfg.seed + 25, speed: 0.4,
    heightAt: groundY, parent: near,
    spot: (i, r) => {
      const x = L.docks.cx - 20 + i * 14;
      return { x, z: L.river.centerZ(x) - L.river.half + 1.5, r: 3 };
    },
  });

  const fisherGeo = figure({ robe: '#5b6b7a', prop: { geo: G.cyl(0.03, 3.4), pos: [0.4, 2.2, 0], rot: [0, 0, -0.5], color: '#6b5540' } });
  add(agents, {
    geo: fisherGeo, count: 2, seed: cfg.seed + 26, speed: 0.3,
    heightAt: groundY, parent: near,
    spot: (i, r) => {
      const x = L.docks.cx - 12 + i * 18;
      return { x, z: L.river.centerZ(x) - L.river.half + 4, r: 2 };
    },
  });

  const chopperGeo = figure({ robe: '#7a5f42', prop: { geo: G.box(0.16, 0.9, 0.16), pos: [0.6, 1.5, 0], rot: [0, 0, -0.7], color: '#5b4630' } });
  add(agents, {
    geo: chopperGeo, count: 3, seed: cfg.seed + 27, speed: 0.6,
    heightAt: groundY, parent: near,
    spot: (i, r) => ({ x: L.lumber.cx + (r() - 0.5) * 26, z: L.lumber.cz + (r() - 0.5) * 22, r: 9 }),
  });

  const monkGeo = figure({ robe: '#4a4038', hat: '#3a322a', height: 1.05 });
  add(agents, {
    geo: monkGeo, count: 3, seed: cfg.seed + 28, speed: 1.1, spread: 3,
    heightAt: groundY, parent: near,
    loop: [
      { x: -30, z: L.town.cz + 16 },
      { x: -30, z: L.town.cz + 44 },
      { x: -46, z: L.town.cz + 44 },
      { x: -46, z: L.town.cz + 16 },
    ],
  });

  const soldierGeo = figure({ robe: '#5a5346', hat: '#6f757c', prop: { geo: G.cyl(0.04, 3.1), pos: [0.45, 1.5, 0], color: '#6b5334' } });
  add(agents, {
    geo: soldierGeo, count: 5, seed: cfg.seed + 29, speed: 1.5, spread: 4,
    heightAt: groundY, parent: mid,
    loop: [
      { x: L.camp.cx - 34, z: L.camp.cz - 24 },
      { x: L.camp.cx + 34, z: L.camp.cz - 24 },
      { x: L.camp.cx + 34, z: L.camp.cz + 24 },
      { x: L.camp.cx - 34, z: L.camp.cz + 24 },
    ],
    tint: tintRandom(['#5a5346', '#6b5f4a', '#4f4a42']),
  });

  const road = L.roads.find((r) => r.id === 'main') || L.roads[0];
  const travellerGeo = figure({ robe: '#6b5b8a', pack: '#8a7355' });
  add(agents, {
    geo: travellerGeo, count: 4, seed: cfg.seed + 30, speed: 2.2, spread: 3,
    heightAt: groundY, parent: mid,
    loop: road.pts.map((p) => ({ x: p.x, z: p.z })),
    tint: tintRandom(robePalette),
  });

  onTick((t, dt) => {
    for (const a of agents) a.update(dt, t);
  });

  return {
    group,
    agents,
    lod: [
      { group: near, maxRadius: 215 },
      { group: mid, maxRadius: 340 },
    ],
    stats: { populations: agents.length },
  };
}
