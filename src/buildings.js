import * as THREE from 'three';
import * as M from './materials.js';
import { boxUV, scaleUV } from './materials.js';
import * as T from './textures.js';
import * as P from './parts.js';
import { onTick } from './runtime.js';

const ROOFS = {
  tile: (tone) => M.tiles({ tone }),
  shingle: (tone) => M.shingles({ tone }),
  thatch: (tone) => M.thatch({ tone }),
};

function roofMat(style = 'tile', tone = '#8a4b36') {
  return (ROOFS[style] || ROOFS.tile)(tone);
}

function archShape(w, h) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(-w / 2, h - w / 2);
  shape.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
  shape.lineTo(w / 2, 0);
  shape.closePath();
  return shape;
}

function archMesh(w, h, depth, mat) {
  const geo = new THREE.ExtrudeGeometry(archShape(w, h), { depth, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Glowing window with a stone surround. Registered as an emissive surface. */
export function windowUnit({ x = 0, y = 3, z = 0, yaw = 0, w = 0.9, h = 1.6, arch = false, wall, depth = 0.35 }) {
  const group = new THREE.Group();
  const paneMat = M.glow({ color: '#ffbe6b', intensity: 0.2 });
  paneMat.userData.window = true;
  const surroundMat = wall || M.stone('dark');
  if (arch) {
    const frame = archMesh(w + 0.4, h + 0.3, depth + 0.1, surroundMat);
    const pane = archMesh(w, h, depth * 0.5, paneMat);
    pane.position.z = 0.1;
    group.add(frame, pane);
  } else {
    group.add(P.box(w + 0.4, h + 0.4, depth + 0.1, surroundMat, { tile: 1.5, pos: [0, h / 2, 0] }));
    group.add(P.box(w, h, depth * 0.6, paneMat, { tile: 1.5, pos: [0, h / 2, 0.08] }));
    for (const s of [-1, 1]) group.add(P.box(0.1, h, depth * 0.7, surroundMat, { tile: 1, pos: [s * w * 0.28, h / 2, 0.12] }));
  }
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  return group;
}

export function doorUnit({ w = 2.4, h = 3.6, z = 0, wall, tone = '#4a3524' }) {
  const group = new THREE.Group();
  const wood = M.planks({ tone, boards: 4 });
  group.add(archMesh(w + 0.7, h + 0.4, 0.8, wall || M.stone('dark')));
  group.add(archMesh(w, h, 0.45, wood));
  const g = group.children[1];
  g.position.z = 0.1;
  for (const s of [-1, 1]) {
    group.add(P.box(0.16, h * 0.42, 0.18, M.metal({ color: '#39352f' }), { tile: 0.6, pos: [s * w * 0.22, h * 0.45, 0.32] }));
  }
  group.position.set(0, 0, z);
  return group;
}

function towerFlag({ y, faction, pole = 4.5, size = 3 }) {
  const group = new THREE.Group();
  group.add(P.cyl(0.1, 0.13, pole, 6, M.metal({ color: '#8d8577', roughness: 0.5, metalness: 0.7 }), { tile: 1, pos: [0, pole / 2, 0] }));
  const flag = P.cloth({ w: size, h: size * 0.66, segX: 7, segY: 5, mat: faction.mat, pos: [size / 2, pole - size * 0.42, 0], rot: [0, Math.PI / 2, 0] });
  group.add(flag);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.metal({ color: faction.gilt, roughness: 0.25, metalness: 1 })).translateY(pole + 0.2));
  P.flapCloth(flag, 0, 0.18, 2.1);
  onTick((t) => P.flapCloth(flag, t, 0.2, 2.1));
  return group;
}

export function roundTower({
  radius = 6,
  height = 16,
  roof = 'cone',
  stone = 'grey',
  roofTone = '#43676b',
  roofStyle = 'shingle',
  faction = null,
  levels = 2,
  seed = 1,
  plinth = true,
}) {
  const group = new THREE.Group();
  const wall = M.stone(stone);
  const top = height;
  if (plinth) group.add(P.cyl(radius * 1.2, radius * 1.3, 1.5, 20, M.stone('dark'), { tile: 4, pos: [0, 0.75, 0] }));
  const shaft = P.cyl(radius * 0.97, radius, height, 22, wall, { tile: 4.2, pos: [0, 1.5 + height / 2, 0] });
  group.add(shaft);
  for (const t of [0.38, 0.72]) {
    group.add(P.cyl(radius + 0.34, radius + 0.34, 0.55, 22, M.stone('warm'), { tile: 3, pos: [0, 1.5 + height * t, 0] }));
  }
  group.add(P.corbelRing({ radius: radius + 0.55, y: top + 0.5, mat: M.stone('warm'), count: Math.max(10, Math.round(radius * 3)), size: 0.62, depth: 1.2 }));
  group.add(P.cyl(radius * 1.16, radius * 1.06, 0.7, 22, M.stone('grey'), { tile: 3.4, pos: [0, top + 1.05, 0] }));
  group.add(P.cyl(radius * 0.98, radius * 0.98, 0.3, 22, M.planks({ tone: '#6f5a41' }), { tile: 2.6, pos: [0, top + 1.5, 0] }));
  group.add(P.slitField({ radius: radius + 0.05, y0: 1.5 + height * 0.45, y1: top - 1.2, levels, count: 5, mat: M.paint({ color: '#1b1f24', roughness: 1 }), seed, width: 0.36, height: 2 }));
  group.add(P.windowsRing({ radius: radius + 0.06, y0: 1.5 + height * 0.2, y1: 1.5 + height * 0.62, levels: 2, count: 3, mat: (() => { const m = M.glow({ color: '#ffc276', intensity: 0.15 }); m.userData.window = true; return m; })(), seed: seed + 2, size: [0.7, 1.3], phase: 0.5 }));

  const deck = top + 1.4;
  if (roof === 'cone') {
    const coneH = radius * 1.75;
    group.add(P.cone(radius * 1.24, coneH, 20, roofMat(roofStyle, roofTone), { tile: 2.6, pos: [0, deck + 0.5 + coneH / 2, 0] }));
    group.add(P.cyl(0.12, 0.12, 1.2, 6, M.metal({ color: '#b9a34c', metalness: 1, roughness: 0.3 }), { tile: 1, pos: [0, deck + coneH + 1.1, 0] }));
    if (faction) group.add(towerFlag({ y: deck + coneH + 0.5, faction, pole: 4, size: radius * 0.85 }).translateY(0));
  } else if (roof === 'battlement') {
    group.add(P.merlonRing({ radius: radius * 0.94, y: deck + 0.2, mat: M.stone(stone), height: 1.7, pitch: 2.5 }));
    if (faction) {
      const pole = towerFlag({ y: deck + 6, faction, pole: 6.5, size: radius * 0.8 });
      pole.position.y = deck + 2;
      group.add(pole);
    }
    const turret = P.cyl(radius * 0.34, radius * 0.36, 4.2, 12, M.stone('warm'), { tile: 2.4, pos: [radius * 0.45, deck + 2.4, -radius * 0.4] });
    group.add(turret);
    group.add(P.cone(radius * 0.46, 2.2, 10, roofMat(roofStyle, roofTone), { tile: 1.6, pos: [radius * 0.45, deck + 5.5, -radius * 0.4] }));
  } else {
    group.add(P.merlonRing({ radius: radius * 0.94, y: deck, mat: M.stone(stone), height: 1.5, pitch: 2.6 }));
  }
  group.userData.top = deck + (roof === 'cone' ? radius * 1.75 + 2 : 4);
  group.userData.radius = radius;
  return group;
}

export function squareTower({ w = 8, d = 8, height = 12, stone = 'grey', roof = 'pyramid', roofTone = '#43676b', roofStyle = 'shingle', faction = null, seed = 4 }) {
  const group = new THREE.Group();
  const wall = M.stone(stone);
  group.add(P.box(w + 1.2, 1.3, d + 1.2, M.stone('dark'), { tile: 4, pos: [0, 0.65, 0] }));
  group.add(P.box(w, height, d, wall, { tile: 4.2, pos: [0, 1.3 + height / 2, 0] }));
  for (const t of [0.42, 0.9]) group.add(P.box(w + 0.55, 0.45, d + 0.55, M.stone('warm'), { tile: 3, pos: [0, 1.3 + height * t, 0] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    group.add(P.box(0.9, height + 1.6, 0.9, M.stone('warm'), { tile: 3, pos: [sx * (w / 2 - 0.2), (height + 1.6) / 2 + 0.9, sz * (d / 2 - 0.2)] }));
  }
  const deck = 1.3 + height;
  group.add(P.merlonLine({ length: w, y: deck + 0.2, z: d / 2 - 0.4, mat: wall, height: 1.6, seed }));
  group.add(P.merlonLine({ length: w, y: deck + 0.2, z: -d / 2 + 0.4, mat: wall, height: 1.6, seed: seed + 1 }));
  for (const s of [-1, 1]) {
    const line = P.merlonLine({ length: d, y: deck + 0.2, z: 0, mat: wall, height: 1.6, seed: seed + 2 });
    line.rotation.y = Math.PI / 2;
    line.position.x = s * (w / 2 - 0.4);
    group.add(line);
  }
  if (roof === 'pyramid') {
    group.add(P.cone(Math.hypot(w, d) / 2 * 0.82, w * 0.95, 4, roofMat(roofStyle, roofTone), { tile: 2.4, pos: [0, deck + 2.6 + w * 0.45, 0], rot: [0, Math.PI / 4, 0] }));
    if (faction) group.add(towerFlag({ y: deck + 2.6 + w * 0.9, faction, pole: 3.6, size: 2.6 }));
  }
  const random = T.rng(seed + 9);
  for (let i = 0; i < 3; i++) {
    const face = Math.floor(random() * 4);
    const yaw = (face / 4) * Math.PI * 2;
    const off = (random() - 0.5) * (w * 0.5);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    group.add(windowUnit({
      x: dir.x * (w / 2 + 0.05) + Math.cos(yaw) * off,
      y: 1.3 + height * (0.35 + random() * 0.5),
      z: dir.z * (d / 2 + 0.05) - Math.sin(yaw) * off,
      yaw, w: 0.95, h: 1.9, arch: random() > 0.4, wall,
    }));
  }
  group.userData.deck = deck;
  return group;
}

/** Straight curtain wall segment: +Z is the outward face. */
export function curtainWall({ length, height = 9, thickness = 3.2, stone = 'grey', hoarding = false, torches = 0, seed = 1 }) {
  const group = new THREE.Group();
  const wall = M.stone(stone);
  group.add(P.box(length, 1.5, thickness + 1.4, M.stone('dark'), { tile: 4.4, pos: [0, 0.75, 0] }));
  group.add(P.box(length, height, thickness, wall, { tile: 4.4, pos: [0, 1.5 + height / 2, 0] }));
  group.add(P.box(length, 0.4, thickness + 0.6, M.stone('warm'), { tile: 3.2, pos: [0, 1.5 + height * 0.62, 0] }));
  const deck = 1.5 + height;
  group.add(P.box(length - 0.4, 0.22, thickness - 0.5, M.planks({ tone: '#6d5540' }), { tile: 2.4, pos: [0, deck + 0.11, 0] }));
  group.add(P.merlonLine({ length, y: deck + 0.2, z: thickness / 2 - 0.45, mat: wall, height: 1.75, seed }));
  group.add(P.merlonLine({ length, y: deck + 0.2, z: -thickness / 2 + 0.4, mat: wall, height: 1.1, width: 1.2, gap: 1.2, seed: seed + 3 }));
  const corbelCount = Math.max(4, Math.round(length / 2.6));
  const corbelGeo = new THREE.BoxGeometry(0.55, 0.55, 1.1);
  boxUV(corbelGeo, 2);
  const corbels = new THREE.InstancedMesh(corbelGeo, M.stone('warm'), corbelCount);
  const m = new THREE.Matrix4();
  for (let i = 0; i < corbelCount; i++) {
    m.compose(new THREE.Vector3((i - (corbelCount - 1) / 2) * (length / corbelCount), deck - 0.35, thickness / 2 + 0.4), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    corbels.setMatrixAt(i, m);
  }
  corbels.instanceMatrix.needsUpdate = true;
  corbels.castShadow = true;
  group.add(corbels);

  if (hoarding) {
    const wood = M.planks({ tone: '#6b4f35' });
    const y = deck + 1.1;
    group.add(P.box(length, 0.28, 2.4, wood, { tile: 2, pos: [0, y, thickness / 2 + 0.7] }));
    group.add(P.box(length, 1.5, 0.18, wood, { tile: 2, pos: [0, y + 0.9, thickness / 2 + 1.8] }));
    for (let i = 0; i < Math.round(length / 2.2); i++) {
      const x = (i - (Math.round(length / 2.2) - 1) / 2) * 2.2;
      group.add(P.box(0.5, 0.5, 1.8, wood, { tile: 1.4, pos: [x, y - 0.45, thickness / 2 + 0.6] }));
      group.add(P.box(0.9, 1.4, 0.16, wood, { tile: 1.2, pos: [x + 1.1, y + 0.9, thickness / 2 + 1.82] }));
    }
  }

  if (torches > 0) {
    for (let i = 0; i < torches; i++) {
      const x = (i - (torches - 1) / 2) * (length / Math.max(1, torches));
      const sconce = P.torchSconce({ y: deck - 1.2, wall });
      sconce.position.set(x, 0, thickness / 2 + 0.3);
      group.add(sconce);
      onTick((t, dt) => {
        P.updateFlame(sconce.userData.flame, t);
        if (sconce.userData.glow) sconce.userData.glow.material.opacity = 0.28 + Math.sin(t * 7 + x) * 0.08;
      });
    }
  }
  group.userData.deck = deck;
  return group;
}

export function gatehouse({ span = 26, height = 12, opening = 8.4, towerRadius = 6.4, stone = 'grey', faction, roofStyle = 'shingle', roofTone = '#43676b', wallThickness = 3.2 }) {
  const group = new THREE.Group();
  const wall = M.stone(stone);
  const depth = 7.4;
  const half = opening / 2;
  const towerX = half + towerRadius * 0.82;

  const bodyMat = wall;
  for (const s of [-1, 1]) {
    const blockW = towerX - half + towerRadius * 0.9;
    group.add(P.box(blockW, height, depth, bodyMat, { tile: 4.4, pos: [s * (half + blockW / 2 - 0.4), height / 2 + 1, 0] }));
  }
  group.add(P.box(opening + 3, 1.6, depth + 0.8, M.stone('dark'), { tile: 4, pos: [0, 0.8, 0] }));

  const archR = half * 0.98;
  const springY = height * 0.42 + 1;
  const deckProbe = height + 1;
  group.add(P.box(opening + 1.4, deckProbe - springY, depth, wall, { tile: 4.4, pos: [0, (springY + deckProbe) / 2, 0] }));
  const voussoirs = Math.round(Math.PI / 0.24);
  const arcGeo = new THREE.BoxGeometry(((Math.PI * archR) / voussoirs) * 1.08, 1.3, depth * 1.02);
  boxUV(arcGeo, 2.4);
  const arch = new THREE.InstancedMesh(arcGeo, M.stone('warm'), voussoirs);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < voussoirs; i++) {
    const a = (Math.PI * (i + 0.5)) / voussoirs;
    p.set(Math.cos(a) * archR, springY + Math.sin(a) * archR, 0);
    q.setFromEuler(new THREE.Euler(0, 0, a - Math.PI / 2));
    if (i === Math.floor(voussoirs / 2)) s1.set(1.12, 1.25, 1.05);
    m.compose(p, q, s1);
    arch.setMatrixAt(i, m);
    s1.set(1, 1, 1);
  }
  arch.instanceMatrix.needsUpdate = true;
  arch.castShadow = true;
  group.add(arch);

  const passageFloor = P.box(opening, 0.2, depth + 2, M.stone('warm'), { tile: 2.6, pos: [0, 0.12, 0] });
  group.add(passageFloor);

  const iron = M.metal({ color: '#2f3236', roughness: 0.5, metalness: 0.85 });
  const portcullis = new THREE.Group();
  const barCount = Math.floor(opening / 0.8);
  const railCount = 5;
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, height * 0.44, 0.18), iron, barCount);
  for (let i = 0; i < barCount; i++) {
    m.compose(new THREE.Vector3(-opening / 2 + (i + 0.5) * (opening / barCount), height * 0.22, 0), q, s1);
    bars.setMatrixAt(i, m);
  }
  bars.instanceMatrix.needsUpdate = true;
  bars.castShadow = true;
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(opening, 0.19, 0.19), iron, railCount);
  for (let r = 0; r < railCount; r++) {
    m.compose(new THREE.Vector3(0, 0.5 + r * ((height * 0.4) / (railCount - 1)), 0), q, s1);
    rails.setMatrixAt(r, m);
  }
  rails.instanceMatrix.needsUpdate = true;
  rails.castShadow = true;
  portcullis.add(bars, rails);
  portcullis.traverse((o) => { o.userData.noMerge = true; });
  portcullis.position.set(0, 0, depth / 2 - 1.1);
  group.add(portcullis);
  const state = { raise: 0, target: 0 };
  const lift = (value) => {
    state.target = THREE.MathUtils.clamp(value, 0, 1);
  };
  onTick((t, dt) => {
    state.raise += (state.target - state.raise) * (1 - Math.exp(-3.2 * dt));
    portcullis.position.y = state.raise * (height * 0.44);
    void t;
  });

  const deckY = height + 1;
  group.add(P.box(opening + 6, 0.5, depth + 1, M.stone('grey'), { tile: 3.2, pos: [0, deckY, 0] }));
  group.add(P.merlonLine({ length: opening + 6, y: deckY + 0.3, z: depth / 2 - 0.2, mat: wall, height: 1.8, seed: 7 }));
  group.add(P.merlonLine({ length: opening + 6, y: deckY + 0.3, z: -depth / 2 + 0.2, mat: wall, height: 1.2, seed: 8 }));
  for (let i = 0; i < 7; i++) {
    const x = -opening / 2 - 1 + i * ((opening + 2) / 6);
    group.add(P.box(0.6, 0.9, 1.5, M.stone('warm'), { tile: 1.8, pos: [x, deckY - 0.7, depth / 2 + 0.5] }));
    group.add(P.box(0.5, 0.7, 0.5, M.stone('dark'), { tile: 1.4, pos: [x, deckY - 0.2, depth / 2 + 1.1] }));
  }
  for (const s of [-1, 1]) {
    const lamp = P.flame({ size: 0.7, y: height * 0.55 });
    lamp.position.set(s * (half + 0.8), height * 0.5, depth / 2 + 0.4);
    group.add(lamp);
    onTick((t) => P.updateFlame(lamp, t));
    const light = new THREE.PointLight('#ff9b3e', 12, 18, 2);
    light.position.copy(lamp.position).add(new THREE.Vector3(0, 0.4, 0.3));
    group.add(light);
  }
  if (faction) {
    for (const s of [-1, 1]) {
      const bnr = P.cloth({ w: 2.6, h: 5.4, segX: 5, segY: 10, mat: faction.mat, pos: [s * (half + 1.4), height * 0.52, depth / 2 + 0.35], rot: [0, 0, 0] });
      group.add(bnr);
      onTick((t) => P.flapCloth(bnr, t, 0.1, 1.6));
    }
  }

  for (const s of [-1, 1]) {
    const tower = roundTower({ radius: towerRadius, height: height * 1.5, stone, roof: 'cone', roofStyle, roofTone, faction, seed: s > 0 ? 12 : 17 });
    tower.position.set(s * towerX, 0, 0);
    group.add(tower);
  }
  group.userData.liftPortcullis = lift;
  group.userData.portcullisState = state;
  group.userData.opening = opening;
  group.userData.depth = depth;
  return group;
}

