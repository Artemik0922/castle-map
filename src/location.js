import * as THREE from 'three';
import * as T from './textures.js';
import * as M from './materials.js';
import * as P from './parts.js';
import * as B from './buildings.js';
import { onTick } from './runtime.js';
import {
  resample, ribbonGeometry, mergeStatic, splitBySize, buildCapGeometry, applyPlanarUV,
  roundedRectRing,
} from './geometry.js';
import { FACTIONS } from './castle.js';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const V = (x, z) => new THREE.Vector3(x, 0, z);

/**
 * Everything outside the castle walls: the river and its works, the town,
 * fields, orchards, pasture, quarry, watchtowers, shrine and the besiegers'
 * camp. All of it is derived from the layout, so a new seed moves the world,
 * not just the fortress.
 */
export function buildLocation(cfg, L) {
  const group = new THREE.Group();
  const overlay = new THREE.Group();
  const random = T.rng(cfg.seed + 31337);
  const chimneys = [];
  const stone = cfg.stoneKind;
  const roofTone = cfg.roofTone;
  const crowd = [];
  const soilMats = new Map();
  const soilMat = (hex) => {
    if (!soilMats.has(hex)) {
      soilMats.set(hex, new THREE.MeshStandardMaterial({ map: M.ground({ tone: 'path' }).map, color: hex, roughness: 1 }));
    }
    return soilMats.get(hex);
  };
  const y = (x, z) => L.groundY(x, z);
  const ownBanner = {
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

  /* ---------------------------------------------------------------- roads */
  function roadRibbon(pts, width, mat, { uvScale = 7, lift = 0.07 } = {}) {
    const geo = ribbonGeometry(resample(pts, 5), width * 0.5, y, uvScale, lift);
    applyPlanarUV(geo, 9);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Cut a road at the river: the bridge owns the gap. */
  function splitAtRiver(pts, margin = 1) {
    const dense = resample(pts, 4);
    const runs = [];
    let run = [];
    for (const p of dense) {
      if (L.riverDist(p.x, p.z) > L.river.half + margin) {
        run.push(p);
      } else {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (run.length > 1) runs.push(run);
    return runs;
  }

  const pathMat = M.ground({ tone: 'path' });
  const rutMat = new THREE.MeshStandardMaterial({ map: pathMat.map, color: '#6a5840', roughness: 1 });
  for (const road of L.roads) {
    for (const run of splitAtRiver(road.pts)) {
      group.add(roadRibbon(run, road.width, pathMat));
      if (road.width > 5) {
        for (const s of [-1, 1]) {
          const shifted = run.map((p) => V(p.x + s * road.width * 0.22, p.z + 0.4));
          group.add(roadRibbon(shifted, road.width * 0.16, rutMat, { uvScale: 4, lift: 0.02 }));
        }
      }
    }
    if (road.id === 'main') {
      const posts = resample(road.pts, 22);
      for (let i = 2; i < posts.length - 1; i++) {
        const p = posts[i];
        if (L.riverDist(p.x, p.z) < L.river.half + 22) continue;
        for (const s of [-1, 1]) {
          const px = p.x + s * (road.width * 0.5 + 1.4);
          const pz = p.z + 0.2;
          group.add(P.cyl(0.13, 0.17, 2.5, 5, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [px, y(px, pz) + 1.25, pz] }));
        }
      }
      for (const z of [L.site.moatOuterHalf + 16, 88, 214]) {
        const lamp = P.flame({ size: 0.62, y: 3.5 });
        lamp.position.set(road.width * 0.5 + 1.6, y(z === 88 ? 4 : 4, z) + 3.6, z);
        group.add(lamp);
        group.add(P.cyl(0.15, 0.2, 3.8, 6, M.planks({ tone: '#5f4a34' }), { tile: 1, pos: [lamp.position.x, y(4, z) + 1.9, z] }));
        onTick((t) => P.updateFlame(lamp, t));
        const light = new THREE.PointLight('#ff9b3e', 10, 20, 2);
        light.position.copy(lamp.position);
        group.add(light);
      }
    }
  }
  /* wayside cross at the crossroads */
  {
    const cx = 66, cz = 152;
    const cross = new THREE.Group();
    cross.add(P.box(0.3, 4.4, 0.3, M.stone('warm'), { tile: 1.4, pos: [0, 2.2, 0] }));
    cross.add(P.box(1.9, 0.28, 0.28, M.stone('warm'), { tile: 1.4, pos: [0, 3.5, 0] }));
    cross.add(P.box(1.1, 0.5, 1.1, M.stone('dark'), { tile: 1.4, pos: [0, 0.25, 0] }));
    const glow = P.glowSprite({ size: 1.4, color: '#ffd27a', pos: [0, 1.6, 0.4], opacity: 0.5 });
    cross.add(glow);
    add(group, cross, cx, cz, { ry: 0.4 });
  }

  /* ---------------------------------------------------------------- river */
  const riverSpine = [];
  for (let x = -404; x <= 404; x += 5) riverSpine.push(V(x, L.river.centerZ(x)));
  const waterMat = M.water({ color: '#26555f', opacity: 0.84, roughness: 0.07 });
  const waterGeo = ribbonGeometry(riverSpine, L.river.half, () => L.river.waterY, 20);
  applyPlanarUV(waterGeo, 17);
  const riverWater = new THREE.Mesh(waterGeo, waterMat);
  riverWater.renderOrder = 2;
  riverWater.userData.noMerge = true;
  group.add(riverWater);

  const beachMat = M.ground({ tone: 'moor' });
  const beachGeo = ribbonGeometry(resample(riverSpine, 6), (a, t) => L.river.half + 5.5 + Math.sin(a * 0.05 + t) * 2.2, (x, z) => Math.min(y(x, z), L.river.waterY + 0.55), 12, 0.04);
  applyPlanarUV(beachGeo, 11);
  const beach = new THREE.Mesh(beachGeo, beachMat);
  beach.receiveShadow = true;
  beach.userData.noMerge = true;
  group.add(beach);

  const foamMat = new THREE.MeshBasicMaterial({
    map: T.toTexture(T.foam({ seed: 21 }), { repeat: 1 }),
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const s of [-1, 1]) {
    const edge = riverSpine.map((p) => V(p.x, p.z + s * (L.river.half - 1.2)));
    const geo = ribbonGeometry(edge, 1.5, () => L.river.waterY + 0.05, 10);
    applyPlanarUV(geo, 14);
    const foam = new THREE.Mesh(geo, foamMat);
    foam.renderOrder = 3;
    foam.userData.noMerge = true;
    group.add(foam);
  }
  onTick((t, dt) => {
    const n = waterMat.normalMap;
    n.offset.x = (n.offset.x + dt * 0.011) % 1;
    n.offset.y = (n.offset.y + dt * 0.006) % 1;
    foamMat.map.offset.x = (foamMat.map.offset.x - dt * 0.03) % 1;
    riverWater.position.y = Math.sin(t * 0.5) * 0.03;
  });

  /* reed belts, willows and alder thickets along the banks */
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const reedX = [];
    for (let x = -390; x < 390; x += 3) {
      if (random() > 0.42) continue;
      const zc = L.river.centerZ(x);
      const side = random() > 0.5 ? 1 : -1;
      const z = zc + side * (L.river.half - 1 + random() * 2.4);
      if (L.isBuilt(x, z)) continue;
      reedX.push([x, z]);
    }
    const reedGeo = new THREE.ConeGeometry(0.09, 2.4, 3, 1, true);
    const reeds = new THREE.InstancedMesh(reedGeo, M.foliage({ color: '#6d7f45' }), reedX.length * 5);
    let i = 0;
    for (const [x, z] of reedX) {
      for (let k = 0; k < 5; k++) {
        const px = x + (random() - 0.5) * 3.4;
        const pz = z + (random() - 0.5) * 2.2;
        const s = 0.7 + random() * 0.8;
        q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.3, random() * 6.283, (random() - 0.5) * 0.3));
        m.compose(pos.set(px, L.river.waterY + 1.15 * s, pz), q, sc.set(s, s, s));
        reeds.setMatrixAt(i++, m);
      }
    }
    reeds.instanceMatrix.needsUpdate = true;
    group.add(reeds);

    for (let k = 0; k < 46; k++) {
      const x = -360 + random() * 720;
      const zc = L.river.centerZ(x);
      const side = random() > 0.5 ? 1 : -1;
      const z = zc + side * (L.river.half + 4 + random() * 7);
      if (L.isBuilt(x, z) || L.roadDist(x, z) < 5) continue;
      add(group, willow(random), x, z, { ry: random() * 6.283 });
    }
    for (let k = 0; k < 26; k++) {
      const x = -360 + random() * 720;
      const zc = L.river.centerZ(x);
      const z = zc + (random() > 0.5 ? 1 : -1) * (L.river.half + 2 + random() * 4);
      if (L.isBuilt(x, z)) continue;
      add(group, P.rock({ scale: 0.6 + random() * 1.1, seed: k }), x, z, { ry: random() * 6.283 });
    }
  }

  function willow(rng) {
    const g = new THREE.Group();
    const bark = M.planks({ tone: '#5a4d3a', boards: 4 });
    const leaf = M.foliage({ color: '#6f8a42' });
    g.add(P.cyl(0.34, 0.62, 4.4, 7, bark, { tile: 1.6, pos: [0, 2.2, 0] }));
    g.add(P.cyl(0.2, 0.3, 2.2, 5, bark, { tile: 1.2, pos: [0.7, 4.6, 0.3], rot: [0, 0, -0.7] }));
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5, 1), leaf);
    crown.position.y = 5.4;
    const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), leaf);
    crown2.position.set(-1.5, 4.9, 0.6);
    g.add(crown, crown2);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const strand = P.cone(0.34, 3.4, 4, leaf, { tile: 2, pos: [Math.cos(a) * 2.1, 3.9, Math.sin(a) * 2.1], rot: [Math.PI, 0, 0] });
      g.add(strand);
    }
    g.scale.setScalar(0.8 + rng() * 0.5);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /* bridge + bridgegate on the main road */
  {
    const z0 = L.river.centerZ(0);
    const span = B.bridge({ length: (L.river.half + 5) * 2, width: 8.4, stone });
    span.position.set(0, L.river.waterY + 1.95, z0);
    span.rotation.y = L.river.dirAt(0);
    group.add(span);
    for (const s of [-1, 1]) {
      const gx = s * 5.2;
      const gz = z0 + s * (L.river.half + 7);
      const tower = B.squareTower({ w: 6, d: 6, height: 9, stone, roof: 'pyramid', roofTone, roofStyle: cfg.roofStyle, faction: null, seed: 70 + s });
      add(group, tower, gx, gz, { dy: 0.1, ry: s });
    }
    for (const s of [-1, 1]) {
      const pier = P.box(2.2, 1.4, 9, M.stone('dark'), { tile: 2.4, pos: [s * 3.4, L.river.waterY - 1.4, z0] });
      group.add(pier);
    }
  }

  /* watermill on the river, west of town */
  {
    const mx = L.millYard.cx;
    const mz = L.river.centerZ(mx);
    const mill = B.house({ w: 9, d: 12, h: 6.4, wallKind: 'warm', roofStyle: 'tile', roofTone: '#8a4b36', ridgeAlong: 'x', chimney: true, windows: 3, seed: 71 });
    add(group, mill, mx, mz - 15, { dy: 0.2, ry: Math.PI / 2 + L.river.dirAt(mx) });
    chimneys.push(...collectChimneys(mill));
    const wheel = waterwheel({ radius: 4.4, paddles: 12 });
    wheel.position.set(mx + 5.4, L.river.waterY + 2.6, mz - 2.5);
    wheel.rotation.y = Math.PI / 2;
    group.add(wheel);
    onTick((t, dt) => { wheel.userData.spin.rotation.z -= dt * 0.75; void t; });
    const leat = roadRibbon([V(mx - 26, mz - 6), V(mx + 6, mz - 4)], 3.2, M.planks({ tone: '#6b5540' }), { lift: 0.35, uvScale: 5 });
    group.add(leat);
    for (let i = 0; i < 4; i++) {
      add(group, P.barrel(), mx - 8 + i * 2.4, mz - 22 + (i % 2) * 3, { dy: 0.05 });
    }
    add(group, P.cart({ seed: 5 }), mx - 14, mz - 20, { ry: 0.7 });
  }

  function waterwheel({ radius = 4, paddles = 10 }) {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    const wood = M.planks({ tone: '#7a5f42', boards: 4 });
    const metal = M.metal({ color: '#4a4741', roughness: 0.5, metalness: 0.7 });
    spin.add(P.cyl(radius * 0.16, radius * 0.16, 2.4, 10, metal, { tile: 1, pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0] }));
    for (let i = 0; i < paddles; i++) {
      const a = (i / paddles) * Math.PI * 2;
      const paddle = P.box(0.9, 0.24, 2.2, wood, { tile: 1, pos: [Math.cos(a) * radius, Math.sin(a) * radius, 0] });
      paddle.rotation.z = a;
      spin.add(paddle);
      const spoke = P.box(radius, 0.18, 0.18, wood, { tile: 1, pos: [Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5, 0.9] });
      spoke.rotation.z = a;
      spin.add(spoke);
    }
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.13, 6, 22), wood);
      rim.position.z = s * 1.05;
      spin.add(rim);
    }
    g.add(spin);
    g.add(P.box(1.2, 3.2, 2.6, M.stone('dark'), { tile: 2, pos: [0, -1.4, 0] }));
    g.userData.spin = spin;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.noMerge = true; } });
    return g;
  }

  /* docks and wharf, east of the bridge */
  {
    const D = L.docks;
    for (let i = 0; i < 4; i++) {
      const px = D.cx - 18 + i * 13;
      const zc = L.river.centerZ(px);
      const pier = new THREE.Group();
      const len = 20;
      pier.add(P.box(4.2, 0.4, len, M.planks({ tone: '#7c5a38' }), { tile: 2.2, pos: [0, 0.9, len / 2] }));
      for (let k = 0; k < 5; k++) {
        for (const s of [-1.7, 1.7]) {
          pier.add(P.cyl(0.22, 0.28, 5.4, 6, M.planks({ tone: '#5b4630' }), { tile: 1, pos: [s, -1.4, 3 + k * (len / 5)] }));
        }
      }
      pier.add(P.box(4.6, 0.3, 1.2, M.planks({ tone: '#6b5540' }), { tile: 1.4, pos: [0, 1.05, len + 0.4] }));
      pier.position.set(px, y(px, zc - 6) + 0.2, zc - 8);
      pier.rotation.y = L.river.dirAt(px);
      group.add(pier);
      if (i % 2 === 0) group.add(mooredBoat(random, px + 3.2, zc + 1.5, 0.3 + random() * 0.5));
      for (let c = 0; c < 3; c++) {
        const crate = P.crate(0.8 + random() * 0.5);
        crate.position.set(-1.4 + c * 1.5, 1.45, 4 + random() * 10);
        crate.rotation.y = random() * 3;
        pier.add(crate);
      }
      const drum = P.barrel();
      drum.position.set(1.4, 1.4, 8);
      pier.add(drum);
    }
    const shed = B.house({ w: 12, d: 8, h: 4.4, wallKind: 'warm', roofStyle: 'thatch', roofTone: '#b5924f', ridgeAlong: 'x', chimney: true, windows: 1, seed: 73 });
    add(group, shed, D.cx + 6, D.cz - 8, { dy: 0.1, ry: 0.1 });
    chimneys.push(...collectChimneys(shed));
    for (let i = 0; i < 3; i++) {
      const wx = D.cx - 26 + i * 26;
      weir(group, wx, L.river.centerZ(wx) + 4, random);
    }
    const crane = P.cyl(0.2, 0.26, 6, 6, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [D.cx + 20, y(D.cx + 20, L.river.centerZ(D.cx + 20) - 12) + 3, L.river.centerZ(D.cx + 20) - 12] });
    group.add(crane);
    const arm = P.box(0.24, 0.24, 6, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [D.cx + 20, crane.position.y + 2.6, L.river.centerZ(D.cx + 20) - 15] });
    group.add(arm);
  }

  function mooredBoat(rng, x, z, yaw) {
    const g = new THREE.Group();
    const wood = M.planks({ tone: '#6d5136', boards: 5 });
    const hull = P.box(2.6, 0.9, 7.4, wood, { tile: 1.6, pos: [0, 0.1, 0] });
    g.add(hull);
    for (const s of [-1, 1]) g.add(P.box(0.2, 0.5, 7.4, wood, { tile: 1, pos: [s * 1.25, 0.6, 0] }));
    const bow = P.cone(1.3, 2.4, 4, wood, { tile: 1, pos: [0, 0.2, 4.6] });
    bow.rotation.x = -Math.PI / 2;
    g.add(bow);
    g.add(P.cyl(0.09, 0.11, 6.4, 6, M.planks({ tone: '#5b4630' }), { tile: 1, pos: [0, 3.2, -0.6] }));
    const sail = P.cloth({ w: 3.4, h: 3.6, segX: 5, segY: 6, mat: M.paint({ color: '#d8cfb6', roughness: 0.95 }), pos: [0, 3.4, 1.1], rot: [0, Math.PI / 2, 0] });
    g.add(sail);
    g.add(P.box(0.16, 0.16, 3.4, wood, { tile: 1, pos: [1.5, 0.9, 1.4], rot: [0, 0.5, 0.3] }));
    g.add(P.box(0.16, 0.16, 3.4, wood, { tile: 1, pos: [-1.5, 0.9, 1.4], rot: [0, -0.5, -0.3] }));
    g.position.set(x, L.river.waterY + 0.35, z);
    g.rotation.y = yaw;
    g.userData.noMerge = true;
    onTick((t) => {
      g.rotation.z = Math.sin(t * 0.8 + yaw * 3) * 0.035;
      g.position.y = L.river.waterY + 0.35 + Math.sin(t * 1.1 + yaw) * 0.05;
    });
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.noMerge = true; } });
    void rng;
    return g;
  }

  function weir(parent, x, z, rng) {
    const g = new THREE.Group();
    const wood = M.planks({ tone: '#5b4630', boards: 3 });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        g.add(P.cyl(0.1, 0.13, 2.2, 5, wood, {
          tile: 0.8,
          pos: [s * (i * 0.55 + 0.2), 0.4, -i * 0.9 + rng() * 0.3],
          rot: [s * 0.22, 0, s * -0.2],
        }));
      }
    }
    const reed = P.reeds({ count: 26, mat: M.foliage({ color: '#5d7a44' }), seed: Math.round(x) });
    reed.position.y = 0.4;
    g.add(reed);
    g.position.set(x, L.river.waterY - 0.2, z);
    g.rotation.y = rng() * 0.6 - 0.3;
    parent.add(g);
    return g;
  }

  /* ------------------------------------------------------------------ town */
  const town = new THREE.Group();
  {
    const T0 = L.town;
    const ring = roundedRectRing(T0.hx, T0.hz, T0.r, 3);
    const wallH = 5.6;
    /* gate complexes on the north, east and west sides */
    const gateSpots = [
      { x: 0, z: T0.cz - T0.hz, ry: 0, span: 16 },
      { x: T0.hx, z: T0.cz, ry: -Math.PI / 2, span: 14 },
      { x: -T0.hx, z: T0.cz, ry: Math.PI / 2, span: 14 },
      { x: 0, z: T0.cz + T0.hz, ry: Math.PI, span: 16 },
    ];
    const nearGate = (x, z) => gateSpots.some((g) => Math.hypot(x - g.x, z - g.z) < 9);
    /** Cut a wall run where a gate punches through it, leaving a gap for the gatehouse. */
    function wallRuns(a, b) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const pieces = [{ t0: 0, t1: 1 }];
      for (const g of gateSpots) {
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const t = len ? ((g.x - a.x) * vx + (g.z - a.z) * vz) / (len * len) : -1;
        const perp = Math.hypot(a.x + vx * t - g.x, a.z + vz * t - g.z);
        if (t <= 0.02 || t >= 0.98 || perp > 3) continue;
        const half = (g.span * 0.5 + 1.2) / len;
        const next = [];
        for (const piece of pieces) {
          if (piece.t1 < t - half || piece.t0 > t + half) {
            next.push(piece);
            continue;
          }
          if (piece.t0 < t - half) next.push({ t0: piece.t0, t1: t - half });
          if (piece.t1 > t + half) next.push({ t0: t + half, t1: piece.t1 });
        }
        pieces.length = 0;
        pieces.push(...next);
      }
      return pieces.map((p) => ({
        a: new THREE.Vector3(lerp(a.x, b.x, p.t0), 0, lerp(a.z, b.z, p.t0)),
        b: new THREE.Vector3(lerp(a.x, b.x, p.t1), 0, lerp(a.z, b.z, p.t1)),
      }));
    }
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (const piece of wallRuns(a, b)) {
        const pa = piece.a, pb = piece.b;
        const mid = new THREE.Vector3((pa.x + pb.x) / 2, 0, (pa.z + pb.z) / 2);
        const outward = mid.clone().setY(0).normalize();
        const dir = new THREE.Vector3(pb.x - pa.x, 0, pb.z - pa.z);
        const len = dir.length();
        if (len < 2) continue;
        let yaw = -Math.atan2(dir.z, dir.x);
        const localZ = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        if (localZ.dot(outward) < 0) yaw += Math.PI;
        const wall = B.curtainWall({ length: len, height: wallH, thickness: 2.2, stone: 'warm', torches: i % 3 === 0 ? 2 : 0, seed: 200 + i });
        wall.position.set(mid.x, y(mid.x, mid.z) - 0.15, mid.z);
        wall.rotation.y = yaw;
        town.add(wall);
      }
      if (i % 2 === 0 && !nearGate(a.x, a.z)) {
        const tower = B.roundTower({
          radius: 3.4,
          height: wallH + 3.4,
          stone: 'warm',
          roof: i % 4 === 0 ? 'cone' : 'battlement',
          roofStyle: 'shingle',
          roofTone: '#4b6168',
          levels: 1,
          seed: 300 + i,
        });
        tower.position.set(a.x, y(a.x, a.z) - 0.15, a.z);
        town.add(tower);
      }
    }
    for (const gspot of gateSpots) {
      const gate = B.gatehouse({
        span: gspot.span,
        height: wallH + 3,
        opening: 6.4,
        towerRadius: 4.2,
        stone: 'warm',
        roofStyle: 'shingle',
        roofTone: '#4b6168',
        wallThickness: 2.2,
      });
      gate.position.set(gspot.x, y(gspot.x, gspot.z) - 0.15, gspot.z);
      gate.rotation.y = gspot.ry;
      town.add(gate);
    }

    /* streets */
    const streetMat = M.ground({ tone: 'path' });
    const zx = T0.cz;
    town.add(roadRibbon([V(-T0.hx + 4, zx), V(T0.hx - 4, zx)], 5, streetMat, { uvScale: 6, lift: 0.05 }));
    town.add(roadRibbon([V(0, T0.cz - T0.hz + 4), V(0, T0.cz + T0.hz - 4)], 5.4, streetMat, { uvScale: 6, lift: 0.05 }));
    for (const sx of [-34, 30]) {
      town.add(roadRibbon([V(sx, T0.cz - T0.hz + 10), V(sx, T0.cz + T0.hz - 10)], 3.4, streetMat, { uvScale: 5, lift: 0.05 }));
    }
    for (const sz of [-30, 26]) {
      town.add(roadRibbon([V(-T0.hx + 10, T0.cz + sz), V(T0.hx - 10, T0.cz + sz)], 3.2, streetMat, { uvScale: 5, lift: 0.05 }));
    }

    /* houses on the blocks between the streets */
    const blocks = [];
    for (const bx of [-50, -14, 44]) {
      for (const bz of [-40, -12, 12, 40]) blocks.push([bx, T0.cz + bz]);
    }
    for (const [bx, bz] of blocks) {
      const per = 3 + Math.floor(random() * 2);
      for (let k = 0; k < per; k++) {
        const hx = bx + (random() - 0.5) * 22;
        const hz = bz + (random() - 0.5) * 16;
        if (L.sdRoundRect(hx - T0.cx, hz - T0.cz, T0.hx - 8, T0.hz - 8, T0.r) > 0) continue;
        if (Math.hypot(hx, hz - T0.cz) < 20) continue;
        const w = 7 + random() * 5;
        const d = 6 + random() * 5;
        const story = random() > 0.72 ? 2 : 1;
        const style = random();
        const built = style > 0.78
          ? B.roundHouse({ radius: 4 + random() * 1.4, height: 3.6 + random(), roofStyle: 'thatch', roofTone: '#b5924f', wallKind: 'warm', seed: Math.round(hx * 7 + hz) })
          : B.house({
            w, d,
            h: 4 + random() * 1.2,
            wallKind: random() > 0.5 ? 'warm' : 'cool',
            roofStyle: random() > 0.45 ? 'thatch' : cfg.roofStyle,
            roofTone: random() > 0.45 ? '#b5924f' : roofTone,
            ridgeAlong: random() > 0.5 ? 'x' : 'z',
            timber: random() > 0.35,
            chimney: random() > 0.3,
            windows: 1 + Math.floor(random() * 3),
            story,
            seed: Math.round(hx * 13 + hz * 7),
          });
        built.position.set(hx, y(hx, hz) - 0.1, hz);
        built.rotation.y = (random() - 0.5) * 0.5 + (Math.abs(hx) > 30 ? Math.PI / 2 : 0);
        chimneys.push(...collectChimneys(built));
        town.add(built);
        if (random() > 0.42) {
          const side = random() > 0.5 ? 1 : -1;
          const gx = hx + side * (w * 0.5 + 4.2);
          const gz = hz + (random() - 0.5) * 5;
          if (L.sdRoundRect(gx - T0.cx, gz - T0.cz, T0.hx - 5, T0.hz - 5, T0.r) < 0) town.add(gardenPlot(random, gx, gz, L));
        }
        if (random() > 0.6) {
          const shed = P.box(2.6, 2, 1.8, M.planks({ tone: '#6b5540' }), { tile: 1.4, pos: [hx + w * 0.6, y(hx, hz) + 1, hz + d * 0.5] });
          shed.rotation.y = random();
          town.add(shed);
        }
        if (random() > 0.72) town.add(add(town, P.treeOak({ scale: 0.55, seed: Math.round(hx) }), hx + 4, hz + 4, { dy: -0.1 }));
      }
    }

    /* market square with stalls, cross and well */
    const market = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const stall = P.marketStall({ seed: 400 + i, canopy: ['#b8433f', '#3f7a8c', '#7a8c3f', '#8c5f3f', '#5f6b8a'][i % 5] });
      stall.position.set(Math.cos(a) * 11, 0, Math.sin(a) * 9);
      stall.rotation.y = -a + Math.PI / 2;
      market.add(stall);
    }
    const well = P.well({ radius: 2 });
    market.add(well);
    const crossPost = new THREE.Group();
    crossPost.add(P.box(0.4, 5.6, 0.4, M.stone('warm'), { tile: 1.4, pos: [0, 2.8, 0] }));
    crossPost.add(P.box(2.4, 0.34, 0.34, M.stone('warm'), { tile: 1.4, pos: [0, 4.6, 0] }));
    crossPost.add(P.box(1.6, 0.9, 1.6, M.stone('dark'), { tile: 1.4, pos: [0, 0.45, 0] }));
    crossPost.position.set(0, 0, 0);
    market.add(crossPost);
    market.position.set(0, y(0, T0.cz) - 0.05, T0.cz);
    town.add(market);
    for (let i = 0; i < 10; i++) {
      add(town, P.barrel(), (random() - 0.5) * 26, T0.cz + (random() - 0.5) * 22, { dy: 0.05 });
    }

    /* parish church with a tower, tavern, forge, bakery */
    const church = B.chapel({ w: 13, d: 26, h: 8.4, wallKind: 'cool', roofTone: '#5d4a6b', faction: null });
    add(town, church, -30, T0.cz + 34, { dy: -0.1, ry: Math.PI / 2 });
    const tower = B.squareTower({ w: 7.4, d: 7.4, height: 17, stone: 'cool', roof: 'pyramid', roofTone: '#4b6168', roofStyle: 'shingle', faction: null, seed: 88 });
    add(town, tower, -30, T0.cz + 20, { dy: -0.1 });
    const churchyard = new THREE.Group();
    for (let i = 0; i < 22; i++) {
      const gx = -30 + (random() - 0.5) * 30;
      const gz = T0.cz + 34 + (random() - 0.5) * 26;
      if (Math.abs(gx + 30) < 8 && Math.abs(gz - (T0.cz + 34)) < 15) continue;
      const grave = new THREE.Group();
      grave.add(P.box(0.7, 1.1 + random() * 0.5, 0.2, M.stone('grey'), { tile: 1, pos: [0, 0.55, 0] }));
      grave.add(P.box(1.2, 0.3, 0.6, M.stone('grey'), { tile: 1, pos: [0, 0.15, 0] }));
      grave.rotation.y = (random() - 0.5) * 0.4;
      grave.position.set(gx, y(gx, gz), gz);
      churchyard.add(grave);
    }
    town.add(churchyard);

    const tavern = B.house({ w: 16, d: 11, h: 5.4, wallKind: 'warm', roofStyle: cfg.roofStyle, roofTone, ridgeAlong: 'x', timber: true, chimney: true, windows: 4, story: 2, seed: 91 });
    add(town, tavern, 40, T0.cz - 30, { dy: -0.1, ry: -0.2 });
    chimneys.push(...collectChimneys(tavern));
    const yard = new THREE.Group();
    const cart = P.cart({ seed: 12 });
    cart.position.set(0, 0, 0);
    yard.add(cart);
    for (let i = 0; i < 5; i++) {
      const drum = P.barrel();
      drum.position.set(-4 + i * 2, 0.45, 8 + (i % 2) * 2);
      yard.add(drum);
    }
    const crate = P.crate(1.3);
    crate.position.set(6, 0.6, 6);
    yard.add(crate);
    yard.position.set(40, y(40, T0.cz - 18), T0.cz - 18);
    town.add(yard);

    const forge = B.house({ w: 9, d: 8, h: 4.2, wallKind: 'dark', roofStyle: cfg.roofStyle, roofTone, ridgeAlong: 'z', chimney: true, windows: 1, seed: 95 });
    add(town, forge, -46, T0.cz - 34, { dy: -0.1, ry: 0.4 });
    chimneys.push(...collectChimneys(forge));
    const coals = new THREE.Mesh(new THREE.CircleGeometry(1.4, 12), M.glow({ color: '#ff5a1e', intensity: 1.2 }));
    coals.material.userData.window = true;
    coals.rotation.x = -Math.PI / 2;
    coals.position.set(-40, y(-40, T0.cz - 30) + 0.08, T0.cz - 30);
    overlay.add(coals);
    const forgeLight = new THREE.PointLight('#ff6a22', 22, 24, 2);
    forgeLight.position.set(-40, y(-40, T0.cz - 30) + 1.4, T0.cz - 30);
    overlay.add(forgeLight);
    const forgeFlame = P.flame({ size: 1.2, y: 0.3 });
    forgeFlame.position.copy(forgeLight.position).setY(y(-40, T0.cz - 30) + 0.5);
    overlay.add(forgeFlame);
    onTick((t) => {
      P.updateFlame(forgeFlame, t);
      forgeLight.intensity = 16 + Math.sin(t * 9) * 5 + Math.sin(t * 21) * 2;
    });

    /* common hearth and drying racks in the square */
    for (let i = 0; i < 3; i++) {
      const fire = P.campfire({ scale: 0.9 });
      add(town, fire, -12 + i * 13, T0.cz + 12 + (i % 2) * 6, { dy: 0.05 });
      onTick((t) => { if (fire.userData.fire) P.updateFlame(fire.userData.fire, t); });
    }
    for (let i = 0; i < 4; i++) {
      const rack = P.box(5, 0.16, 0.2, M.planks({ tone: '#6b5540' }), { tile: 1.2, pos: [0, 1.5, 0] });
      const rg = new THREE.Group();
      rg.add(rack);
      for (const s of [-2.2, 2.2]) rg.add(P.cyl(0.1, 0.12, 1.6, 5, M.planks({ tone: '#5b4630' }), { tile: 1, pos: [s, 0.8, 0] }));
      add(town, rg, 20 + (i % 2) * 8, T0.cz - 14 - i * 4, { ry: random() });
    }
  }
  group.add(town);

  /* townsfolk: one instanced crowd for the whole town */
  {
    const loops = [
      [V(-58, L.town.cz), V(58, L.town.cz)],
      [V(0, L.town.cz - 50), V(0, L.town.cz + 50)],
      [V(-14, L.town.cz - 14), V(14, L.town.cz - 14), V(14, L.town.cz + 14), V(-14, L.town.cz + 14)],
    ].map((pts) => pts.map((p) => new THREE.Vector3(p.x, y(p.x, p.z), p.z)));
    crowd.push(makeCrowd(group, {
      loops,
      count: 26,
      seed: cfg.seed + 5,
      palette: ['#8a7355', '#6d6a5b', '#7a6a52', '#6b5b8a', '#5b7a6b', '#8a6b5b', '#a08b62'],
      scale: 1,
    }));
  }

  /* ------------------------------------------------------- fields and farms */
  for (const field of L.fields) {
    const fg = new THREE.Group();
    const fy = y(field.cx, field.cz);
    const cap = buildCapGeometry(roundedRectRing(field.hx, field.hz, 4, 5), fy + 0.06);
    applyPlanarUV(cap, 6);
    const soilColors = { wheat: 0x8a7a3f, barley: 0x9c8a4a, roots: 0x6b5540, fallow: 0x7a6247, peas: 0x4f7a3c };
    const soil = new THREE.Mesh(cap, soilMat(soilColors[field.crop] || 0x7a6a4a));
    soil.receiveShadow = true;
    fg.add(soil);

    const rows = Math.max(8, Math.round(field.hz * 2 / 1.9));
    const perRow = Math.max(10, Math.round(field.hx * 2 / 1.6));
    const cropGeo = field.crop === 'peas'
      ? new THREE.SphereGeometry(0.55, 5, 4)
      : new THREE.ConeGeometry(0.42, 1.2, 4, 1, true);
    const cropMat = M.foliage({
      color: field.crop === 'wheat' ? '#d9b955' : field.crop === 'barley' ? '#cbb96b' : field.crop === 'peas' ? '#59934a' : '#7a9a4a',
    });
    const total = field.crop === 'fallow' ? 0 : rows * perRow;
    if (total > 0) {
      const crops = new THREE.InstancedMesh(cropGeo, cropMat, total);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      const sc = new THREE.Vector3();
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < perRow; c++) {
          const lx = -field.hx + 1.4 + (c / Math.max(1, perRow - 1)) * (field.hx * 2 - 2.8);
          const lz = -field.hz + 1.4 + (r / Math.max(1, rows - 1)) * (field.hz * 2 - 2.8);
          const s = 0.75 + random() * 0.6;
          q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.2, random() * 6.283, (random() - 0.5) * 0.2));
          m.compose(p.set(field.cx + lx, fy + (field.crop === 'peas' ? 0.35 : 0.72) * s, field.cz + lz), q, sc.set(s, s, s));
          crops.setMatrixAt(i++, m);
        }
      }
      crops.instanceMatrix.needsUpdate = true;
      crops.castShadow = true;
      crops.receiveShadow = true;
      fg.add(crops);
    }

    /* hedgerow or post-and-rail boundary */
    const perim = roundedRectRing(field.hx + 1.2, field.hz + 1.2, 4, 3);
    const hedge = field.crop === 'fallow' || random() > 0.5;
    if (hedge) {
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const list = [];
      for (let i = 0; i < perim.length; i++) {
        const a = perim[i], b = perim[(i + 1) % perim.length];
        const steps = Math.max(2, Math.round(a.distanceTo(b) / 2.4));
        for (let k = 0; k < steps; k++) {
          const t = k / steps;
          const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
          const s = 0.8 + random() * 0.7;
          m.compose(p.set(x, y(x, z) + 0.7 * s, z), q.setFromEuler(new THREE.Euler(0, random() * 6.283, 0)), sc.set(s * 1.5, s, s));
          list.push(m.clone());
        }
      }
      const mats = [];
      for (let i = 0; i < list.length; i++) mats.push(new THREE.Color().setHSL(0.26 + random() * 0.06, 0.4, 0.22 + random() * 0.1));
      fg.add(instanced(new THREE.IcosahedronGeometry(1, 0), M.foliage({ color: '#ffffff' }), list, mats));
    } else {
      for (let i = 0; i < perim.length; i++) {
        const a = perim[i], b = perim[(i + 1) % perim.length];
        const steps = Math.max(2, Math.round(a.distanceTo(b) / 4));
        for (let k = 0; k < steps; k++) {
          const t = k / steps;
          const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
          fg.add(P.cyl(0.1, 0.14, 1.5, 5, M.planks({ tone: '#6b5540' }), { tile: 0.8, pos: [x, y(x, z) + 0.75, z] }));
        }
      }
    }

    if (random() > 0.45) {
      const stack = new THREE.Group();
      stack.add(P.cone(2.1, 3.4, 8, M.thatch({ tone: '#c3a05c' }), { tile: 2, pos: [0, 1.7, 0] }));
      stack.add(P.cyl(2.2, 2.4, 0.6, 8, M.thatch({ tone: '#b5924f' }), { tile: 2, pos: [0, 0.3, 0] }));
      add(fg, stack, field.cx + field.hx - 3, field.cz + field.hz - 3, { dy: 0, ry: random() * 3 });
    }
    if (field.crop !== 'fallow' && random() > 0.5) {
      const sc2 = new THREE.Group();
      sc2.add(P.cyl(0.09, 0.11, 2.4, 5, M.planks({ tone: '#5b4630' }), { tile: 0.8, pos: [0, 1.2, 0] }));
      sc2.add(P.box(1.5, 0.14, 0.14, M.planks({ tone: '#5b4630' }), { tile: 0.8, pos: [0, 1.9, 0] }));
      const head = P.box(0.5, 0.5, 0.4, M.paint({ color: '#c8b487', roughness: 1 }), { tile: 0.6, pos: [0, 2.1, 0] });
      sc2.add(head);
      sc2.add(P.cone(0.35, 1.1, 5, M.thatch({ tone: '#b5924f' }), { tile: 1, pos: [0, 2.6, 0] }));
      add(fg, sc2, field.cx + (random() - 0.5) * field.hx, field.cz + (random() - 0.5) * field.hz, { ry: random() * 3 });
    }
    group.add(fg);
    add(group, P.cart({ seed: Math.round(field.cx) }), field.cx + field.hx + 2.5, field.cz + 4, { ry: random() * 3 });
    if (random() > 0.5) add(group, P.treeOak({ scale: 0.8, seed: Math.round(field.cz) }), field.cx - field.hx - 3, field.cz - 5, {});
  }

  /* orchard */
  {
    const O = L.orchard;
    for (let ix = 0; ix < 6; ix++) {
      for (let iz = 0; iz < 5; iz++) {
        const x = O.cx - O.hx + 4 + ix * ((O.hx * 2 - 8) / 5);
        const z = O.cz - O.hz + 4 + iz * ((O.hz * 2 - 8) / 4);
        const tree = P.treeOak({ scale: 0.5 + random() * 0.16, seed: Math.round(x * 3 + z) });
        add(group, tree, x + (random() - 0.5) * 1.6, z + (random() - 0.5) * 1.6, { dy: -0.1 });
      }
    }
    const fence = P.fenceLine({ length: O.hx * 2, spacing: 2.4, height: 1.3 });
    add(group, fence, O.cx, O.cz - O.hz, { dy: 0 });
    const fence2 = P.fenceLine({ length: O.hx * 2, spacing: 2.4, height: 1.3 });
    add(group, fence2, O.cx, O.cz + O.hz, { dy: 0 });
    for (let i = 0; i < 6; i++) add(group, P.barrel(), O.cx - 10 + i * 3, O.cz + O.hz - 4, { dy: 0.05 });
    const press = B.house({ w: 8, d: 6, h: 3.6, wallKind: 'warm', roofStyle: 'thatch', roofTone: '#b5924f', ridgeAlong: 'x', windows: 1, seed: 99 });
    add(group, press, O.cx + 4, O.cz - 6, { ry: 0.3 });
  }

  /* pasture with sheep */
  {
    const Pa = L.pasture;
    const perim = roundedRectRing(Pa.hx, Pa.hz, 8, 3);
    for (let i = 0; i < perim.length; i++) {
      const a = perim[i], b = perim[(i + 1) % perim.length];
      const steps = Math.max(2, Math.round(a.distanceTo(b) / 4.2));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
        group.add(P.cyl(0.11, 0.14, 1.3, 5, M.planks({ tone: '#6b5540' }), { tile: 0.8, pos: [x, y(x, z) + 0.65, z] }));
      }
      const rail = P.box(a.distanceTo(b), 0.12, 0.12, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [(a.x + b.x) / 2, y((a.x + b.x) / 2, (a.z + b.z) / 2) + 1.05, (a.z + b.z) / 2] });
      rail.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      group.add(rail);
    }
    const loops = [[
      V(Pa.cx - 20, Pa.cz), V(Pa.cx, Pa.cz - 16), V(Pa.cx + 20, Pa.cz), V(Pa.cx, Pa.cz + 16),
    ].map((p) => new THREE.Vector3(p.x, y(p.x, p.z), p.z))];
    crowd.push(makeCrowd(group, {
      loops,
      count: 24,
      seed: cfg.seed + 9,
      palette: ['#e6e3da', '#dcd8cc', '#cfc9bb'],
      bodyGeo: new THREE.SphereGeometry(0.62, 7, 5),
      bodyScale: [1.25, 0.85, 1],
      headGeo: new THREE.SphereGeometry(0.28, 6, 5),
      headColor: '#3b3531',
      headY: 0.3,
      height: 0.55,
      bob: 0.02,
      speed: 0.55,
    }));
    const hut = B.roundHouse({ radius: 4, height: 3.4, roofStyle: 'thatch', roofTone: '#a8894a', wallKind: 'warm', seed: 33 });
    add(group, hut, Pa.cx + 18, Pa.cz - 18, { ry: 0.6 });
    for (let i = 0; i < 3; i++) {
      const stack = new THREE.Group();
      stack.add(P.cone(1.9, 3, 8, M.thatch({ tone: '#c3a05c' }), { tile: 2, pos: [0, 1.5, 0] }));
      add(group, stack, Pa.cx - 22 + i * 5, Pa.cz + 12, {});
    }
  }

  /* ------------------------------------------------------------------ pond */
  {
    const Pd = L.pond;
    const cap = buildCapGeometry(roundedRectRing(Pd.hx, Pd.hz, 14, 5), L.pondWaterY);
    applyPlanarUV(cap, 14);
    const pondMat = M.water({ color: '#2c5348', opacity: 0.82, roughness: 0.12 });
    const pondMesh = new THREE.Mesh(cap, pondMat);
    pondMesh.renderOrder = 2;
    pondMesh.userData.noMerge = true;
    pondMesh.position.set(Pd.cx, 0, Pd.cz);
    group.add(pondMesh);
    onTick((t, dt) => {
      const n = pondMat.normalMap;
      n.offset.x = (n.offset.x + dt * 0.006) % 1;
      n.offset.y = (n.offset.y - dt * 0.004) % 1;
      void t;
    });
    for (let i = 0; i < 240; i++) {
      const a = random() * Math.PI * 2;
      const rr = 1 + random() * 0.28;
      const x = Pd.cx + Math.cos(a) * Pd.hx * rr;
      const z = Pd.cz + Math.sin(a) * Pd.hz * rr;
      const s = 0.7 + random() * 0.9;
      group.add(P.cyl(0.08, 0.1, 2.2 * s, 3, M.foliage({ color: '#5d7a44' }), {
        tile: 0.8,
        pos: [x, L.pondWaterY + 1.1 * s, z],
        rot: [(random() - 0.5) * 0.3, random() * 3, (random() - 0.5) * 0.3],
      }));
    }
    const dam = P.box(14, 2.6, 3, M.rubble(), { tile: 2.4, pos: [Pd.cx + Pd.hx - 2, y(Pd.cx + Pd.hx - 2, Pd.cz) + 1, Pd.cz] });
    group.add(dam);
    group.add(P.box(3, 0.5, 3.4, M.planks({ tone: '#6b5540' }), { tile: 1.2, pos: [Pd.cx + Pd.hx + 1, L.pondWaterY + 0.4, Pd.cz] }));
    const hut = B.house({ w: 7, d: 6, h: 3.6, wallKind: 'warm', roofStyle: 'thatch', roofTone: '#b5924f', ridgeAlong: 'x', chimney: true, windows: 1, seed: 101 });
    add(group, hut, Pd.cx - 6, Pd.cz - Pd.hz - 4, { ry: 0.4 });
    chimneys.push(...collectChimneys(hut));
    group.add(mooredBoat(random, Pd.cx + 4, Pd.cz + Pd.hz - 4, 1.2));
    for (let i = 0; i < 8; i++) {
      const x = Pd.cx + (random() - 0.5) * Pd.hx * 1.8;
      const z = Pd.cz + (random() > 0.5 ? 1 : -1) * (Pd.hz + 3 + random() * 4);
      add(group, willow(random), x, z, { ry: random() * 6.283 });
    }
  }

  /* ---------------------------------------------------------------- quarry */
  {
    const Q = L.quarry;
    const benchMat = M.rubble();
    const wallMat = M.rubble().clone();
    wallMat.side = THREE.DoubleSide;
    const benches = [[0.5, -11], [0.78, -7.4], [1.06, -3.8]];
    for (let i = 0; i < benches.length; i++) {
      const [rr, bench] = benches[i];
      const nextR = i + 1 < benches.length ? benches[i + 1][0] : 1.5;
      const cap = new THREE.Mesh(
        new THREE.RingGeometry(Q.hx * rr, Q.hx * nextR, 30, 1),
        benchMat,
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(Q.cx, bench + 0.04, Q.cz);
      cap.receiveShadow = true;
      cap.userData.noMerge = true;
      group.add(cap);
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(Q.hx * rr, Q.hx * rr * 1.02, 3.7, 30, 1, true),
        wallMat,
      );
      wall.position.set(Q.cx, bench + 1.85, Q.cz);
      wall.castShadow = true;
      wall.userData.noMerge = true;
      group.add(wall);
    }
    const blocks = [];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = 0; i < 46; i++) {
      const a = random() * Math.PI * 2;
      const rr = random() * 0.5;
      const x = Q.cx + Math.cos(a) * Q.hx * rr;
      const z = Q.cz + Math.sin(a) * Q.hz * rr;
      const s = 0.8 + random() * 1.4;
      m.compose(p.set(x, -10.5 + s * 0.5, z), q.setFromEuler(new THREE.Euler(0, random() * 0.6, 0)), sc.set(s, s * 0.7, s));
      blocks.push(m.clone());
    }
    group.add(instanced(new THREE.BoxGeometry(1.6, 1.6, 1.6), M.stone('grey'), blocks));
    /* treadwheel crane */
    const crane = new THREE.Group();
    for (const s of [-1, 1]) {
      crane.add(P.box(0.3, 7.5, 0.3, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [s * 1.6, 3.75, 0] }));
      crane.add(P.box(0.3, 7.5, 0.3, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [s * 1.6, 3.75, 2.6] }));
    }
    crane.add(P.box(4, 0.3, 0.3, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [0, 7.4, 1.3] }));
    const drum = P.cyl(1.1, 1.1, 2.4, 10, M.planks({ tone: '#7c5a38' }), { tile: 1.2, pos: [0, 6.4, 1.3] });
    drum.rotation.z = Math.PI / 2;
    crane.add(drum);
    crane.add(P.box(0.3, 0.3, 7, M.planks({ tone: '#5b4630' }), { tile: 1, pos: [0, 7.6, -2.2], rot: [0.35, 0, 0] }));
    crane.add(P.cyl(0.05, 0.05, 4.5, 4, M.metal({ color: '#4a4741', metalness: 0.6, roughness: 0.5 }), { tile: 0.5, pos: [0, 5.2, -5.2] }));
    add(group, crane, Q.cx - 6, Q.cz + 14, { dy: 0.1, ry: 0.8 });
    for (let i = 0; i < 5; i++) {
      add(group, P.rock({ scale: 1 + random() * 2, seed: i + 40 }), Q.cx + 20 + random() * 14, Q.cz - 10 + random() * 24, { dy: 0.2 });
    }
    add(group, P.cart({ seed: 21 }), Q.cx + 12, Q.cz + 20, { ry: 1.4 });
    for (let i = 0; i < 4; i++) add(group, P.crate(1.1), Q.cx - 20 + i * 2.4, Q.cz + 22, { ry: random() });
    const fire = P.campfire({ scale: 1 });
    add(group, fire, Q.cx + 24, Q.cz + 8, {});
    onTick((t) => { if (fire.userData.fire) P.updateFlame(fire.userData.fire, t); });
  }

  /* ----------------------------------------------------------- watchtowers */
  const beacons = [];
  for (const w of L.watchtowers) {
    const tower = B.squareTower({ w: 7, d: 7, height: 11 + (w.seed % 3), stone, roof: 'battlement', roofTone, roofStyle: cfg.roofStyle, faction: null, seed: w.seed });
    add(group, tower, w.x, w.z, { dy: -0.2, ry: w.seed });
    const deckY = y(w.x, w.z) + 1.3 + 11 + (w.seed % 3);
    const beacon = P.flame({ size: 2.4, color: '#ffb347', y: 0 });
    beacon.position.set(w.x, deckY + 0.6, w.z);
    overlay.add(beacon);
    beacons.push(beacon);
    const light = new THREE.PointLight('#ff9b3e', 26, 60, 2);
    light.position.set(w.x, deckY + 2, w.z);
    overlay.add(light);
    onTick((t) => {
      P.updateFlame(beacon, t);
      light.intensity = (20 + Math.sin(t * 5 + w.seed) * 6) * (0.4 + lightingNight.value);
    });
    const shed = B.roundHouse({ radius: 3.4, height: 3, roofStyle: 'thatch', roofTone: '#a8894a', wallKind: 'warm', seed: w.seed + 3 });
    add(group, shed, w.x + 10, w.z + 6, { ry: random() });
    const pole = P.bannerPole({ height: 8, faction: ownBanner });
    add(group, pole, w.x - 9, w.z + 4, { dy: 0.1 });
    onTick((t) => P.flapCloth(pole.userData.flag, t, 0.3, 2.6));
    const ring = roundedRectRing(13, 13, 6, 2);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const pal = B.palisade({ length: a.distanceTo(b), height: 2.6, spacing: 0.7, seed: i + w.seed });
      pal.position.set((a.x + b.x) / 2, y((a.x + b.x) / 2, (a.z + b.z) / 2), (a.z + b.z) / 2);
      pal.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
      group.add(pal);
    }
  }

  /* ------------------------------------------------------------ stone circle */
  {
    const S = L.shrine;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = S.cx + Math.cos(a) * 11;
      const z = S.cz + Math.sin(a) * 11;
      const h = 2.6 + random() * 1.6;
      const stone2 = P.box(1.5, h, 1, M.stone('grey'), { tile: 1.6, pos: [x, y(x, z) + h / 2, z] });
      stone2.rotation.set((random() - 0.5) * 0.16, -a + (random() - 0.5) * 0.3, (random() - 0.5) * 0.14);
      group.add(stone2);
      if (i % 3 === 0 && i > 0) {
        const prevX = S.cx + Math.cos(((i - 1) / 9) * Math.PI * 2) * 11;
        const prevZ = S.cz + Math.sin(((i - 1) / 9) * Math.PI * 2) * 11;
        const lintel = P.box(5, 0.8, 1.4, M.stone('grey'), { tile: 1.6, pos: [(x + prevX) / 2, y(x, z) + 3.6, (z + prevZ) / 2] });
        lintel.rotation.y = -Math.atan2(z - prevZ, x - prevX);
        group.add(lintel);
      }
    }
    const altar = P.box(3, 1.2, 2, M.stone('dark'), { tile: 1.6, pos: [S.cx, y(S.cx, S.cz) + 0.6, S.cz] });
    group.add(altar);
    const votive = P.flame({ size: 0.9, color: '#ffd27a', y: 1.4 });
    votive.position.set(S.cx, y(S.cx, S.cz) + 1.2, S.cz);
    overlay.add(votive);
    onTick((t) => P.updateFlame(votive, t));
    for (let i = 0; i < 5; i++) add(group, P.rock({ scale: 1 + random(), seed: i + 12 }), S.cx + (random() - 0.5) * 30, S.cz + (random() - 0.5) * 30, {});
  }

  /* ------------------------------------------------------- lumber camp, forest works */
  {
    const C = L.lumber;
    const hut = B.roundHouse({ radius: 4.6, height: 3.8, roofStyle: 'thatch', roofTone: '#a8894a', wallKind: 'warm', seed: 55 });
    add(group, hut, C.cx, C.cz, { ry: 0.4 });
    chimneys.push(...collectChimneys(hut));
    const sawpit = new THREE.Group();
    sawpit.add(P.box(4, 0.4, 2.4, M.planks({ tone: '#8a6a45' }), { tile: 1.4, pos: [0, 1.1, 0] }));
    for (const s of [-1.6, 1.6]) sawpit.add(P.box(0.3, 1.2, 0.3, M.planks({ tone: '#5b4630' }), { tile: 1, pos: [s, 0.5, 0] }));
    sawpit.add(P.box(5.5, 0.12, 0.5, M.metal({ color: '#b9bec4', metalness: 1, roughness: 0.3 }), { tile: 0.6, pos: [0, 1.4, 0.9] }));
    add(group, sawpit, C.cx + 8, C.cz + 4, { ry: 0.7 });
    const logs = [];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 26; i++) {
      const row = Math.floor(i / 6);
      const k = i % 6;
      m.compose(
        p.set(C.cx - 14 + k * 2.2 + (row % 2) * 1.1, y(C.cx - 14, C.cz - 10) + 0.9 + row * 1.7, C.cz - 10),
        q.setFromEuler(new THREE.Euler(0, 0.2, Math.PI / 2)),
        sc.set(0.9 + random() * 0.3, 1, 1),
      );
      logs.push(m.clone());
    }
    group.add(instanced(new THREE.CylinderGeometry(0.85, 0.9, 6, 8), M.planks({ tone: '#6b5540', boards: 3 }), logs));
    for (let i = 0; i < 7; i++) {
      const stump = P.cyl(1.1 + random() * 0.5, 1.3, 0.9, 9, M.planks({ tone: '#6b5540', boards: 3 }), {
        tile: 1.2,
        pos: [C.cx + (random() - 0.5) * 60, y(C.cx, C.cz) + 0.45, C.cz + (random() - 0.5) * 50],
      });
      group.add(stump);
    }
    const fire = P.campfire({ scale: 1.2 });
    add(group, fire, C.cx + 4, C.cz - 6, {});
    onTick((t) => { if (fire.userData.fire) P.updateFlame(fire.userData.fire, t); });
    /* charcoal stacks */
    for (let i = 0; i < 4; i++) {
      const x = C.cx - 6 + (i % 2) * 9;
      const z = C.cz + 10 + Math.floor(i / 2) * 7;
      const stack = P.cone(2.1, 3.6, 9, M.paint({ color: '#3a3631', roughness: 1 }), { tile: 2, pos: [x, y(x, z) + 1.8, z] });
      group.add(stack);
    }
  }

  /* ------------------------------------------------------- besiegers' camp */
  {
    const C = L.camp;
    const enemy = FACTIONS[(FACTIONS.findIndex((f) => f.id === cfg.faction.id) + 2) % FACTIONS.length];
    const enemyBanner = { ...enemy, mat: M.bannerMaterial({ base: enemy.base, accent: enemy.accent, motif: enemy.motif, seed: 91 }) };
    const perim = roundedRectRing(C.hx, C.hz, 10, 3);
    for (let i = 0; i < perim.length; i++) {
      const a = perim[i], b = perim[(i + 1) % perim.length];
      if (i === 6) continue;
      const len = a.distanceTo(b);
      const pal = B.palisade({ length: len, height: 3.6, spacing: 0.6, seed: 500 + i });
      pal.position.set((a.x + b.x) / 2, y((a.x + b.x) / 2, (a.z + b.z) / 2), (a.z + b.z) / 2);
      pal.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
      group.add(pal);
    }
    for (const s of [-1, 1]) {
      const tower = B.roundTower({ radius: 3.6, height: 8, stone: 'dark', roof: 'battlement', roofStyle: 'shingle', roofTone: '#4a4f42', faction: enemyBanner, levels: 1, seed: 600 + s });
      add(group, tower, C.hx + 2, C.cz + s * 9, { ry: s });
    }
    for (let ix = 0; ix < 4; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        const x = C.cx - 26 + ix * 17 + (random() - 0.5) * 3;
        const z = C.cz - 18 + iz * 17 + (random() - 0.5) * 3;
        const tent = P.tent({ scale: 0.9 + random() * 0.4, color: random() > 0.5 ? '#6b5f4a' : '#5a5346', seed: Math.round(x + z) });
        add(group, tent, x, z, { ry: random() * 6.283 });
        if (random() > 0.5) {
          const fire = P.campfire({ scale: 0.8 });
          add(group, fire, x + 5, z + 4, {});
          chimneys.push(new THREE.Vector3(x + 5, y(x + 5, z + 4) + 1.2, z + 4));
          onTick((t) => { if (fire.userData.fire) P.updateFlame(fire.userData.fire, t); });
        }
      }
    }
    const pavilion = new THREE.Group();
    const pav = P.tent({ scale: 2.2, color: enemy.base, seed: 12 });
    pavilion.add(pav);
    for (const s of [-1, 1]) {
      const pole = P.bannerPole({ height: 9, faction: enemyBanner });
      pole.position.set(s * 7, 0, 6);
      pavilion.add(pole);
      onTick((t) => P.flapCloth(pole.userData.flag, t, 0.32, 2.2));
    }
    add(group, pavilion, C.cx, C.cz + 4, { ry: 0.1 });

    /* siege engines */
    const cat1 = catapult(random);
    add(group, cat1, C.cx - 30, C.cz - 26, { ry: -0.5 });
    const cat2 = catapult(random);
    add(group, cat2, C.cx - 14, C.cz - 30, { ry: -0.2 });
    const bal = ballista(random);
    add(group, bal, C.cx + 26, C.cz - 22, { ry: 0.9 });
    for (let i = 0; i < 26; i++) {
      add(group, P.crate(0.9), C.cx + 16 + (i % 6) * 2.2, C.cz + 8 + Math.floor(i / 6) * 2.4, { ry: random() });
    }
    /* stakes pointing at the castle */
    const stakeMats = [];
    const mm = new THREE.Matrix4();
    const pp = new THREE.Vector3();
    const qq = new THREE.Quaternion();
    const ss = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      const a = Math.PI + (random() - 0.5) * 1.6;
      const r = 52 + random() * 16;
      const x = C.cx + Math.cos(a) * r;
      const z = C.cz + Math.sin(a) * r;
      mm.compose(pp.set(x, y(x, z) + 0.9, z), qq.setFromEuler(new THREE.Euler(Math.PI - 0.45, a, 0)), ss.set(1, 1, 1));
      stakeMats.push(mm.clone());
    }
    group.add(instanced(new THREE.ConeGeometry(0.22, 2.6, 5), M.planks({ tone: '#6b5540', boards: 3 }), stakeMats));
    const horse = [];
    for (let i = 0; i < 6; i++) {
      const x = C.cx - 34 + (i % 3) * 4;
      const z = C.cz + 16 + Math.floor(i / 3) * 4;
      horse.push(mm.compose(pp.set(x, y(x, z) + 0.9, z), qq.setFromEuler(new THREE.Euler(0, random() * 3, 0)), ss.set(1, 1, 1)).clone());
    }
    group.add(instanced(new THREE.BoxGeometry(0.7, 1.1, 2.2), M.paint({ color: '#6b4f38', roughness: 1 }), horse));
  }

  function catapult(rng) {
    const g = new THREE.Group();
    const wood = M.planks({ tone: '#6b5540', boards: 4 });
    g.add(P.box(7, 0.6, 4.4, wood, { tile: 1.6, pos: [0, 0.9, 0] }));
    for (const s of [-1, 1]) {
      g.add(P.box(0.5, 1.4, 0.5, wood, { tile: 1, pos: [s * 2.8, 0.4, 1.6] }));
      g.add(P.box(0.5, 1.4, 0.5, wood, { tile: 1, pos: [s * 2.8, 0.4, -1.6] }));
    }
    g.add(P.box(1.2, 1.6, 3.4, M.paint({ color: '#5a5346', roughness: 1 }), { tile: 1.4, pos: [-2.4, 1.9, 0] }));
    const arm = P.box(0.5, 8.5, 0.7, wood, { tile: 1.2, pos: [1.2, 4.2, 0] });
    arm.rotation.z = -0.5;
    g.add(arm);
    const bucket = P.box(1.6, 1.1, 1.4, wood, { tile: 1.2, pos: [3.4, 6.6, 0] });
    bucket.rotation.z = -0.5;
    g.add(bucket);
    g.add(P.cyl(0.9, 0.9, 0.7, 10, M.metal({ color: '#4a4741', metalness: 0.6, roughness: 0.5 }), { tile: 1, pos: [0, 1.6, 0], rot: [0, 0, Math.PI / 2] }));
    for (let i = 0; i < 5; i++) {
      add(g, P.rock({ scale: 0.7, seed: i + 3 }), -6 + rng() * 3, -2 + i * 1.1, { dy: 0.4 });
    }
    g.traverse((o) => { if (o.isMesh) o.userData.noMerge = true; });
    return g;
  }

  function ballista(rng) {
    const g = new THREE.Group();
    const wood = M.planks({ tone: '#7a5f42', boards: 4 });
    g.add(P.box(1.4, 1, 9, wood, { tile: 1.6, pos: [0, 1.1, 0] }));
    for (const s of [-1, 1]) {
      g.add(P.box(0.4, 0.4, 4.4, wood, { tile: 1, pos: [s * 2.4, 1.7, -1.4], rot: [0, s * 0.4, 0] }));
      g.add(P.box(0.3, 2.4, 0.3, wood, { tile: 1, pos: [s * 3.6, 2.4, -3.2] }));
    }
    g.add(P.cyl(0.12, 0.12, 7.4, 5, M.planks({ tone: '#5b4630' }), { tile: 0.6, pos: [0, 2.2, -2.4], rot: [Math.PI / 2, 0, 0] }));
    const bolt = P.box(0.22, 0.22, 5.4, M.planks({ tone: '#8a6a45' }), { tile: 0.8, pos: [0, 1.9, 0.4] });
    g.add(bolt);
    g.add(P.cone(0.28, 0.9, 5, M.metal({ color: '#b9bec4', metalness: 1, roughness: 0.3 }), { tile: 0.6, pos: [0, 1.9, 3.3], rot: [Math.PI / 2, 0, 0] }));
    for (const s of [-1, 1]) g.add(P.cyl(0.5, 0.5, 0.6, 8, wood, { tile: 0.8, pos: [s * 1.6, 0.6, 3.4], rot: [0, 0, Math.PI / 2] }));
    g.traverse((o) => { if (o.isMesh) o.userData.noMerge = true; });
    void rng;
    return g;
  }

  /* ------------------------------------------------- gallows on the ridge */
  {
    const gx = 128, gz = -62;
    const g = new THREE.Group();
    const wood = M.planks({ tone: '#5b4630', boards: 4 });
    g.add(P.box(0.5, 6.4, 0.5, wood, { tile: 1.2, pos: [0, 3.2, 0] }));
    g.add(P.box(4.6, 0.4, 0.4, wood, { tile: 1.2, pos: [2.1, 6.2, 0] }));
    g.add(P.box(1.4, 0.4, 1.4, M.rubble(), { tile: 1, pos: [0, 0.2, 0] }));
    for (const s of [0.4, 2.2, 3.8]) {
      g.add(P.cyl(0.03, 0.03, 1.6, 4, M.planks({ tone: '#4b3626' }), { tile: 0.5, pos: [s, 5.4, 0] }));
      const cage = new THREE.Group();
      cage.add(P.box(0.9, 1.1, 0.9, M.metal({ color: '#4a4741', metalness: 0.5, roughness: 0.7 }), { tile: 0.6 }));
      cage.position.set(s, 3.9, 0);
      g.add(cage);
    }
    add(group, g, gx, gz, { ry: 0.6 });
    for (let i = 0; i < 4; i++) add(group, P.rock({ scale: 0.8 + random(), seed: i + 60 }), gx + (random() - 0.5) * 14, gz + (random() - 0.5) * 14, {});
  }

  /* haystacks and field clutter near the town gates */
  for (let i = 0; i < 9; i++) {
    const x = -40 + random() * 80;
    const z = L.town.cz - L.town.hz - 12 - random() * 26;
    if (L.roadDist(x, z) < 5) continue;
    const stack = new THREE.Group();
    stack.add(P.cone(2.3, 3.6, 9, M.thatch({ tone: '#c3a05c' }), { tile: 2, pos: [0, 1.8, 0] }));
    stack.add(P.cyl(2.5, 2.6, 0.7, 9, M.thatch({ tone: '#b5924f' }), { tile: 2, pos: [0, 0.35, 0] }));
    add(group, stack, x, z, { ry: random() * 3 });
  }

  /* river ferry crossing on the ridge road */
  {
    const fx = 214;
    const fz = L.river.centerZ(fx);
    group.add(mooredBoat(random, fx, fz, 1.5));
    for (const s of [-1, 1]) {
      const rope = P.cyl(0.05, 0.05, 34, 4, M.planks({ tone: '#4b3626' }), { tile: 0.4, pos: [fx + s * 16, L.river.waterY + 1.6, fz] });
      rope.rotation.z = Math.PI / 2;
      group.add(rope);
      group.add(P.cyl(0.16, 0.2, 3.4, 6, M.planks({ tone: '#5b4630' }), { tile: 0.8, pos: [fx + s * 17, y(fx + s * 17, fz) + 1.5, fz] }));
    }
  }

  /* ------------------------------------------------------ detail pass */
  {
    group.add(cobbles(L, 0, L.town.cz, 15, 12));
    for (const s of [-1, 1]) group.add(cobbles(L, s * 34, L.town.cz, 3, 22, 1.3));

    add(group, pillory(), 9, L.town.cz + 7, { ry: 0.6 });

    /* footbridge above the mills, linking the orchard to the west fields */
    const fbx = -128;
    group.add(footbridge(fbx, L.river.centerZ(fbx), L, 20));
    for (let i = 0; i < 7; i++) {
      const sx = fbx + 30;
      const sz = L.river.centerZ(sx) - L.river.half + 2 + i * 3.4;
      group.add(P.cyl(0.55, 0.62, 0.35, 7, M.stone('grey'), { tile: 1, pos: [sx, L.river.waterY + 0.22, sz] }));
    }

    /* net dryers and a barge at the wharf */
    for (let i = 0; i < 4; i++) {
      const nx = L.docks.cx - 24 + i * 15;
      group.add(netFrame(random, nx, L.river.centerZ(nx) - L.river.half - 4, L));
    }
    const barge = mooredBoat(random, L.docks.cx + 22, L.river.centerZ(L.docks.cx + 22) + 2, 0.2);
    barge.scale.set(1.5, 1.3, 1.7);
    for (let i = 0; i < 5; i++) {
      const cask = P.crate(0.9);
      cask.position.set(-1 + (i % 2) * 2, 1.5, -1.5 + Math.floor(i / 2) * 1.6);
      barge.add(cask);
    }
    group.add(barge);
    group.add(lilyPads(L));
    group.add(sandBars(L));

    /* birch fringe, dead wood and undergrowth in the surrounding forest */
    for (const [gx, gz, n] of [[-206, 44, 26], [-150, -176, 22], [96, -240, 18], [236, 96, 16], [-248, -28, 14]]) {
      for (let i = 0; i < n; i++) {
        const x = gx + (random() - 0.5) * 46;
        const z = gz + (random() - 0.5) * 42;
        if (L.isBuilt(x, z) || L.roadDist(x, z) < 3.5 || L.riverDist(x, z) < L.river.half + 6) continue;
        const gy = L.groundY(x, z);
        if (gy > 19) continue;
        add(group, birch(random), x, z, { ry: random() * 6.283, dy: -0.1 });
      }
    }
    for (let i = 0; i < 26; i++) {
      const a = random() * Math.PI * 2;
      const r = 90 + random() * 210;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (L.isBuilt(x, z) || L.roadDist(x, z) < 3 || L.riverDist(x, z) < L.river.half + 5) continue;
      add(group, deadTree(random), x, z, { ry: random() * 6.283 });
    }

    const fernMats = scatter(L, -60, 40, 560, 560, 900, (x, gy, z, rnd) => {
      const s = 0.5 + rnd() * 0.7;
      return tr(x, gy + 0.4 * s, z, [(rnd() - 0.5) * 0.2, rnd() * 6.283, 0], [s, s, s]);
    }, { minSlopeY: 16 });
    group.add(instancedTint(new THREE.ConeGeometry(0.34, 0.95, 3, 1, true), M.foliage({ color: '#ffffff' }), fernMats, 0.26, 0.42, 0.3, random));

    const logMats = scatter(L, 0, 0, 600, 600, 70, (x, gy, z, rnd) => tr(x, gy + 0.28, z, [Math.PI / 2, rnd() * 6.283, 0], [1, 1, 1]));
    group.add(instanced(new THREE.CylinderGeometry(0.28, 0.34, 4.4, 7), M.planks({ tone: '#6b5540', boards: 3 }), logMats));

    const stumpMats = scatter(L, 0, 0, 580, 580, 60, (x, gy, z, rnd) => {
      const s = 0.7 + rnd() * 0.7;
      return tr(x, gy + 0.35 * s, z, [0, rnd() * 6.283, 0], [s, s, s]);
    });
    group.add(instanced(new THREE.CylinderGeometry(0.7, 0.85, 0.7, 9), M.planks({ tone: '#6b5540', boards: 3 }), stumpMats));

    const capMats = scatter(L, 0, 0, 560, 560, 260, (x, gy, z, rnd) => {
      const s = 0.5 + rnd() * 0.6;
      return tr(x, gy + 0.22 * s, z, [0, rnd() * 6.283, 0], [s, s * 0.6, s]);
    }, { minSlopeY: 12 });
    group.add(instancedTint(new THREE.SphereGeometry(0.3, 6, 4), M.paint({ color: '#ffffff', roughness: 1 }), capMats, 0.02, 0.5, 0.4, random));

    for (let i = 0; i < 14; i++) {
      const a = random() * Math.PI * 2;
      const r = 110 + random() * 180;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (L.isBuilt(x, z)) continue;
      const s = 0.9 + random() * 1.3;
      group.add(P.cone(1.5 * s, 1.1 * s, 8, M.ground({ tone: 'path' }), { tile: 1.4, pos: [x, y(x, z) + 0.45 * s, z] }));
    }

    /* beehives and a stubble orchard gate */
    add(group, beehives(random), L.orchard.cx - 12, L.orchard.cz + 8, { ry: 0.4 });
    add(group, P.dovecote(), L.orchard.cx + 14, L.orchard.cz - 10, {});

    /* the besiegers' heavy work */
    add(group, siegeTower(random), L.camp.cx - 34, L.camp.cz - 40, { ry: Math.PI + 0.3 });
    add(group, siegeTower(random), L.camp.cx - 8, L.camp.cz - 46, { ry: Math.PI - 0.1 });
    for (let i = 0; i < 9; i++) {
      const x = L.camp.cx - 40 + i * 9;
      const z = L.camp.cz - 52 - Math.abs(i - 4) * 2.5;
      add(group, mantlet(random), x, z, { ry: Math.PI });
    }
    for (let i = 0; i < 3; i++) {
      add(group, P.tent({ scale: 1.3, color: '#4f4a42', seed: 80 + i }), L.camp.cx + 26, L.camp.cz + 22 + i * 8, { ry: 0.4 });
    }
    const campFence = P.fenceLine({ length: 34, spacing: 1.4, height: 1.6 });
    add(group, campFence, L.camp.cx - 30, L.camp.cz + 12, { ry: Math.PI / 2 });
  }

  group.add(overlay);
  const fine = new THREE.Group();
  group.add(fine);
  group.updateMatrixWorld(true);
  const fineProps = splitBySize(group, fine, 1.7);
  mergeStatic(fine, fine);
  const batches = mergeStatic(group, group);
  group.updateMatrixWorld(true);
  return {
    group,
    chimneys,
    crowd,
    beacons,
    lod: [
      { group: fine, maxRadius: 240 },
      ...crowd.map((c) => ({ group: c.group, maxRadius: 205 })),
    ],
    stats: { zones: L.zones.length, batches, fineProps },
    setNight(value) { lightingNight.value = value; },
  };
}

