import * as THREE from 'three';
import * as T from './textures.js';
import * as M from './materials.js';
import * as P from './parts.js';
import * as B from './buildings.js';
import { onTick } from './runtime.js';

export const FACTIONS = [
  { id: 'falcon', name: 'Орден Сокола', base: '#2f6fb2', accent: '#e9e3d0', gilt: '#d8bd5c', motif: 'chevron' },
  { id: 'greymark', name: 'Дом Греймарк', base: '#8d2f3a', accent: '#e7c98a', gilt: '#e7c98a', motif: 'lion' },
  { id: 'woodwatch', name: 'Лесная стража', base: '#2f7a52', accent: '#dfe8d2', gilt: '#c9cf9a', motif: 'star' },
  { id: 'whitetower', name: 'Белая Башня', base: '#cdd5dd', accent: '#3a4b7a', gilt: '#d8bd5c', motif: 'cross' },
];

const pick = (random, list) => list[Math.floor(random() * list.length)];

export function makeConfig(seed) {
  const random = T.rng(seed);
  const wallHalf = 33 + Math.round(random() * 6);
  const faction = FACTIONS[Math.floor(random() * FACTIONS.length)];
  const site = {
    plainY: 0,
    waterY: -0.75,
    moatBottomY: -3.6,
    cragTopY: 3.2,
    wallHalf,
    cragHalf: wallHalf + 1.2,
    moatWidth: 11 + random() * 5,
  };
  site.moatOuterHalf = site.cragHalf + site.moatWidth;
  return {
    seed,
    faction,
    site,
    wallHeight: 8.4 + random() * 2.2,
    wallThickness: 3 + random() * 0.7,
    cornerTowerRadius: 6 + random() * 1.8,
    midTowerRadius: 4.6 + random() * 1.2,
    midTowers: random() > 0.35,
    hoardings: random() > 0.45,
    stoneKind: pick(random, ['grey', 'warm', 'cool']),
    roofStyle: pick(random, ['tile', 'shingle', 'thatch']),
    roofTone: pick(random, ['#3f6a6e', '#8a4b36', '#5d4a6b', '#6b7d55', '#7d3f2f']),
    keepStyle: random() > 0.42 ? 'square' : 'round',
    keepHeight: 21 + random() * 7,
    turrets: random() > 0.5 ? 4 : 2,
    garden: random() > 0.4,
    market: random() > 0.35,
    villageHouses: 4 + Math.floor(random() * 5),
    forestDensity: 120 + Math.floor(random() * 140),
    hillTone: pick(random, ['green', 'moor', 'autumn']),
  };
}

function factionBanner(faction) {
  const mat = M.bannerMaterial({ base: faction.base, accent: faction.accent, motif: faction.motif, seed: faction.id.length * 13 });
  return { ...faction, mat };
}

function placeWallRun(parent, from, to, center, opts) {
  const dir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  const length = dir.length();
  const wall = B.curtainWall({ length, ...opts });
  const mid = new THREE.Vector3((from.x + to.x) / 2, 0, (from.z + to.z) / 2);
  const outward = mid.clone().sub(center).setY(0).normalize();
  let yaw = -Math.atan2(dir.z, dir.x);
  const localZ = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  if (localZ.dot(outward) < 0) yaw += Math.PI;
  wall.rotation.y = yaw;
  wall.position.copy(mid);
  parent.add(wall);
  return wall;
}