export function keep({ w = 18, d = 16, height = 24, stone = 'grey', faction, roofStyle = 'shingle', roofTone = '#3f6a6e', turrets = 2, hallRoof = true }) {
  const group = new THREE.Group();
  const tower = squareTower({ w, d, height, stone, roof: 'none', seed: 21 });
  group.add(tower);
  const deck = tower.userData.deck;
  const wall = M.stone(stone);

  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      if (turrets < 2 && s * t < 0) continue;
      const turret = roundTower({ radius: w * 0.16, height: height * 0.24, stone, roof: 'cone', roofStyle, roofTone, faction: turrets >= 4 ? faction : null, levels: 1, plinth: false, seed: 30 + s * t });
      turret.position.set(s * (w / 2 - 0.6), deck + 1.2, t * (d / 2 - 0.6));
      group.add(turret);
    }
  }

  if (hallRoof) {
    const rise = d * 0.42;
    const roofGeo = P.gableRoofGeometry(w - 3.4, d - 3.4, rise, 0.4, 2.6);
    const roof = new THREE.Mesh(roofGeo, roofMat(roofStyle, roofTone));
    roof.rotation.y = Math.PI / 2;
    roof.position.y = deck + 1.1;
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);
    group.add(P.box(0.5, 0.34, d - 2.4, M.stone('warm'), { tile: 2, pos: [0, deck + 1.1 + rise + 0.1, 0] }));
    for (const s of [-1, 1]) {
      const chimney = P.box(1.5, 4.4, 1.5, M.stone('warm'), { tile: 2.2, pos: [s * (w * 0.22), deck + rise * 0.55 + 2.2, s * (d * 0.2)] });
      group.add(chimney);
      const pot = new THREE.Object3D();
      pot.position.set(s * (w * 0.22), deck + rise * 0.55 + 4.5, s * (d * 0.2));
      pot.userData.chimneySmoke = true;
      group.add(pot);
      group.add(P.box(1.7, 0.3, 1.7, M.stone('dark'), { tile: 1.6, pos: [s * (w * 0.22), deck + rise * 0.55 + 4.5, s * (d * 0.2)] }));
    }
  }

  const random = T.rng(77);
  const bigWindows = 6;
  for (let i = 0; i < bigWindows; i++) {
    const face = i % 4;
    const yaw = (face / 4) * Math.PI * 2;
    const along = (random() - 0.5) * 0.6;
    const onX = face === 0 || face === 2;
    group.add(windowUnit({
      x: onX ? Math.sign(Math.sin(yaw)) * (w / 2 + 0.05) : along * w,
      y: height * (0.4 + random() * 0.42),
      z: onX ? along * d : Math.sign(Math.cos(yaw)) * (d / 2 + 0.05),
      yaw, w: 1.4, h: 3.1, arch: true, wall,
    }));
  }
  for (let i = 0; i < 10; i++) {
    const face = Math.floor(random() * 4);
    const yaw = (face / 4) * Math.PI * 2 + Math.PI / 4;
    group.add(P.box(0.5, 0.7, 0.4, M.stone('dark'), { tile: 1, pos: [Math.sin(yaw) * (w / 2), height * (0.15 + random() * 0.7), Math.cos(yaw) * (d / 2)], rot: [0, yaw, 0] }));
  }

  const foreH = height * 0.28;
  const fore = P.box(6.4, foreH, 6, wall, { tile: 4, pos: [w / 2 + 3, foreH / 2, d / 2 - 3] });
  group.add(fore);
  const stairs = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.35, 0.8), M.stone('warm'), 11);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 11; i++) {
    mm.compose(new THREE.Vector3(w / 2 + 5.4 - i * 0.26, 0.2 + i * 0.34, d / 2 - 0.1 - i * 0.72), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    stairs.setMatrixAt(i, mm);
  }
  stairs.instanceMatrix.needsUpdate = true;
  stairs.castShadow = true;
  stairs.receiveShadow = true;
  group.add(stairs);
  group.add(windowUnit({ x: w / 2 + 6.05, y: foreH - 1.4, z: d / 2 - 3, yaw: Math.PI / 2, w: 2, h: 2.4, arch: true, wall }));
  group.add(P.box(6.8, 0.6, 6.4, M.stone('dark'), { tile: 2.6, pos: [w / 2 + 3, foreH + 0.3, d / 2 - 3] }));
  group.add(P.merlonLine({ length: 6, y: foreH + 0.6, z: d / 2 - 3 + 2.6, mat: wall, height: 1.2, width: 0.9, gap: 0.9 }));

  const banner = towerFlag({ y: deck + (hallRoof ? d * 0.42 + 2 : 4), faction, pole: 5.5, size: 4.2 });
  banner.position.set(-w * 0.18, 0, -d * 0.18);
  group.add(banner);

  group.userData.deck = deck;
  group.userData.height = height;
  return group;
}