/** Fenced kitchen garden with two beds, a stool and a woodpile. */
function gardenPlot(rng, x, z, L) {
  const g = new THREE.Group();
  const gy = L.groundY(x, z);
  const wood = M.planks({ tone: '#6b5540', boards: 3 });
  for (let i = 0; i < 2; i++) {
    g.add(P.box(3.4, 0.3, 1.1, M.ground({ tone: 'path' }), { tile: 1.2, pos: [0, 0.15, -1 + i * 2] }));
    for (let k = 0; k < 6; k++) {
      g.add(P.cone(0.2, 0.7, 4, M.foliage({ color: k % 2 ? '#5f9a3f' : '#7aa845' }), {
        tile: 0.8, pos: [-1.4 + k * 0.56, 0.6, -1 + i * 2],
      }));
    }
  }
  for (const s of [-1, 1]) {
    const side = P.fenceLine({ length: 4.6, spacing: 1.1, height: 1, mat: wood });
    side.position.set(s * 2.1, 0, 0);
    side.rotation.y = Math.PI / 2;
    g.add(side);
  }
  const back = P.fenceLine({ length: 4.2, spacing: 1.1, height: 1, mat: wood });
  back.position.set(0, 0, -2.4);
  g.add(back);
  const pile = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    pile.add(P.cyl(0.13, 0.15, 1.2, 6, wood, { tile: 0.8, pos: [0, 0.14 + Math.floor(i / 3) * 0.28, -0.4 + (i % 3) * 0.3], rot: [0, 0, Math.PI / 2] }));
  }
  pile.position.set(1.7, 0, 1.9);
  g.add(pile);
  const stool = P.crate(0.7);
  stool.position.set(-1.8, 0.35, 1.9);
  g.add(stool);
  g.position.set(x, gy, z);
  g.rotation.y = (rng() - 0.5) * 0.6;
  return g;
}