export function buildFortress(cfg) {
  const group = new THREE.Group();
  const random = T.rng(cfg.seed + 101);
  const faction = factionBanner(cfg.faction);
  const y = cfg.site.cragTopY;
  const H = cfg.site.wallHalf;
  const center = new THREE.Vector3(0, 0, 0);
  const gateHalf = 6.2;
  const deck = y + 1.5 + cfg.wallHeight;

  const wallOpts = {
    height: cfg.wallHeight,
    thickness: cfg.wallThickness,
    stone: cfg.stoneKind,
    torches: 0,
  };

  placeWallRun(group, { x: -H, z: -H }, { x: H, z: -H }, center, { ...wallOpts, seed: 1, hoarding: cfg.hoardings && random() > 0.5 });
  placeWallRun(group, { x: H, z: -H }, { x: H, z: H }, center, { ...wallOpts, seed: 2, torches: 2 });
  placeWallRun(group, { x: H, z: H }, { x: gateHalf, z: H }, center, { ...wallOpts, seed: 3 });
  placeWallRun(group, { x: -gateHalf, z: H }, { x: -H, z: H }, center, { ...wallOpts, seed: 4, hoarding: cfg.hoardings && random() > 0.5, torches: 2 });
  placeWallRun(group, { x: -H, z: H }, { x: -H, z: -H }, center, { ...wallOpts, seed: 5 });

  const corners = [[-H, -H], [H, -H], [H, H], [-H, H]];
  corners.forEach(([x0, z0], i) => {
    const tower = B.roundTower({
      radius: cfg.cornerTowerRadius,
      height: cfg.wallHeight + 5 + random() * 3,
      stone: cfg.stoneKind,
      roof: i === 0 || i === 2 ? 'cone' : 'battlement',
      roofStyle: cfg.roofStyle,
      roofTone: cfg.roofTone,
      faction,
      levels: 2,
      seed: 10 + i,
    });
    tower.position.set(x0, y, z0);
    group.add(tower);
  });

  if (cfg.midTowers) {
    for (const [x0, z0] of [[0, -H], [H, 0], [-H, 0]]) {
      const tower = B.roundTower({
        radius: cfg.midTowerRadius,
        height: cfg.wallHeight + 2.5,
        stone: cfg.stoneKind,
        roof: 'cone',
        roofStyle: cfg.roofStyle,
        roofTone: cfg.roofTone,
        levels: 1,
        seed: 40 + x0 + z0,
      });
      tower.position.set(x0, y, z0);
      group.add(tower);
    }
  }

  const gate = B.gatehouse({
    height: cfg.wallHeight + 2.4,
    opening: 8.6,
    towerRadius: 5.8,
    stone: cfg.stoneKind,
    faction,
    roofStyle: cfg.roofStyle,
    roofTone: cfg.roofTone,
    wallThickness: cfg.wallThickness,
  });
  gate.position.set(0, y, H);
  group.add(gate);

  const keep = cfg.keepStyle === 'square'
    ? B.keep({ w: 17, d: 15, height: cfg.keepHeight, stone: cfg.stoneKind, faction, roofStyle: cfg.roofStyle, roofTone: cfg.roofTone, turrets: cfg.turrets })
    : B.roundTower({ radius: 10.5, height: cfg.keepHeight, stone: cfg.stoneKind, roof: 'battlement', roofStyle: cfg.roofStyle, roofTone: cfg.roofTone, faction, levels: 3, seed: 91 });
  keep.position.set(-2, y, -3);
  group.add(keep);

  const courtyard = new THREE.Group();
  group.add(courtyard);
  const slotY = y;
  const put = (obj, x, z, ry = 0) => {
    obj.position.set(x, slotY, z);
    obj.rotation.y = ry;
    courtyard.add(obj);
    return obj;
  };

  const houseWall = cfg.stoneKind === 'cool' ? 'warm' : cfg.stoneKind;
  put(B.house({ w: 22, d: 10, h: 5.2, wallKind: houseWall, roofStyle: cfg.roofStyle, roofTone: cfg.roofTone, ridgeAlong: 'x', timber: true, chimney: true, windows: 4, seed: 12 }), -22, 20, 0.05);
  put(B.house({ w: 12, d: 9, h: 4.6, wallKind: houseWall, roofStyle: 'thatch', roofTone: '#b5924f', ridgeAlong: 'z', timber: true, chimney: true, windows: 2, seed: 14 }), -25, -20, Math.PI / 2);
  put(B.house({ w: 17, d: 10, h: 5.6, wallKind: houseWall, roofStyle: cfg.roofStyle, roofTone: cfg.roofTone, ridgeAlong: 'x', story: 2, windows: 4, chimney: true, seed: 16, timber: random() > 0.5 }), 24, -22, -0.04);
  put(B.chapel({ w: 11, d: 21, wallKind: 'cool', roofTone: cfg.roofTone, faction }), 24, 8, Math.PI / 2);
  put(B.roundHouse({ radius: 5.4, height: 4.4, roofStyle: 'thatch', roofTone: '#c3a05c', wallKind: houseWall }, ), 10, 25);

  const forge = put(B.house({ w: 9, d: 8, h: 4.2, wallKind: 'dark', roofStyle: cfg.roofStyle, roofTone: cfg.roofTone, ridgeAlong: 'z', chimney: true, windows: 1, seed: 18 }), -24, -2, Math.PI / 2);
  const anvil = P.box(0.9, 0.7, 0.5, M.metal({ color: '#3d4147', metalness: 0.9, roughness: 0.35 }), { tile: 1, pos: [0, 0.35, 0] });
  anvil.position.set(-19, y + 0.35, 3);
  courtyard.add(anvil);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(1.5, 12), M.glow({ color: '#ff5a1e', intensity: 1.2 }));
  coals.rotation.x = -Math.PI / 2;
  coals.position.set(-19, y + 0.06, 5.2);
  coals.material.userData.window = true;
  courtyard.add(coals);
  const forgeLight = new THREE.PointLight('#ff6a22', 20, 20, 2);
  forgeLight.position.set(-19, y + 1.2, 5.2);
  courtyard.add(forgeLight);
  const forgeFlame = P.flame({ size: 1.1, y: 0.2 });
  forgeFlame.position.set(-19, y + 0.4, 5.2);
  courtyard.add(forgeFlame);
  onTick((t) => {
    P.updateFlame(forgeFlame, t);
    forgeLight.intensity = 16 + Math.sin(t * 9) * 4 + Math.sin(t * 21) * 2;
  });
  void forge;

  put(P.wellHouse(), 12, -6);
  put(P.stable(), -6, -15, Math.PI / 2);
  put(P.granary(), 31, 24, -0.35);
  put(P.dovecote(), -31, 27);
  put(B.staircase({ steps: 16, width: 2.6, rise: 0.42 }), -H + 5.5, H - 7, Math.PI);
  put(B.staircase({ steps: 16, width: 2.6, rise: 0.42 }), H - 5.5, -H + 7, 0);
  for (const [x, z, ry, len] of [[0, H - 2.4, 0, 26], [0, -H + 2.4, Math.PI, 26], [-H + 2.4, 0, Math.PI / 2, 26], [H - 2.4, 0, -Math.PI / 2, 26]]) {
    put(P.shieldRow({ length: len, y: 3.4, count: 7, faction }), x, z, ry);
  }
  const spearStack = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    spearStack.add(P.cyl(0.05, 0.05, 3.4, 5, M.planks({ tone: '#6b5334' }), { tile: 0.6, pos: [Math.cos(a) * 0.3, 1.7, Math.sin(a) * 0.3], rot: [Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12] }));
    spearStack.add(P.cone(0.09, 0.4, 5, M.metal({ color: '#b9bec4', metalness: 1, roughness: 0.3 }), { tile: 0.4, pos: [Math.cos(a) * 0.34, 3.5, Math.sin(a) * 0.34] }));
  }
  put(spearStack, 4, 8);
  const quintainA = put(P.quintain({ seed: 3 }), 2, -26);
  const quintainB = put(P.quintain({ seed: 9 }), 11, -27);
  for (const q of [quintainA, quintainB]) {
    onTick((t) => {
      if (q.userData.arm) q.userData.arm.rotation.z = Math.sin(t * 1.3 + q.userData.seed) * 0.22;
    });
  }
  if (cfg.market) {
    put(P.marketStall({ seed: 21, canopy: '#b8433f' }), -6, 24, 0.1);
    put(P.marketStall({ seed: 24, canopy: '#3f7a8c' }), -1, 27.5, -0.25);
    put(P.marketStall({ seed: 27, canopy: '#7a8c3f' }), 3.5, 24.5, 0.2);
    for (let i = 0; i < 4; i++) {
      const b = P.barrel();
      b.position.set(-9 + random() * 2, y + 0.05, 21 + random() * 3);
      courtyard.add(b);
    }
  }
  if (cfg.garden) {
    const gardenX = -10, gardenZ = 12;
    for (let i = 0; i < 3; i++) {
      const bed = P.box(6, 0.34, 1.8, M.ground({ tone: 'path' }), { tile: 1.6, pos: [gardenX, y + 0.17, gardenZ + i * 2.4], cast: false });
      courtyard.add(bed);
      const crops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 0.9, 4), M.foliage({ color: '#5f9a3f' }), 9);
      const mm = new THREE.Matrix4();
      for (let c = 0; c < 9; c++) {
        mm.compose(new THREE.Vector3(gardenX - 2.6 + c * 0.65, y + 0.75, gardenZ + i * 2.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 3, 0)), new THREE.Vector3(1, 0.8 + random() * 0.6, 1));
        crops.setMatrixAt(c, mm);
      }
      crops.instanceMatrix.needsUpdate = true;
      crops.castShadow = true;
      courtyard.add(crops);
    }
    const fence = P.fenceLine({ length: 8, spacing: 1.6, height: 1.1 });
    fence.position.set(gardenX, y, gardenZ - 1.5);
    courtyard.add(fence);
    const fence2 = P.fenceLine({ length: 8, spacing: 1.6, height: 1.1 });
    fence2.position.set(gardenX, y, gardenZ + 6);
    courtyard.add(fence2);
  }

  for (let i = 0; i < 6; i++) {
    const crate = P.crate(0.9 + random() * 0.5);
    crate.position.set(-28 + random() * 3, y + 0.02, 12 + random() * 8);
    crate.rotation.y = random() * 3;
    courtyard.add(crate);
  }
  for (const [x, z, ry] of [[31, 26, 0.4], [33, 20, -0.3], [28, -6, 1.2]]) {
    const cart = P.cart({ seed: x });
    cart.position.set(x, y, z);
    cart.rotation.y = ry;
    courtyard.add(cart);
  }
  for (const [x, z] of [[-30, 8], [-31, -10], [17, 12]]) {
    const t = P.treeOak({ scale: 0.85, seed: Math.round(x + z) });
    t.position.set(x, y, z);
    courtyard.add(t);
  }

  const wallPath = [
    new THREE.Vector3(-H, deck + 0.35, -H),
    new THREE.Vector3(H, deck + 0.35, -H),
    new THREE.Vector3(H, deck + 0.35, H),
    new THREE.Vector3(-H, deck + 0.35, H),
  ];
  const courtyardPath = [
    new THREE.Vector3(-16, y + 0.05, 16),
    new THREE.Vector3(16, y + 0.05, 16),
    new THREE.Vector3(16, y + 0.05, -18),
    new THREE.Vector3(-16, y + 0.05, -18),
  ];

  const approach = new THREE.Group();
  const moatZ = cfg.site.moatOuterHalf;
  const gateFaceZ = H + 3.7;
  const farBankZ = cfg.site.cragHalf + cfg.site.moatWidth;
  const drawLen = 6.5;
  const staticLen = Math.max(4, farBankZ - (gateFaceZ + drawLen) + 3);
  const span = B.drawbridge({ width: 7.4, length: drawLen });
  span.position.set(0, y + 0.05, gateFaceZ);
  approach.add(span);

  const bridge = B.bridge({ length: staticLen, width: 7.4, stone: cfg.stoneKind });
  bridge.position.set(0, cfg.site.plainY + 0.1, gateFaceZ + drawLen + staticLen / 2 - 3);
  approach.add(bridge);

  const roadStart = farBankZ + 1;
  const road = P.box(8.5, 0.14, 40, M.ground({ tone: 'path' }), { tile: 4, pos: [0, cfg.site.plainY + 0.09, roadStart + 20], cast: false });
  approach.add(road);
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1;
    const post = P.cyl(0.16, 0.2, 4.2, 6, M.planks({ tone: '#6b5540' }), { tile: 1.2, pos: [side * 5.6, cfg.site.plainY + 2.1, roadStart + 4 + i * 9] });
    approach.add(post);
    const lamp = P.flame({ size: 0.7, y: 4.1 });
    lamp.position.set(side * 5.6, cfg.site.plainY + 4.3, roadStart + 4 + i * 9);
    approach.add(lamp);
    onTick((t) => P.updateFlame(lamp, t));
    if (i < 2) {
      const light = new THREE.PointLight('#ff9b3e', 9, 16, 2);
      light.position.copy(lamp.position);
      approach.add(light);
    }
  }
  approach.add(P.box(3.4, 0.24, 0.24, M.planks({ tone: '#7c6044' }), { tile: 1.2, pos: [4.6, cfg.site.plainY + 1.6, farBankZ + 2] }));
  for (const x of [2.9, 6.3]) approach.add(P.cyl(0.18, 0.22, 3.2, 6, M.planks({ tone: '#5f4a34' }), { tile: 1, pos: [x, cfg.site.plainY + 1.6, farBankZ + 2] }));
  for (let i = 0; i < 5; i++) {
    const hut = B.house({
      w: 7 + random() * 3,
      d: 6 + random() * 3,
      h: 3.4 + random() * 0.8,
      wallKind: 'warm',
      roofStyle: 'thatch',
      roofTone: pick(random, ['#c3a05c', '#b5924f', '#a8894a']),
      ridgeAlong: random() > 0.5 ? 'x' : 'z',
      timber: true,
      chimney: true,
      windows: 2,
      seed: 60 + i,
    });
    const side = i % 2 ? 1 : -1;
    hut.position.set(side * (12 + random() * 12), cfg.site.plainY, moatZ + 14 + i * 11 + random() * 4);
    hut.rotation.y = (random() - 0.5) * 0.7;
    approach.add(hut);
  }
  const mill = B.windmill({ height: 9, radius: 3.4, blade: 6.8 });
  mill.position.set(-26, cfg.site.plainY, moatZ + 26);
  mill.rotation.y = 0.7;
  approach.add(mill);
  group.add(approach);

  const outerPath = [
    new THREE.Vector3(0, cfg.site.plainY + 0.05, moatZ + 30),
    new THREE.Vector3(14, cfg.site.plainY + 0.05, moatZ + 20),
    new THREE.Vector3(6, cfg.site.plainY + 0.05, moatZ + 6),
    new THREE.Vector3(-8, cfg.site.plainY + 0.05, moatZ + 18),
  ];

  return {
    group,
    faction,
    gate,
    keep,
    deck,
    paths: { wallPath, courtyardPath, outerPath },
    stats: { towerCount: corners.length + (cfg.midTowers ? 3 : 0) + 2 },
    setBridge(raised) {
      span.userData.setRaised(raised);
    },
    setGate(raised) {
      gate.userData.liftPortcullis(raised ? 1 : 0);
    },
  };
}