export function house({
  w = 10,
  d = 16,
  h = 4.6,
  wallKind = 'warm',
  roofStyle = 'tile',
  roofTone = '#9c5238',
  ridgeAlong = 'z',
  timber = false,
  chimney = false,
  windows = 3,
  door = true,
  rise = null,
  story = 1,
  seed = 2,
  plinth = true,
}) {
  const group = new THREE.Group();
  const random = T.rng(seed);
  const wall = M.stone(wallKind);
  const totalH = h * story;
  if (plinth) group.add(P.box(w + 0.7, 0.6, d + 0.7, M.stone('dark'), { tile: 3.4, pos: [0, 0.3, 0] }));
  group.add(P.box(w, totalH, d, wall, { tile: 3.8, pos: [0, 0.6 + totalH / 2, 0] }));

  if (timber) {
    const beam = M.planks({ tone: '#4b3626', boards: 3 });
    const posts = Math.max(2, Math.round(w / 2.6));
    for (let i = 0; i < posts; i++) {
      const x = (i - (posts - 1) / 2) * (w / posts);
      for (const s of [-1, 1]) group.add(P.box(0.3, totalH, 0.24, beam, { tile: 1.2, pos: [x, 0.6 + totalH / 2, s * (d / 2 + 0.03)] }));
    }
    const sidePosts = Math.max(2, Math.round(d / 2.8));
    for (let i = 0; i < sidePosts; i++) {
      const z = (i - (sidePosts - 1) / 2) * (d / sidePosts);
      for (const s of [-1, 1]) group.add(P.box(0.24, totalH, 0.3, beam, { tile: 1.2, pos: [s * (w / 2 + 0.03), 0.6 + totalH / 2, z] }));
    }
    for (const s of [-1, 1]) group.add(P.box(w + 0.1, 0.34, 0.26, beam, { tile: 1.2, pos: [0, 0.6 + totalH * 0.62, s * (d / 2 + 0.04)] }));
    group.add(P.box(0.26, 0.3, d, beam, { tile: 1.2, pos: [w / 2 + 0.04, 0.6 + totalH * 0.62, 0] }));
    group.add(P.box(0.26, 0.3, d, beam, { tile: 1.2, pos: [-w / 2 - 0.04, 0.6 + totalH * 0.62, 0] }));
  }

  const roofH = rise ?? Math.min(w, d) * 0.42;
  const alongZ = ridgeAlong === 'z';
  const rw = alongZ ? w : d;
  const rd = alongZ ? d : w;
  const roofGeo = P.gableRoofGeometry(rw, rd, roofH, 0.55, alongZ ? 2.6 : 2.6);
  const roof = new THREE.Mesh(roofGeo, roofMat(roofStyle, roofTone));
  if (!alongZ) roof.rotation.y = Math.PI / 2;
  roof.position.y = 0.6 + totalH;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  const ridgeLen = (alongZ ? d : w) + 1.1;
  const cap = alongZ
    ? P.box(0.42, 0.32, ridgeLen, M.stone('dark'), { tile: 1.8, pos: [0, 0.6 + totalH + roofH + 0.12, 0] })
    : P.box(ridgeLen, 0.32, 0.42, M.stone('dark'), { tile: 1.8, pos: [0, 0.6 + totalH + roofH + 0.12, 0] });
  group.add(cap);

  if (alongZ) {
    for (const s of [-1, 1]) {
      const tri = new THREE.Shape();
      tri.moveTo(-w / 2, 0);
      tri.lineTo(w / 2, 0);
      tri.lineTo(0, roofH);
      tri.closePath();
      const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false });
      geo.translate(0, 0, -0.2);
      const mesh = new THREE.Mesh(geo, wall);
      mesh.position.set(0, 0.6 + totalH, s * (d / 2));
      mesh.castShadow = true;
      group.add(mesh);
      group.add(windowUnit({ x: 0, y: 0.6 + totalH + roofH * 0.16, z: s * (d / 2 + 0.22), yaw: s > 0 ? 0 : Math.PI, w: 0.8, h: 0.9, wall }));
    }
  } else {
    for (const s of [-1, 1]) {
      const tri = new THREE.Shape();
      tri.moveTo(-d / 2, 0);
      tri.lineTo(d / 2, 0);
      tri.lineTo(0, roofH);
      tri.closePath();
      const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false });
      geo.translate(0, 0, -0.2);
      const mesh = new THREE.Mesh(geo, wall);
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(s * (w / 2), 0.6 + totalH, 0);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  const paneCount = windows;
  for (let i = 0; i < paneCount; i++) {
    const t = (i + 0.5) / paneCount - 0.5;
    for (const s of [-1, 1]) {
      group.add(windowUnit({
        x: t * w * 0.86,
        y: 0.6 + totalH * (story > 1 ? 0.58 : 0.52),
        z: s * (d / 2 + 0.06),
        yaw: s > 0 ? 0 : Math.PI,
        w: 0.85, h: 1.25, wall,
      }));
    }
  }
  if (story > 1) {
    for (let i = 0; i < paneCount; i++) {
      const t = (i + 0.5) / paneCount - 0.5;
      for (const s of [-1, 1]) {
        group.add(windowUnit({ x: t * w * 0.86, y: 0.6 + totalH * 0.28, z: s * (d / 2 + 0.06), yaw: s > 0 ? 0 : Math.PI, w: 0.8, h: 1.05, wall }));
      }
    }
  }
  if (door) {
    const dr = doorUnit({ w: 1.9, h: 2.7, z: alongZ ? -d / 2 - 0.05 : d / 2 + 0.05, wall });
    dr.rotation.y = alongZ ? Math.PI : 0;
    dr.position.x = alongZ ? 0 : 0;
    group.add(dr);
    group.add(P.box(2.6, 0.24, 1.2, M.stone('warm'), { tile: 1.6, pos: [0, 0.12, (alongZ ? -1 : 1) * (d / 2 + 0.6)] }));
  }
  if (chimney) {
    const cx = (random() - 0.5) * w * 0.4;
    const cz = (random() - 0.5) * d * 0.4;
    group.add(P.box(1.2, roofH + 2.4, 1.2, M.stone('warm'), { tile: 2, pos: [cx, 0.6 + totalH + (roofH + 2.4) / 2 - 0.6, cz] }));
    group.add(P.box(1.45, 0.3, 1.45, M.stone('dark'), { tile: 1.5, pos: [cx, 0.6 + totalH + roofH + 1.9, cz] }));
    const pot = new THREE.Object3D();
    pot.position.set(cx, 0.6 + totalH + roofH + 2.2, cz);
    pot.userData.chimneySmoke = true;
    group.add(pot);
  }
  group.userData.totalH = 0.6 + totalH;
  return group;
}