/** Bare birch trunk with a pale, sparse crown. */
function birch(rng) {
  const g = new THREE.Group();
  const bark = M.paint({ color: '#d8d4c6', roughness: 0.9 });
  const leaf = M.foliage({ color: '#7aa845' });
  g.add(P.cyl(0.2, 0.32, 6.2, 7, bark, { tile: 1.4, pos: [0, 3.1, 0] }));
  for (let i = 0; i < 3; i++) {
    const a = rng() * 6.283;
    g.add(P.cyl(0.07, 0.1, 1.8, 5, bark, { tile: 0.8, pos: [Math.cos(a) * 0.5, 4.6 + i * 0.5, Math.sin(a) * 0.5], rot: [0, 0, Math.cos(a) * 0.7] }));
  }
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), leaf);
  crown.position.y = 6.6;
  crown.scale.set(1, 0.8, 1);
  g.add(crown);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Standing dead tree: grey trunk, a few broken limbs. */
function deadTree(rng) {
  const g = new THREE.Group();
  const bark = M.paint({ color: '#7d7263', roughness: 1 });
  g.add(P.cyl(0.16, 0.42, 5.4, 7, bark, { tile: 1.4, pos: [0, 2.7, 0] }));
  for (let i = 0; i < 4; i++) {
    const a = rng() * 6.283;
    g.add(P.cyl(0.05, 0.12, 1.6 + rng(), 5, bark, {
      tile: 0.8,
      pos: [Math.cos(a) * 0.5, 3.2 + i * 0.5, Math.sin(a) * 0.5],
      rot: [Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9],
    }));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** A-frame net dryer with sagging netting. */
function netFrame(rng, x, z, L) {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5540', boards: 3 });
  for (const s of [-1, 1]) {
    g.add(P.cyl(0.1, 0.13, 3.4, 6, wood, { tile: 0.8, pos: [s * 1.2, 1.7, 0], rot: [0, 0, s * 0.16] }));
  }
  g.add(P.box(2.8, 0.12, 0.12, wood, { tile: 0.8, pos: [0, 3.2, 0] }));
  const net = P.cloth({ w: 2.4, h: 1.8, segX: 4, segY: 5, mat: M.paint({ color: '#c8c0aa', roughness: 1 }), pos: [0, 2, 0.05] });
  g.add(net);
  onTick((t) => P.flapCloth(net, t, 0.06, 1.4));
  for (let i = 0; i < 3; i++) {
    const drum = P.barrel();
    drum.position.set(-1.8 + i * 1.6, 0.4, 1.4 + rng() * 0.6);
    g.add(drum);
  }
  g.position.set(x, L.groundY(x, z), z);
  g.rotation.y = rng() * 3;
  g.userData.noMerge = true;
  return g;
}

/** Simple timber footbridge across a small watercourse. */
function footbridge(x, z, L, len = 16) {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5540', boards: 4 });
  g.add(P.box(3, 0.28, len, wood, { tile: 2, pos: [0, 0.5, 0] }));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      g.add(P.cyl(0.1, 0.12, 2.6, 5, wood, { tile: 0.8, pos: [s * 1.4, -0.6, -len / 2 + 2 + i * (len / 4)] }));
      g.add(P.box(0.12, 0.9, len, wood, { tile: 0.8, pos: [s * 1.45, 1, 0] }));
    }
  }
  g.position.set(x, L.river.waterY + 0.9, z);
  g.rotation.y = Math.PI / 2 + L.river.dirAt(x);
  return g;
}

