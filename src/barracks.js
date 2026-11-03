import * as THREE from 'three';
import * as T from './textures.js';
import * as M from './materials.js';
import * as P from './parts.js';
import * as B from './buildings.js';
import { onTick } from './runtime.js';
import {
  mergeStatic, buildCapGeometry, applyPlanarUV, roundedRectRing,
} from './geometry.js';
import { agentMaterial, figure, G, wanderers } from './agents.js';

const { lerp } = THREE.MathUtils;

/**
 * The garrison: a walled yard with barracks blocks, an armoury and a gun
 * battery, plus a company that drills on the parade ground and fires volleys
 * on command. Soldiers are two InstancedMeshes (bodies and muskets) so a
 * whole formation costs two draw calls.
 */
export function buildBarracks(cfg, L) {
  const group = new THREE.Group();
  const G0 = L.garrison;
  const random = T.rng(cfg.seed + 424242);
  const chimneys = [];
  const y = (x, z) => L.groundY(x, z);
  const stone = cfg.stoneKind;
  const banner = {
    ...cfg.faction,
    mat: M.bannerMaterial({
      base: cfg.faction.base,
      accent: cfg.faction.accent,
      motif: cfg.faction.motif,
      seed: cfg.faction.id.length * 13,
    }),
  };

  const add = (parent, obj, x, z, { dy = 0, ry = 0 } = {}) => {
    obj.position.set(x, y(x, z) + dy, z);
    obj.rotation.y = ry;
    parent.add(obj);
    return obj;
  };

  /* ------------------------------------------------------------ perimeter */
  const wallH = 4.8;
  const gate = { x: G0.cx + G0.hx, z: G0.cz };
  const ring = roundedRectRing(G0.hx, G0.hz, G0.r, 2);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (Math.hypot(mid.x - gate.x, mid.z - gate.z) < 8) continue;
    const dir = { x: b.x - a.x, z: b.z - a.z };
    const len = Math.hypot(dir.x, dir.z);
    if (len < 2) continue;
    const outward = new THREE.Vector3(mid.x - G0.cx, 0, mid.z - G0.cz).normalize();
    let yaw = -Math.atan2(dir.z, dir.x);
    const localZ = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    if (localZ.dot(outward) < 0) yaw += Math.PI;
    const run = B.curtainWall({ length: len, height: wallH, thickness: 1.8, stone, torches: i % 4 === 0 ? 2 : 0, seed: 700 + i });
    run.position.set(mid.x, y(mid.x, mid.z) - 0.1, mid.z);
    run.rotation.y = yaw;
    group.add(run);
    if (i % 2 === 0) {
      const tower = B.roundTower({
        radius: 2.9,
        height: wallH + 2.6,
        stone,
        roof: 'cone',
        roofStyle: cfg.roofStyle,
        roofTone: cfg.roofTone,
        levels: 1,
        seed: 780 + i,
      });
      tower.position.set(a.x, y(a.x, a.z) - 0.1, a.z);
      group.add(tower);
    }
  }
  const gatehouse = B.gatehouse({
    span: 13,
    height: wallH + 2.4,
    opening: 5.6,
    towerRadius: 3.4,
    stone,
    faction: banner,
    roofStyle: cfg.roofStyle,
    roofTone: cfg.roofTone,
    wallThickness: 1.8,
  });
  gatehouse.position.set(gate.x, y(gate.x, gate.z) - 0.1, gate.z);
  gatehouse.rotation.y = -Math.PI / 2;
  group.add(gatehouse);

  /* --------------------------------------------------------- parade ground */
  const drill = new THREE.Group();
  group.add(drill);
  const padX = G0.cx + 8;
  const padZ = G0.cz - 2;
  const earth = buildCapGeometry(roundedRectRing(17, 13, 5, 4), y(padX, padZ) + 0.05);
  applyPlanarUV(earth, 7);
  const pad = new THREE.Mesh(earth, new THREE.MeshStandardMaterial({ map: M.ground({ tone: 'path' }).map, color: '#8d7a5c', roughness: 1 }));
  pad.receiveShadow = true;
  pad.position.set(padX, 0, padZ);
  pad.userData.noMerge = true;
  group.add(pad);
  const stones = [];
  for (let i = 0; i < 90; i++) {
    const x = padX + (random() - 0.5) * 30;
    const z = padZ + (random() - 0.5) * 22;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y(x, z) + 0.04, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 3, 0)),
      new THREE.Vector3(0.6, 1, 0.45),
    );
    stones.push(m);
  }
  group.add(instanced(new THREE.BoxGeometry(0.9, 0.12, 0.7), M.stone('dark'), stones));

  const pole = P.bannerPole({ height: 9, faction: banner });
  add(group, pole, padX - 13, padZ + 9, { ry: 0.4 });
  onTick((t) => P.flapCloth(pole.userData.flag, t, 0.3, 2.4));

  /* -------------------------------------------------------------- buildings */
  const blocks = [
    { x: G0.cx - 18, z: G0.cz - 14, ry: 0.04, w: 26, d: 9 },
    { x: G0.cx - 16, z: G0.cz + 12, ry: -0.05, w: 24, d: 9 },
    { x: G0.cx - 26, z: G0.cz - 1, ry: Math.PI / 2, w: 18, d: 8 },
  ];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const house = B.house({
      w: b.w, d: b.d, h: 4.4,
      wallKind: i === 2 ? 'warm' : 'cool',
      roofStyle: cfg.roofStyle,
      roofTone: cfg.roofTone,
      ridgeAlong: 'x',
      timber: true,
      chimney: true,
      windows: 5,
      story: 2,
      seed: 500 + i,
    });
    add(group, house, b.x, b.z, { dy: -0.05, ry: b.ry });
    chimneys.push(...collectChimneys(house));
    const porch = new THREE.Group();
    porch.add(P.box(4, 0.3, 2.2, M.planks({ tone: '#6b5540' }), { tile: 1.2, pos: [0, 0.15, 0] }));
    for (const s of [-1.6, 1.6]) porch.add(P.cyl(0.1, 0.12, 2.6, 5, M.planks({ tone: '#5b4630' }), { tile: 0.8, pos: [s, 1.3, -0.8] }));
    porch.add(P.box(4.4, 0.2, 2.6, M.shingles({ tone: '#4b6168' }), { tile: 1, pos: [0, 2.6, -0.2], rot: [-0.18, 0, 0] }));
    add(group, porch, b.x, b.z + b.d * 0.5 + 1.4, { ry: b.ry });
  }

  const armoury = B.squareTower({ w: 12, d: 10, height: 7.4, stone, roof: 'pyramid', roofTone: cfg.roofTone, roofStyle: cfg.roofStyle, faction: banner, seed: 61 });
  add(group, armoury, G0.cx + 22, G0.cz + 14, { ry: -0.3 });
  const store = B.house({ w: 14, d: 8, h: 4, wallKind: 'warm', roofStyle: 'thatch', roofTone: '#b5924f', ridgeAlong: 'x', chimney: true, windows: 2, seed: 62 });
  add(group, store, G0.cx + 20, G0.cz - 14, { ry: 0.1 });
  chimneys.push(...collectChimneys(store));
  add(group, P.wellHouse(), G0.cx + 4, G0.cz + 14, {});
  add(group, P.granary(), G0.cx + 24, G0.cz - 2, { ry: 0.5 });

  /* weapon yard: pike bundle, shot barrels, a forge and a farrier anvil */
  const rack = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    rack.add(P.cyl(0.05, 0.05, 3.6, 5, M.planks({ tone: '#6b5334' }), { tile: 0.6, pos: [Math.cos(a) * 0.34, 1.8, Math.sin(a) * 0.34], rot: [Math.sin(a) * 0.13, 0, Math.cos(a) * 0.13] }));
    rack.add(P.cone(0.09, 0.44, 5, M.metal({ color: '#b9bec4', metalness: 1, roughness: 0.3 }), { tile: 0.4, pos: [Math.cos(a) * 0.39, 3.75, Math.sin(a) * 0.39] }));
  }
  add(group, rack, G0.cx + 14, G0.cz + 4, {});
  const forge = new THREE.Group();
  forge.add(P.box(2.4, 1.1, 1.6, M.stone('dark'), { tile: 1.4, pos: [0, 0.55, 0] }));
  forge.add(P.box(0.9, 0.7, 0.5, M.metal({ color: '#3d4147', metalness: 0.9, roughness: 0.35 }), { tile: 0.8, pos: [1.8, 0.9, 0] }));
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.7, 10), M.glow({ color: '#ff5a1e', intensity: 1.4 }));
  coals.material.userData.window = true;
  coals.rotation.x = -Math.PI / 2;
  coals.position.y = 1.12;
  forge.add(coals);
  const forgeFlame = P.flame({ size: 0.9, y: 1.2 });
  forge.add(forgeFlame);
  const forgeLight = new THREE.PointLight('#ff6a22', 18, 20, 2);
  forgeLight.position.set(0, 1.6, 0);
  forge.add(forgeLight);
  onTick((t) => {
    P.updateFlame(forgeFlame, t);
    forgeLight.intensity = 14 + Math.sin(t * 9) * 4;
  });
  add(group, forge, G0.cx + 12, G0.cz - 16, { ry: 0.4 });
  for (let i = 0; i < 6; i++) {
    add(group, P.barrel(), G0.cx + 17 + (i % 3) * 1.6, G0.cz - 8 - Math.floor(i / 3) * 1.6, { dy: 0.05, ry: random() });
  }

  /* ------------------------------------------------------------ artillery */
  const guns = [];
  const gunLineZ = G0.cz + G0.hz - 5;
  const berm = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const x = G0.cx - 22 + i * 7.4;
    berm.add(P.cone(3.6, 1.7, 9, M.ground({ tone: 'path' }), { tile: 2, pos: [x, y(x, gunLineZ + 2.4) + 0.7, gunLineZ + 2.4] }));
  }
  berm.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.userData.noMerge = true; } });
  group.add(berm);

  for (let i = 0; i < 5; i++) {
    const gx = G0.cx - 16 + i * 8;
    const gz = gunLineZ;
    const piece = cannon();
    add(group, piece, gx, gz, { ry: Math.PI / 2 + 0.12 });
    piece.userData.recoil = { v: 0 };
    guns.push(piece);
    const shot = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      shot.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 7, 5), M.metal({ color: '#23262a', roughness: 0.6, metalness: 0.5 })));
      shot.children[k].position.set((k % 3) * 0.56 - 0.28, 0.26 + Math.floor(k / 3) * 0.5, Math.floor(k / 3) * 0.1);
    }
    add(group, shot, gx - 2.6, gz - 3.4, {});
    add(group, P.barrel(), gx + 2.4, gz - 3.6, { ry: random() });
    const limber = caisson();
    add(group, limber, gx + 1, gz - 7.5, { ry: Math.PI / 2 });
  }

  const gunCrew = wanderers(drill, {
    geo: figure({ robe: '#3f4a52', hat: '#2f3236', prop: { geo: G.cyl(0.05, 1.4), pos: [0.5, 1.2, 0.2], rot: [0, 0, 0.5], color: '#6b5334' } }),
    count: 6,
    seed: cfg.seed + 61,
    speed: 0.5,
    heightAt: y,
    spot: (i, r) => ({ x: guns[i % guns.length].position.x + (r() - 0.5) * 4, z: guns[i % guns.length].position.z - 2.5 + (r() - 0.5) * 3, r: 2 }),
  });

  /* ------------------------------------------------------ the drilling company */
  const ranks = 3;
  const files = 4;
  const company = ranks * files;
  const bodyGeo = figure({ robe: cfg.faction.base, hat: '#8e979e', skin: '#d8b48a' });
  const musketGeo = new THREE.BufferGeometry();
  {
    const shaft = G.cyl(0.045, 0.05, 1.7);
    shaft.translate(0, 0.85, 0);
    const butt = G.box(0.1, 0.4, 0.16);
    butt.translate(0, 0.12, 0.06);
    musketGeo.copy(mergeTwo(shaft, butt));
  }
  const bodies = new THREE.InstancedMesh(bodyGeo, agentMaterial, company);
  const muskets = new THREE.InstancedMesh(musketGeo, M.metal({ color: '#5b4630', roughness: 0.7, metalness: 0.2 }), company);
  bodies.castShadow = true;
  muskets.castShadow = true;
  bodies.userData.noMerge = true;
  muskets.userData.noMerge = true;
  for (let i = 0; i < company; i++) {
    bodies.setColorAt(i, new THREE.Color().setHSL(0, 0, 0.78 + (i % 3) * 0.07));
  }
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  drill.add(bodies, muskets);

  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const flashMat = new THREE.MeshBasicMaterial({
    map: T.toTexture(T.softCircle({ inner: 'rgba(255,236,170,1)', outer: 'rgba(255,150,40,0)' }), { repeat: 1 }),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.InstancedMesh(flashGeo, flashMat, company);
  flash.userData.noMerge = true;
  drill.add(flash);
  const smokeMat = new THREE.MeshBasicMaterial({
    map: T.toTexture(T.puff({ size: 96, seed: 9 }), { repeat: 1 }),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const smoke = new THREE.InstancedMesh(flashGeo, smokeMat, company);
  smoke.userData.noMerge = true;
  drill.add(smoke);

  const unit = { x: padX, z: padZ, heading: 0.4, phase: 0, stage: 'march', clock: 0 };
  const puffs = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pv = new THREE.Vector3();
  const sv = new THREE.Vector3();

  const STAGES = { march: 7.5, present: 1.6, volley: 0.7, carry: 2.2 };

  onTick((t, dt) => {
    unit.clock += dt;
    const limit = STAGES[unit.stage];
    if (unit.clock > limit) {
      unit.clock = 0;
      if (unit.stage === 'march') unit.stage = 'present';
      else if (unit.stage === 'present') unit.stage = 'volley';
      else if (unit.stage === 'volley') {
        unit.stage = 'carry';
        fireVolley();
      } else unit.stage = 'march';
    }
    if (unit.stage === 'march') {
      unit.phase += dt * 0.34;
      const rx = 12.5;
      const rz = 8;
      unit.x = padX + Math.cos(unit.phase) * rx;
      unit.z = padZ + Math.sin(unit.phase) * rz;
      unit.heading = Math.atan2(Math.cos(unit.phase) * rz, -Math.sin(unit.phase) * rx) + Math.PI / 2;
    } else if (unit.stage === 'present') {
      unit.heading = lerp(unit.heading, Math.PI / 2 + 0.12, Math.min(1, dt * 4));
    }

    const raise = unit.stage === 'present' ? 1 : unit.stage === 'volley' ? 1 : unit.stage === 'carry' ? 0.25 : 0;
    for (let i = 0; i < company; i++) {
      const r = Math.floor(i / files);
      const f = i % files;
      const ox = (f - (files - 1) / 2) * 1.7;
      const oz = (r - (ranks - 1) / 2) * 1.9;
      const cs = Math.cos(unit.heading);
      const sn = Math.sin(unit.heading);
      const x = unit.x + ox * cs - oz * sn;
      const z = unit.z - ox * sn - oz * cs;
      const step = unit.stage === 'march' ? Math.abs(Math.sin(t * 5 + f * 0.9 + r * 0.4)) * 0.06 : 0;
      e.set(0, -unit.heading, 0);
      q.setFromEuler(e);
      m.compose(pv.set(x, y(x, z) + 0.78 + step, z), q, sv.set(1, 1, 1));
      bodies.setMatrixAt(i, m);

      const musketTilt = unit.stage === 'march' ? 0.5 : lerp(0.5, -1.35, raise);
      e.set(0, -unit.heading, musketTilt);
      q.setFromEuler(e);
      m.compose(pv.set(x + 0.42 * Math.cos(-unit.heading), y(x, z) + 1.05 + step, z - 0.42 * Math.sin(-unit.heading)), q, sv.set(1, 1, 1));
      muskets.setMatrixAt(i, m);

      const firing = unit.stage === 'volley' || (unit.stage === 'carry' && unit.clock < 0.35);
      const fx = x + 1.5 * Math.cos(-unit.heading);
      const fz = z - 1.5 * Math.sin(-unit.heading);
      const fs = firing ? 1.5 + Math.sin(t * 40 + i) * 0.3 : 0.0001;
      e.set(0, -unit.heading, 0);
      q.setFromEuler(e);
      m.compose(pv.set(fx, y(x, z) + 1.9, fz), q, sv.set(fs, fs, fs));
      flash.setMatrixAt(i, m);
    }
    bodies.instanceMatrix.needsUpdate = true;
    muskets.instanceMatrix.needsUpdate = true;
    flash.instanceMatrix.needsUpdate = true;

    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        puffs.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      const s = 0.6 + k * 3.4;
      e.set(0, p.yaw, 0);
      q.setFromEuler(e);
      m.compose(pv.set(p.x, p.y + k * 1.4, p.z), q, sv.set(s, s, s));
      smoke.setMatrixAt(p.slot, m);
    }
    for (let i = puffs.length; i < company; i++) {
      m.compose(pv.set(0, -50, 0), q.identity(), sv.set(0.0001, 0.0001, 0.0001));
      smoke.setMatrixAt(i, m);
    }
    smoke.instanceMatrix.needsUpdate = true;
  });

  function fireVolley() {
    for (let i = 0; i < company; i++) {
      const r = Math.floor(i / files);
      const f = i % files;
      const cs = Math.cos(unit.heading);
      const sn = Math.sin(unit.heading);
      const x = unit.x + (f - (files - 1) / 2) * 1.7 * cs - (r - (ranks - 1) / 2) * 1.9 * sn;
      const z = unit.z - (f - (files - 1) / 2) * 1.7 * sn - (r - (ranks - 1) / 2) * 1.9 * cs;
      puffs.push({
        slot: i,
        x: x + 1.6 * Math.cos(-unit.heading),
        y: y(x, z) + 1.9,
        z: z - 1.6 * Math.sin(-unit.heading),
        yaw: -unit.heading,
        life: 1.6 + (i % 4) * 0.12,
        max: 1.6 + (i % 4) * 0.12,
      });
    }
    for (const g of guns) {
      if (random() > 0.45) fireGun(g);
    }
  }

  function fireGun(g) {
    g.userData.recoil.v = 0.55;
    const dir = g.rotation.y;
    puffs.push({
      slot: puffs.length % company,
      x: g.position.x + Math.cos(-dir) * 3.2,
      y: g.position.y + 1.5,
      z: g.position.z - Math.sin(-dir) * 3.2,
      yaw: -dir,
      life: 2.4,
      max: 2.4,
    });
  }

  onTick((t, dt) => {
    for (const g of guns) {
      const r = g.userData.recoil;
      if (r.v <= 0) continue;
      r.v = Math.max(0, r.v - dt * 1.4);
      const back = Math.sin(r.v * Math.PI) * 0.7;
      g.userData.slide.position.x = -back;
      g.userData.slide.position.y = 0.05 + back * 0.06;
    }
    void t;
  });

  /* patrols and sentries */
  const sentry = wanderers(drill, {
    geo: figure({ robe: '#4a5560', hat: '#6f757c', prop: { geo: G.cyl(0.05, 3), pos: [0.5, 1.5, 0], color: '#6b5334' } }),
    count: 4,
    seed: cfg.seed + 62,
    speed: 0.35,
    heightAt: y,
    spot: (i) => ({ x: gate.x - 3 - (i % 2) * 4, z: gate.z + (i < 2 ? -3 : 3), r: 1.5 }),
  });

  onTick((t, dt) => {
    gunCrew.update(dt, t);
    sentry.update(dt, t);
  });

  group.updateMatrixWorld(true);
  mergeStatic(group, group);

  return {
    group,
    chimneys,
    lod: [{ group: drill, maxRadius: 300 }],
    stats: { guns: guns.length, company },
    volley() {
      unit.stage = 'present';
      unit.clock = 0;
    },
    fireGuns() {
      for (const g of guns) fireGun(g);
    },
  };
}

/** A gun on a carriage: the barrel rides in a `slide` subgroup for recoil. */
export function cannon() {
  const g = new THREE.Group();
  const iron = M.metal({ color: '#2e3236', roughness: 0.55, metalness: 0.85 });
  const wood = M.planks({ tone: '#5b4630', boards: 4 });
  const slide = new THREE.Group();
  const barrel = P.cyl(0.24, 0.34, 4.2, 14, iron, { tile: 1.2, pos: [0.7, 1.2, 0], rot: [0, 0, Math.PI / 2] });
  slide.add(barrel);
  slide.add(P.cyl(0.4, 0.4, 0.4, 14, iron, { tile: 1, pos: [2.7, 1.2, 0], rot: [0, 0, Math.PI / 2] }));
  slide.add(P.cyl(0.38, 0.38, 0.3, 14, iron, { tile: 1, pos: [-1.1, 1.2, 0], rot: [0, 0, Math.PI / 2] }));
  const cascabel = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), iron);
  cascabel.position.set(-1.4, 1.2, 0);
  slide.add(cascabel);
  slide.add(P.box(2.6, 0.5, 1.2, wood, { tile: 1.2, pos: [0.2, 0.95, 0] }));
  g.add(slide);
  g.userData.slide = slide;
  for (const z of [-0.62, 0.62]) {
    g.add(P.box(3.4, 0.36, 0.3, wood, { tile: 1.2, pos: [0.1, 0.72, z], rot: [0, 0, 0.05] }));
  }
  g.add(P.box(1.4, 0.6, 1.7, wood, { tile: 1.2, pos: [-1.5, 0.7, 0] }));
  for (const [x, z] of [[-0.9, -0.9], [-0.9, 0.9], [1.2, -0.82], [1.2, 0.82]]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.12, 6, 14), wood);
    wheel.position.set(x, 0.56, z);
    wheel.rotation.y = Math.PI / 2;
    wheel.castShadow = true;
    g.add(wheel);
  }
  g.add(P.box(0.1, 0.1, 1.9, wood, { tile: 0.8, pos: [-0.9, 0.56, 0] }));
  g.add(P.box(0.1, 0.1, 1.6, wood, { tile: 0.8, pos: [1.2, 0.56, 0] }));
  g.add(P.cyl(0.06, 0.07, 2.2, 5, wood, { tile: 0.6, pos: [1.9, 1.3, 0.5], rot: [0, 0, -0.9] }));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  slide.traverse((o) => { if (o.isMesh) o.userData.noMerge = true; });
  return g;
}