export function roundHouse({ radius = 5.5, height = 4, roofStyle = 'thatch', roofTone = '#b5924f', wallKind = 'warm', seed = 8 }) {
  const group = new THREE.Group();
  const wall = M.stone(wallKind);
  group.add(P.cyl(radius * 1.04, radius * 1.08, 0.5, 18, M.stone('dark'), { tile: 2.6, pos: [0, 0.25, 0] }));
  group.add(P.cyl(radius, radius, height, 18, wall, { tile: 3.4, pos: [0, 0.5 + height / 2, 0] }));
  const coneH = radius * 1.15;
  const roof = P.cone(radius * 1.2, coneH, 16, roofMat(roofStyle, roofTone), { tile: 2.2, pos: [0, 0.5 + height + coneH / 2 - 0.15, 0] });
  group.add(roof);
  group.add(P.cyl(0.13, 0.13, 1.4, 6, M.planks({ tone: '#5d4630' }), { tile: 1, pos: [0, 0.5 + height + coneH + 0.5, 0] }));
  group.add(windowUnit({ x: 0, y: 0.5 + height * 0.45, z: radius + 0.05, yaw: 0, w: 0.8, h: 1.1, wall }));
  const dr = doorUnit({ w: 1.7, h: 2.3, z: -radius - 0.05, wall });
  dr.rotation.y = Math.PI;
  group.add(dr);
  void seed;
  return group;
}