/** Two-stage wooden siege tower on drums. */
function siegeTower(rng) {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5f4a', boards: 4 });
  const dark = M.planks({ tone: '#4b3626', boards: 3 });
  g.add(P.box(6.4, 0.5, 6.4, dark, { tile: 2, pos: [0, 0.9, 0] }));
  for (const s of [-1, 1]) {
    for (const z of [-2.6, 2.6]) {
      g.add(P.cyl(0.8, 0.8, 0.6, 10, wood, { tile: 1, pos: [s * 2.4, 0.8, z], rot: [0, 0, Math.PI / 2] }));
    }
    for (const z of [-3, 3]) g.add(P.box(0.4, 7, 0.4, wood, { tile: 1.2, pos: [s * 2.8, 4.2, z] }));
    for (const x of [-2.8, 2.8]) g.add(P.box(0.4, 7, 0.4, wood, { tile: 1.2, pos: [x, 4.2, 0] }));
  }
  g.add(P.box(6.8, 0.4, 6.8, wood, { tile: 2, pos: [0, 4.4, 0] }));
  g.add(P.box(6.8, 0.4, 6.8, wood, { tile: 2, pos: [0, 7.8, 0] }));
  const roof = P.cone(4.6, 2.4, 4, dark, { tile: 2, pos: [0, 9.1, 0], rot: [0, Math.PI / 4, 0] });
  g.add(roof);
  for (let i = 0; i < 5; i++) {
    g.add(P.box(0.5, 1.2, 0.1, dark, { tile: 0.6, pos: [-2 + i, 5.4, 3.45] }));
  }
  const ladder = P.box(0.9, 9, 0.2, wood, { tile: 1, pos: [0, 4.5, 3.9], rot: [0.22, 0, 0] });
  g.add(ladder);
  g.add(P.box(3.4, 0.3, 2.2, wood, { tile: 1, pos: [0, 0.35, 4.4], rot: [-0.12, 0, 0] }));
  void rng;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Pavise: a tall shield propped on the ground facing the walls. */
function mantlet(rng) {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5540', boards: 3 });
  const face = P.box(1.6, 3.2, 0.18, wood, { tile: 1.2, pos: [0, 1.5, 0] });
  face.rotation.x = -0.16;
  g.add(face);
  for (const s of [-1, 1]) g.add(P.cyl(0.08, 0.1, 1.8, 5, wood, { tile: 0.8, pos: [s * 0.6, 0.9, -0.5], rot: [0.5, 0, 0] }));
  g.add(P.box(1.7, 0.4, 0.2, M.paint({ color: '#8a3f3a', roughness: 0.9 }), { tile: 0.8, pos: [0, 2.6, 0.02] }));
  g.rotation.y = rng() * 0.4 - 0.2;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Beehive skeps in the orchard. */
function beehives(rng) {
  const g = new THREE.Group();
  const straw = M.thatch({ tone: '#c3a05c' });
  for (let i = 0; i < 4; i++) {
    const skep = new THREE.Group();
    skep.add(P.cyl(0.55, 0.7, 0.9, 9, straw, { tile: 1 }));
    skep.add(P.cone(0.6, 0.5, 9, straw, { tile: 1, pos: [0, 0.7, 0] }));
    skep.position.set((i % 2) * 1.5, 0.45, Math.floor(i / 2) * 1.3);
    g.add(skep);
  }
  g.add(P.box(2.6, 0.9, 0.12, M.planks({ tone: '#6b5540' }), { tile: 0.8, pos: [0.7, 0.45, -0.9] }));
  void rng;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function instancedTint(geo, mat, matrices, hue, sat, light, rnd) {
  const colors = matrices.map(() => new THREE.Color().setHSL(hue + rnd() * 0.06, sat, light + rnd() * 0.12));
  return instanced(geo, mat, matrices, colors);
}

/** Scatter a patch of small instances over an area, skipping built ground. */
function scatter(L, x, z, spreadX, spreadZ, count, build, { avoidBuildings = true, minSlopeY = null } = {}) {
  const rnd = L.random;
  const out = [];
  for (let i = 0; i < count; i++) {
    const px = x + (rnd() - 0.5) * spreadX;
    const pz = z + (rnd() - 0.5) * spreadZ;
    if (avoidBuildings && (L.isBuilt(px, pz) || L.roadDist(px, pz) < 2)) continue;
    const gy = L.groundY(px, pz);
    if (minSlopeY !== null && gy > minSlopeY) continue;
    out.push(build(px, gy, pz, rnd, i));
  }
  return out;
}

const _m4 = new THREE.Matrix4();
const _vp = new THREE.Vector3();
const _vq = new THREE.Quaternion();
const _vs = new THREE.Vector3();
const _ve = new THREE.Euler();

function tr(x, y, z, rot, scale) {
  _ve.set(rot[0], rot[1], rot[2]);
  _m4.compose(_vp.set(x, y, z), _vq.setFromEuler(_ve), _vs.set(scale[0], scale[1], scale[2]));
  return _m4.clone();
}

/** Lily pads and reed islets on still water. */
function lilyPads(L, count = 90) {
  const rnd = L.random;
  const mats = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.8;
    const x = L.pond.cx + Math.cos(a) * L.pond.hx * r;
    const z = L.pond.cz + Math.sin(a) * L.pond.hz * r;
    const s = 0.4 + rnd() * 0.5;
    mats.push(tr(x, L.pondWaterY + 0.04, z, [0, rnd() * 6.283, 0], [s, 1, s]));
  }
  const geo = new THREE.CircleGeometry(0.6, 7);
  geo.rotateX(-Math.PI / 2);
  return instanced(geo, M.foliage({ color: '#3f7a4a' }), mats);
}

/** Pebble and shingle bars inside the channel. */
function sandBars(L, count = 130) {
  const rnd = L.random;
  const mats = [];
  for (let i = 0; i < count; i++) {
    const x = -360 + rnd() * 720;
    const z = L.river.centerZ(x) + (rnd() - 0.5) * L.river.half * 1.5;
    const s = 0.3 + rnd() * 0.7;
    mats.push(tr(x, L.river.waterY + 0.1 + s * 0.1, z, [rnd() * 0.4, rnd() * 6.283, rnd() * 0.4], [s, s * 0.5, s]));
  }
  return instancedTint(new THREE.DodecahedronGeometry(0.7, 0), M.rubble(), mats, 0.09, 0.08, 0.46, rnd);
}

/** Cobble paving: a patch of setts around the market and the street cross. */
function cobbles(L, cx, cz, hx, hz, step = 1.15) {
  const rnd = L.random;
  const mats = [];
  for (let x = -hx; x <= hx; x += step) {
    for (let z = -hz; z <= hz; z += step) {
      const px = cx + x + (rnd() - 0.5) * 0.25;
      const pz = cz + z + (rnd() - 0.5) * 0.25;
      if (Math.hypot(px - cx, pz - cz) < 2.6) continue;
      mats.push(tr(px, L.groundY(px, pz) + 0.07, pz, [0, rnd() * 0.5, 0], [0.82, 1, 0.62]));
    }
  }
  return instancedTint(new THREE.BoxGeometry(1, 0.14, 0.8), M.stone('grey'), mats, 0.08, 0.04, 0.42, rnd);
}

/** Pillory and stocks on the green. */
function pillory() {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#5b4630', boards: 3 });
  g.add(P.box(0.4, 1.6, 0.4, wood, { tile: 0.8, pos: [0, 0.8, 0] }));
  g.add(P.box(1.8, 0.3, 0.9, wood, { tile: 0.8, pos: [0, 1.5, 0] }));
  for (const s of [-1, 1]) g.add(P.box(0.2, 0.2, 0.2, wood, { tile: 0.4, pos: [s * 0.6, 1.66, 0] }));
  g.add(P.cyl(0.5, 0.55, 0.4, 8, M.stone('grey'), { tile: 0.8, pos: [0, 0.2, 0] }));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const lightingNight = { value: 0 };


function instanced(geometry, material, matrices, colors) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
    if (colors) mesh.setColorAt(i, colors[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** World positions of every chimney pot in a subtree, collected before merging. */
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

/**
 * Instanced crowd walking closed loops — one draw call per body part for the
 * whole town instead of one per figure.
 */
function makeCrowd(parent, opts) {
  const random = T.rng(opts.seed);
  const count = opts.count;
  const loops = opts.loops.map((pts) => {
    const closed = [...pts];
    let total = 0;
    const lens = [];
    for (let i = 0; i < closed.length; i++) {
      const a = closed[i], b = closed[(i + 1) % closed.length];
      const l = a.distanceTo(b);
      lens.push(l);
      total += l;
    }
    return {
      total,
      at(k) {
        let target = ((k % 1) + 1) % 1 * total;
        for (let i = 0; i < closed.length; i++) {
          if (target <= lens[i]) {
            const a = closed[i], b = closed[(i + 1) % closed.length];
            return a.clone().lerp(b, lens[i] ? target / lens[i] : 0);
          }
          target -= lens[i];
        }
        return closed[0].clone();
      },
    };
  });
  const height = opts.height ?? 0.78;
  const headY = opts.headY ?? 0.85;
  const bodyScale = opts.bodyScale ?? [1, 1, 1];
  const bodyGeo = opts.bodyGeo ?? new THREE.ConeGeometry(0.46, 1.5, 7);
  const headGeo = opts.headGeo ?? new THREE.SphereGeometry(0.25, 7, 5);
  const bodyMat = opts.palette.length === 1
    ? M.paint({ color: opts.palette[0], roughness: 1 })
    : M.paint({ color: '#ffffff', roughness: 1 });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
  const heads = new THREE.InstancedMesh(headGeo, M.paint({ color: opts.headColor || '#c99a6c', roughness: 0.9 }), count);
  bodies.castShadow = true;
  heads.castShadow = true;
  const walkers = [];
  for (let i = 0; i < count; i++) {
    const loop = loops[i % loops.length];
    walkers.push({
      loop,
      progress: random(),
      speed: (opts.speed ?? 1) * (0.6 + random() * 0.8) / loop.total,
      bob: random() * 6.283,
      wobble: 0.7 + random() * 0.9,
      scale: 0.85 + random() * 0.35,
      tint: new THREE.Color(random() > 0.5 ? opts.palette[i % opts.palette.length] : opts.palette[(i + 2) % opts.palette.length]),
    });
    bodies.setColorAt(i, walkers[i].tint);
  }
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  const crowdGroup = new THREE.Group();
  bodies.userData.noMerge = true;
  heads.userData.noMerge = true;
  crowdGroup.add(bodies, heads);
  parent.add(crowdGroup);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const e = new THREE.Euler();
  return {
    group: crowdGroup,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const w = walkers[i];
        w.progress += dt * w.speed;
        const point = w.loop.at(w.progress);
        const ahead = w.loop.at(w.progress + 0.012);
        dir.subVectors(ahead, point);
        const yaw = Math.atan2(dir.x, dir.z);
        e.set(0, yaw, Math.sin(t * w.wobble * 3 + w.bob) * 0.05);
        q.setFromEuler(e);
        const lift = Math.abs(Math.sin(t * w.wobble * 3 + w.bob)) * (opts.bob ?? 0.09);
        m.compose(p.set(point.x, point.y + height * w.scale + lift, point.z), q,
          s.set(w.scale * bodyScale[0], w.scale * bodyScale[1], w.scale * bodyScale[2]));
        bodies.setMatrixAt(i, m);
        m.compose(p.set(point.x, point.y + (height + headY) * w.scale + lift, point.z), q,
          s.set(w.scale, w.scale, w.scale));
        heads.setMatrixAt(i, m);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    },
  };
}