/** Two-wheeled caisson carrying a powder barrel. */
function caisson() {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5540', boards: 4 });
  g.add(P.box(3.2, 0.9, 1.8, wood, { tile: 1.4, pos: [0, 1.1, 0] }));
  g.add(P.cyl(0.5, 0.5, 1.2, 10, M.planks({ tone: '#4b3626' }), { tile: 1, pos: [0, 2, 0], rot: [0, 0, Math.PI / 2] }));
  for (const z of [-1.1, 1.1]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.14, 6, 16), wood);
    wheel.position.set(-0.2, 0.7, z);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
  }
  g.add(P.box(2.6, 0.2, 0.2, wood, { tile: 0.8, pos: [2.4, 0.9, 0], rot: [0, 0, -0.2] }));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function instanced(geometry, material, matrices, colors) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
    if (colors) mesh.setColorAt(i, colors[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noMerge = true;
  return mesh;
}

/** Concatenate two non-indexed geometries that already share attributes. */
function mergeTwo(a, b) {
  const out = new THREE.BufferGeometry();
  const pa = a.attributes.position.array;
  const pb = b.attributes.position.array;
  const na = a.attributes.normal.array;
  const nb = b.attributes.normal.array;
  const position = new Float32Array(pa.length + pb.length);
  position.set(pa, 0);
  position.set(pb, pa.length);
  const normal = new Float32Array(na.length + nb.length);
  normal.set(na, 0);
  normal.set(nb, na.length);
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return out;
}

function collectChimneys(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.userData && obj.userData.chimneySmoke) {
      const world = new THREE.Vector3();
      obj.getWorldPosition(world);
      out.push(world);
    }
  });
  return out;
}