export function chapel({ w = 11, d = 22, h = 7.6, wallKind = 'cool', roofTone = '#5d4a6b', faction = null }) {
  const group = new THREE.Group();
  const wall = M.stone(wallKind);
  group.add(P.box(w + 0.9, 0.8, d + 0.9, M.stone('dark'), { tile: 3.4, pos: [0, 0.4, 0] }));
  group.add(P.box(w, h, d, wall, { tile: 4, pos: [0, 0.8 + h / 2, 0] }));
  const apseR = w * 0.46;
  const apse = P.cyl(apseR, apseR, h * 0.9, 14, wall, { tile: 3.4, pos: [0, 0.8 + h * 0.45, -d / 2 - apseR * 0.5], open: false });
  group.add(apse);
  const apseRoof = P.cone(apseR * 1.16, apseR * 1.05, 14, M.tiles({ tone: roofTone }), { tile: 2, pos: [0, 0.8 + h * 0.9 + apseR * 0.5, -d / 2 - apseR * 0.5] });
  group.add(apseRoof);

  const rise = w * 0.52;
  const roofGeo = P.gableRoofGeometry(w, d + apseR * 0.6, rise, 0.7, 2.6);
  const roof = new THREE.Mesh(roofGeo, M.tiles({ tone: roofTone }));
  roof.position.y = 0.8 + h;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);
  group.add(P.box(0.5, 0.36, d + 1.4, M.stone('warm'), { tile: 2, pos: [0, 0.8 + h + rise + 0.14, 0] }));

  const buttressCount = 4;
  for (let i = 0; i < buttressCount; i++) {
    const z = -d / 2 + (i + 0.5) * (d / buttressCount);
    for (const s of [-1, 1]) {
      const b = P.box(1.1, h * 0.92, 1.3, M.stone('warm'), { tile: 2.6, pos: [s * (w / 2 + 0.5), 0.8 + h * 0.46, z] });
      group.add(b);
      group.add(P.cone(0.95, 1.3, 4, M.stone('dark'), { tile: 1.6, pos: [s * (w / 2 + 0.5), 0.8 + h * 0.92 + 0.6, z], rot: [0, Math.PI / 4, 0] }));
    }
  }

  for (let i = 0; i < 5; i++) {
    const z = -d / 2 + 2 + i * ((d - 4) / 4);
    for (const s of [-1, 1]) {
      group.add(windowUnit({ x: s * (w / 2 + 0.06), y: 1.6 + h * 0.36, z, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2, w: 1, h: 3, arch: true, wall }));
    }
  }

  const roseMat = M.glow({ color: '#ff9ecb', intensity: 0.35 });
  roseMat.userData.window = true;
  const rose = new THREE.Mesh(new THREE.CircleGeometry(w * 0.26, 18), roseMat);
  rose.position.set(0, 0.8 + h * 0.68, d / 2 + 0.12);
  group.add(rose);
  const roseFrame = new THREE.Mesh(new THREE.TorusGeometry(w * 0.28, 0.16, 6, 20), M.stone('dark'));
  roseFrame.position.set(0, 0.8 + h * 0.68, d / 2 + 0.12);
  group.add(roseFrame);
  const spokes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, w * 0.5, 0.1), M.stone('dark'), 4);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 4; i++) {
    m.compose(new THREE.Vector3(0, 0.8 + h * 0.68, d / 2 + 0.16), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (i / 4) * Math.PI)), new THREE.Vector3(1, 1, 1));
    spokes.setMatrixAt(i, m);
  }
  spokes.instanceMatrix.needsUpdate = true;
  group.add(spokes);

  group.add(doorUnit({ w: 2.6, h: 4, z: d / 2 + 0.1, wall }));

  const towerX = -w * 0.02, towerZ = -d * 0.42;
  const tower = P.cyl(1.9, 2.1, h * 1.5, 8, M.stone(wallKind), { tile: 3, pos: [towerX, h * 0.75 + 0.8, towerZ] });
  group.add(tower);
  const spireH = 6.5;
  group.add(P.cone(2.5, spireH, 8, M.tiles({ tone: roofTone }), { tile: 2, pos: [towerX, 0.8 + h * 1.5 + spireH / 2, towerZ] }));
  group.add(P.cyl(0.09, 0.09, 1.6, 5, M.metal({ color: '#d8bd5c', metalness: 1, roughness: 0.3 }), { tile: 1, pos: [towerX, 0.8 + h * 1.5 + spireH + 0.6, towerZ] }));
  const bellWindow = windowUnit({ x: towerX, y: 0.8 + h * 1.3, z: towerZ + 2.05, yaw: 0, w: 1.1, h: 1.5, arch: true, wall });
  group.add(bellWindow);
  if (faction) {
    const flag = towerFlag({ y: 0.8 + h * 1.5 + spireH + 1.2, faction, pole: 2.6, size: 1.8 });
    flag.position.x = towerX;
    flag.position.z = towerZ;
    group.add(flag);
  }

  const graveGeo = new THREE.BoxGeometry(0.7, 1.1, 0.18);
  boxUV(graveGeo, 1.2);
  const graves = new THREE.InstancedMesh(graveGeo, M.stone('dark'), 7);
  const rnd = T.rng(43);
  for (let i = 0; i < 7; i++) {
    m.compose(
      new THREE.Vector3((rnd() - 0.5) * w * 2.4, 0.45, d / 2 + 3 + rnd() * 7),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.12)),
      new THREE.Vector3(1, 0.8 + rnd() * 0.5, 1),
    );
    graves.setMatrixAt(i, m);
  }
  graves.instanceMatrix.needsUpdate = true;
  graves.castShadow = true;
  group.add(graves);
  return group;
}

export function windmill({ height = 8.5, radius = 3.2, blade = 6.4 }) {
  const group = new THREE.Group();
  const wall = M.stone('warm');
  group.add(P.cyl(radius * 1.06, radius * 1.22, 0.6, 8, M.stone('dark'), { tile: 2.4, pos: [0, 0.3, 0] }));
  group.add(P.cyl(radius * 0.78, radius, height, 8, wall, { tile: 3.4, pos: [0, 0.6 + height / 2, 0] }));
  const capY = 0.6 + height;
  const cap = P.cone(radius * 1.05, radius * 1.15, 8, M.shingles({ tone: '#6b4a30' }), { tile: 2, pos: [0, capY + radius * 0.5, 0] });
  cap.rotation.y = Math.PI / 8;
  group.add(cap);
  const gallery = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.18, 0.14, 5, 20), M.planks({ tone: '#6b5540' }));
  gallery.rotation.x = Math.PI / 2;
  gallery.position.y = capY - 1.6;
  gallery.castShadow = true;
  group.add(gallery);
  group.add(windowUnit({ x: 0, y: capY - 3.4, z: radius + 0.05, yaw: 0, w: 0.8, h: 1.1, wall }));
  group.add(doorUnit({ w: 1.5, h: 2.2, z: radius * 0.92, wall }));

  const hub = new THREE.Group();
  hub.position.set(0, capY + 0.4, radius * 0.95);
  const wood = M.planks({ tone: '#8a6f4d', boards: 3 });
  const metal = M.metal({ color: '#4a453d' });
  hub.add(P.cyl(0.42, 0.42, 0.9, 8, metal, { tile: 1, pos: [0, 0, 0] }).rotateX(Math.PI / 2));
  const blades = 4;
  for (let i = 0; i < blades; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / blades) * Math.PI * 2;
    const spar = P.box(0.26, blade, 0.26, wood, { tile: 1.2, pos: [0, blade / 2, 0.2] });
    arm.add(spar);
    for (let s = 0; s < 4; s++) {
      arm.add(P.box(1.5, 0.14, 0.1, wood, { tile: 1, pos: [0.95, blade * (0.24 + s * 0.2), 0.32], rot: [0, 0, 0.1] }));
    }
    arm.add(P.box(0.12, blade * 0.8, 0.12, wood, { tile: 1, pos: [1.62, blade * 0.6, 0.32] }));
    hub.add(arm);
  }
  group.add(hub);
  const speed = { v: 0.55 };
  onTick((t, dt) => {
    hub.rotation.z += dt * speed.v;
    void t;
  });
  group.userData.speed = speed;
  group.traverse((o) => { if (o.isMesh) o.userData.noMerge = true; });
  return group;
}

export function bridge({ length, width = 8, stone = 'warm' }) {
  const group = new THREE.Group();
  const wall = M.stone(stone);
  const wood = M.planks({ tone: '#6f5339', boards: 4 });
  const deckSegments = Math.max(6, Math.round(length / 1.5));
  const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.22, length / deckSegments * 0.94), wood, deckSegments);
  boxUV(deck.geometry, 1.6);
  const m = new THREE.Matrix4();
  for (let i = 0; i < deckSegments; i++) {
    const z = -length / 2 + (i + 0.5) * (length / deckSegments);
    const sag = Math.sin((i / deckSegments) * Math.PI) * 0.16;
    m.compose(new THREE.Vector3(0, 0.55 + sag, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    deck.setMatrixAt(i, m);
  }
  deck.instanceMatrix.needsUpdate = true;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  for (const s of [-1, 1]) {
    group.add(P.box(0.5, 0.5, length, wall, { tile: 2.4, pos: [s * (width / 2 - 0.2), 0.3, 0] }));
    const posts = Math.max(2, Math.round(length / 3));
    for (let i = 0; i < posts; i++) {
      const z = -length / 2 + (i + 0.5) * (length / posts);
      group.add(P.box(0.3, 1.2, 0.3, wood, { tile: 1.2, pos: [s * (width / 2 - 0.2), 1.15, z] }));
      group.add(P.box(0.18, 0.18, length / posts, wood, { tile: 1.2, pos: [s * (width / 2 - 0.2), 1.7, z] }));
    }
    for (let i = 0; i < 3; i++) {
      const lamp = P.flame({ size: 0.55, y: 1.5 });
      lamp.position.set(s * (width / 2 - 0.2), 1.7, -length / 2 + (i + 0.5) * (length / 3));
      group.add(lamp);
      onTick((t) => P.updateFlame(lamp, t));
    }
  }
  const archPiers = 2;
  for (let i = 0; i < archPiers; i++) {
    const z = (i - (archPiers - 1) / 2) * (length * 0.55);
    const pier = P.box(width * 0.9, 5, 1.6, M.stone('dark'), { tile: 3, pos: [0, -1.9, z] });
    group.add(pier);
    const cut = P.cyl(1.6, 1.6, width * 0.95, 12, M.stone('dark'), { tile: 2, pos: [0, -0.6, z] });
    cut.rotation.z = Math.PI / 2;
    group.add(cut);
  }
  return group;
}

export function drawbridge({ width = 8, length = 12, up = false }) {
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#5f4630', boards: 5 });
  const plankCount = Math.max(5, Math.round(length / 1.1));
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.24, length / plankCount * 0.9), wood, plankCount);
  boxUV(planks.geometry, 1.4);
  const m = new THREE.Matrix4();
  for (let i = 0; i < plankCount; i++) {
    m.compose(new THREE.Vector3(0, 0, length * 0.02 + i * (length / plankCount)), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    planks.setMatrixAt(i, m);
  }
  planks.instanceMatrix.needsUpdate = true;
  planks.castShadow = true;
  group.add(planks);
  for (const s of [-1, 1]) {
    group.add(P.box(0.3, 0.3, length, wood, { tile: 1.2, pos: [s * (width / 2 - 0.2), 0.22, length / 2] }));
    group.add(P.box(0.3, 0.3, length * 0.7, wood, { tile: 1.2, pos: [s * (width / 2 - 0.6), 0.22, length / 2] }));
  }
  const ropes = new THREE.Group();
  for (const s of [-1, 1]) {
    const rope = P.cyl(0.09, 0.09, length * 1.25, 5, M.planks({ tone: '#c7b184', boards: 2 }), { tile: 1, pos: [s * (width / 2 - 0.4), length * 0.5, length * 0.35] });
    rope.rotation.x = Math.PI / 2 - 0.62;
    ropes.add(rope);
  }
  group.add(ropes);
  const state = { angle: up ? 1.15 : 0, target: up ? 1.15 : 0 };
  onTick((t, dt) => {
    state.angle += (state.target - state.angle) * (1 - Math.exp(-2.4 * dt));
    group.rotation.x = -state.angle;
    void t;
  });
  group.userData.state = state;
  group.userData.setRaised = (raised) => { state.target = raised ? 1.15 : 0; };
  group.traverse((o) => { if (o.isMesh) o.userData.noMerge = true; });
  return group;
}

export function palisade({ length, height = 3.4, spacing = 0.62, seed = 4 }) {
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#7a5f42', boards: 3 });
  const count = Math.max(4, Math.round(length / spacing));
  const geo = new THREE.CylinderGeometry(0.24, 0.28, height, 6);
  scaleUV(geo, 1.6, height / 1.6);
  const mesh = new THREE.InstancedMesh(geo, wood, count);
  const m = new THREE.Matrix4(), random = T.rng(seed);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    p.set((i - (count - 1) / 2) * spacing, height / 2, 0);
    q.setFromAxisAngle(P.UP, random() * 0.2 - 0.1);
    s.set(1, 0.94 + random() * 0.14, 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  for (const y of [height * 0.35, height * 0.75]) group.add(P.box(length, 0.18, 0.16, wood, { tile: 1.2, pos: [0, y, -0.3] }));
  return group;
}

export function staircase({ steps = 12, width = 2.4, rise = 0.32, mat = null, dir = 1 }) {
  const geo = new THREE.BoxGeometry(width, rise, 0.55);
  const mesh = new THREE.InstancedMesh(geo, mat || M.stone('warm'), steps);
  const m = new THREE.Matrix4();
  for (let i = 0; i < steps; i++) {
    m.compose(new THREE.Vector3(0, rise * (i + 0.5), dir * i * 0.55), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
