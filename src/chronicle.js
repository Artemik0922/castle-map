import * as THREE from 'three';
import * as T from './textures.js';
import * as M from './materials.js';
import * as P from './parts.js';
import * as B from './buildings.js';
import { onTick } from './runtime.js';
import {
  mergeStatic, buildCapGeometry, applyPlanarUV, roundedRectRing,
} from './geometry.js';

const { clamp } = THREE.MathUtils;

export const SEASONS = ['зима', 'весна', 'лето', 'осень'];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const FOUNDING = 1090;

/**
 * The chronicle: a deterministic queue of building projects spread over the
 * decades, revealed one by one as the simulated calendar passes their year.
 * Each plot is built lazily and merged into its own batch, so growth costs one
 * visibility flip per project and the frame rate never drifts downward.
 */
export function createChronicle(cfg, L, world, barracks, terrainMaterial) {
  const group = new THREE.Group();
  const random = T.rng(cfg.seed + 5150);
  const plan = planProjects(cfg, L, random);
  const revealed = [];
  let cursor = 0;
  let yearDay = 0;
  let year = 1;
  let season = 2;
  const listeners = [];
  const stats = { dwellings: 0, people: 0, fields: 0, hectares: 0, herds: 0, garrison: 0, works: 0 };

  const clock = {
    year,
    day: 1,
    dayOfYear: 0,
    speed: 1,
    paused: false,
    season: SEASONS[season],
    seasonT: 0,
  };

  const y = (x, z) => L.groundY(x, z);

  function emit(kind, text) {
    for (const cb of listeners) cb(kind, text, { year: FOUNDING + year, stats: { ...stats } });
  }

  /* ------------------------------------------------------------- calendar */
  function advance(dt) {
    if (clock.paused) return;
    // speed 1 = one game year per real day; 365 = one game year per minute.
    const daysPerSecond = (365 / 86400) * clock.speed;
    yearDay += dt * daysPerSecond;
    while (yearDay >= 365) {
      yearDay -= 365;
      year += 1;
      clock.year = year;
    }
    let acc = yearDay;
    let month = 0;
    while (month < 11 && acc > DAYS[month]) {
      acc -= DAYS[month];
      month += 1;
    }
    clock.day = Math.min(DAYS[month], Math.floor(acc) + 1);
    clock.dayOfYear = yearDay;
    const nextSeason = month < 2 ? 0 : month < 5 ? 1 : month < 8 ? 2 : month < 11 ? 3 : 0;
    if (nextSeason !== season) {
      season = nextSeason;
      applySeason(season);
      emit('season', `Начало ${['зимы', 'весны', 'лета', 'осени'][season]}`);
    }
    clock.season = SEASONS[season];
    clock.seasonT = clamp((yearDay - (season === 0 ? 304 : season === 1 ? 59 : season === 2 ? 152 : 244)) / 90, 0, 1);

    while (cursor < plan.length && plan[cursor].year <= year) {
      reveal(plan[cursor++]);
    }
    militaryTick(dt);
  }

  /* ------------------------------------------------------------ military */
  let drillTimer = 0;
  function militaryTick(dt) {
    if (!barracks) return;
    drillTimer += dt * clock.speed;
    if (drillTimer > 260) {
      drillTimer = 0;
      barracks.volley();
      if (year > 24) barracks.fireGuns();
    }
  }

  /* -------------------------------------------------------------- reveals */
  function reveal(project) {
    const node = buildPlot(project, cfg, L, random);
    if (!node) return;
    node.position.set(project.x, y(project.x, project.z), project.z);
    node.rotation.y = project.ry;
    node.userData.pop = 0;
    mergeStatic(node, node);
    group.add(node);
    revealed.push(node);
    for (const key of Object.keys(project.grows || {})) stats[key] += project.grows[key];
    emit('build', project.label);
    syncStats();
  }

  function syncStats() {
    stats.people = Math.round(stats.dwellings * 4.6 + stats.garrison * 1.15);
    stats.hectares = +(stats.fields * 0.62).toFixed(1);
  }

  function update(dt) {
    advance(dt);
    for (const node of revealed) {
      if (node.userData.pop >= 1) continue;
      node.userData.pop = Math.min(1, node.userData.pop + dt * 1.8);
      const k = node.userData.pop;
      const s = 0.55 + 0.45 * (1 - Math.pow(1 - k, 3));
      node.scale.set(s, s, s);
      node.position.y = y(node.position.x, node.position.z) - (1 - k) * 1.6;
    }
  }

  function fastForward(targetYear) {
    while (year < targetYear && cursor < plan.length) {
      year += 1;
      clock.year = year;
      while (cursor < plan.length && plan[cursor].year <= year) reveal(plan[cursor++]);
    }
  }

  /* ------------------------------------------------------------- seasons */
  const tinted = {
    foliage: [M.foliage({ color: '#2f5f34' }), M.foliage({ color: '#4c7d38' }), M.foliage({ color: '#54783c' }), M.foliage({ color: '#ffffff' }), M.foliage({ color: '#6f8a42' }), M.foliage({ color: '#7a9a4a' })],
    baseline: null,
  };
  tinted.baseline = tinted.foliage.map((m) => m.color.clone());

  function applySeason(which) {
    const palette = [
      [0.86, 0.95, 1.06],
      [0.92, 1.06, 0.94],
      [1, 1, 1],
      [1.06, 0.92, 0.66],
    ][which];
    for (let i = 0; i < tinted.foliage.length; i++) {
      const base = tinted.baseline[i];
      tinted.foliage[i].color.setRGB(base.r * palette[0], base.g * palette[1], base.b * palette[2]);
    }
    if (terrainMaterial) {
      terrainMaterial.color.setRGB(palette[0], palette[1], palette[2]);
    }
    M.ground({ tone: 'path' }).color.setScalar(which === 0 ? 1.12 : 1);
  }

  applySeason(season);

  return {
    group,
    stats,
    clock,
    plan,
    update,
    fastForward,
    onEvent(cb) {
      listeners.push(cb);
    },
    setSpeed(v) {
      clock.speed = clamp(v, 0, 4000);
    },
    setPaused(v) {
      clock.paused = !!v;
    },
    counts: () => ({ revealed: revealed.length, pending: plan.length - cursor }),
  };
}

/* ------------------------------------------------------------- the plan */

function planProjects(cfg, L, random) {
  const taken = [];
  const projects = [];
  const sectors = [
    { name: 'посад', cx: L.town.cx, cz: L.town.cz, r0: 78, r1: 118, kinds: ['house', 'house', 'workshop', 'tenement', 'pen'] },
    { name: 'выгон', cx: L.pasture.cx - 26, cz: L.pasture.cz + 30, r0: 26, r1: 62, kinds: ['field', 'field', 'pen', 'orchard'] },
    { name: 'нива', cx: L.town.cx + 168, cz: L.town.cz + 4, r0: 40, r1: 92, kinds: ['field', 'field', 'orchard', 'kiln'] },
    { name: 'верфь', cx: L.docks.cx + 26, cz: L.docks.cz - 6, r0: 18, r1: 46, kinds: ['wharf', 'house', 'workshop'] },
    { name: 'гарнизон', cx: L.garrison.cx + 6, cz: L.garrison.cz - 40, r0: 14, r1: 34, kinds: ['barracksWing', 'well', 'windmill'] },
    { name: 'предместье', cx: L.town.cx - 96, cz: L.town.cz + 62, r0: 22, r1: 56, kinds: ['chapel', 'house', 'field', 'windmill'] },
    { name: 'запрудье', cx: L.town.cx + 20, cz: L.river.centerZ(20) - 44, r0: 16, r1: 40, kinds: ['wharf', 'house', 'workshop', 'pen'] },
    { name: 'сад-горка', cx: L.orchard.cx - 34, cz: L.orchard.cz + 22, r0: 16, r1: 40, kinds: ['orchard', 'house', 'well', 'field'] },
  ];

  for (const sector of sectors) {
    const per = Math.round(34 + random() * 14);
    for (let i = 0; i < per; i++) {
      const a = random() * Math.PI * 2;
      const r = sector.r0 + random() * (sector.r1 - sector.r0);
      const x = sector.cx + Math.cos(a) * r * 1.25;
      const z = sector.cz + Math.sin(a) * r;
      if (!spotFree(L, x, z, taken)) continue;
      taken.push({ x, z });
      const kind = sector.kinds[Math.floor(random() * sector.kinds.length)];
      const year = 1 + Math.floor(random() * 62);
      projects.push(makeProject(kind, sector.name, x, z, year, random));
    }
  }
  projects.sort((a, b) => a.year - b.year || a.x - b.x);
  for (let i = 0; i < Math.min(3, projects.length); i++) projects[i].year = 1;
  return projects;
}

function spotFree(L, x, z, taken) {
  if (Math.abs(x) > 300 || Math.abs(z) > 320) return false;
  if (L.isBuilt(x, z)) return false;
  if (L.roadDist(x, z) < 8) return false;
  if (L.riverDist(x, z) < 26) return false;
  if (Math.hypot(x, z) < L.site.moatOuterHalf + 14) return false;
  const gy = L.groundY(x, z);
  if (gy > 14 || gy < -0.4) return false;
  for (const t of taken) {
    if (Math.hypot(t.x - x, t.z - z) < 14) return false;
  }
  return true;
}

const GROWS = {
  house: { dwellings: 1 },
  tenement: { dwellings: 3 },
  workshop: { dwellings: 1, works: 1 },
  pen: { herds: 6 },
  field: { fields: 1 },
  orchard: { fields: 1, works: 1 },
  kiln: { works: 2 },
  wharf: { works: 2 },
  chapel: { dwellings: 1, works: 1 },
  well: { works: 1 },
  windmill: { works: 1 },
  barracksWing: { garrison: 28 },
};

function makeProject(kind, sector, x, z, year, random) {
  const label = {
    house: 'Новый двор',
    tenement: 'Двухэтажный дом',
    workshop: 'Мастерская у дороги',
    pen: 'Загон для скота',
    field: 'Распахована новая нива',
    orchard: 'Заложен сад',
    kiln: 'Поставлена известковая печь',
    wharf: 'Наращена пристань',
    chapel: 'Освящена часовня',
    well: 'Вырублен колодец',
    windmill: 'Поднят ветряк',
    barracksWing: 'Новый флигель казармы',
  }[kind] || `Стройка: ${kind}`;
  return {
    kind,
    sector,
    x,
    z,
    year,
    ry: (random() - 0.5) * 0.7,
    label: `${sector}: ${label.toLowerCase()}`,
    grows: GROWS[kind] || {},
  };
}

/* ------------------------------------------------------------- plot types */

function buildPlot(project, cfg, L, random) {
  const g = new THREE.Group();
  const stone = cfg.stoneKind;
  const kind = project.kind;

  const place = (obj, x, z, ry = 0) => {
    obj.position.set(x, L.groundY(x, z), z);
    obj.rotation.y = ry;
    g.add(obj);
    return obj;
  };

  if (kind === 'house' || kind === 'tenement' || kind === 'workshop') {
    const tall = kind === 'tenement';
    const house = B.house({
      w: 8 + random() * 4,
      d: 6 + random() * 4,
      h: tall ? 6.2 : 4.2,
      wallKind: random() > 0.5 ? 'warm' : 'cool',
      roofStyle: kind === 'workshop' ? 'shingle' : cfg.roofStyle,
      roofTone: kind === 'workshop' ? '#4b6168' : cfg.roofTone,
      ridgeAlong: random() > 0.5 ? 'x' : 'z',
      timber: random() > 0.3,
      chimney: true,
      windows: 2 + (tall ? 2 : 0),
      story: tall ? 2 : 1,
      seed: Math.round(project.x * 7 + project.z),
    });
    place(house, 0, 0);
    const yard = new THREE.Group();
    yard.add(P.fenceLine({ length: 11, spacing: 1.9, height: 1.2 }));
    const fence2 = P.fenceLine({ length: 9, spacing: 1.9, height: 1.2 });
    fence2.rotation.y = Math.PI / 2;
    fence2.position.set(5.4, 0, 0);
    yard.add(fence2);
    g.add(yard);
    if (kind === 'workshop') {
      const lean = new THREE.Group();
      lean.add(P.box(5, 0.2, 3.4, M.planks({ tone: '#6b5540' }), { tile: 1.4, pos: [0, 2.2, 0], rot: [-0.22, 0, 0] }));
      for (const s of [-2.1, 2.1]) lean.add(P.cyl(0.1, 0.12, 2.2, 5, M.planks({ tone: '#5b4630' }), { tile: 0.8, pos: [s, 1.1, 1.2] }));
      lean.add(P.box(2.4, 0.9, 1.2, M.stone('dark'), { tile: 1.2, pos: [0, 0.45, -0.4] }));
      place(lean, 4.5, 4, 0.3);
    }
  } else if (kind === 'field' || kind === 'orchard') {
    const hx = 15 + random() * 5;
    const hz = 13 + random() * 4;
    const cap = buildCapGeometry(roundedRectRing(hx, hz, 4, 4), 0.06);
    applyPlanarUV(cap, 6);
    const soil = new THREE.Mesh(cap, new THREE.MeshStandardMaterial({
      map: M.ground({ tone: 'path' }).map,
      color: kind === 'orchard' ? '#5f7a3f' : '#8a7a3f',
      roughness: 1,
    }));
    soil.receiveShadow = true;
    soil.userData.noMerge = true;
    g.add(soil);
    const rows = 11;
    const cols = 13;
    const geo = kind === 'orchard' ? new THREE.IcosahedronGeometry(1.5, 0) : new THREE.ConeGeometry(0.42, 1.2, 4, 1, true);
    const mesh = new THREE.InstancedMesh(geo, M.foliage({ color: kind === 'orchard' ? '#4c7d38' : '#d9b955' }), rows * cols);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lx = -hx + 1.6 + (c / (cols - 1)) * (hx * 2 - 3.2);
        const lz = -hz + 1.6 + (r / (rows - 1)) * (hz * 2 - 3.2);
        const sc = kind === 'orchard' ? 0.9 + random() * 0.5 : 0.8 + random() * 0.5;
        q.setFromEuler(new THREE.Euler(0, random() * 6.283, 0));
        m.compose(p.set(lx, (kind === 'orchard' ? 1.3 : 0.6) * sc, lz), q, s.set(sc, sc, sc));
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.userData.noMerge = true;
    g.add(mesh);
    const hedge = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), M.foliage({ color: '#ffffff' }), 34);
    const ring = roundedRectRing(hx + 1.2, hz + 1.2, 4, 3);
    for (let k = 0; k < 34; k++) {
      const a = ring[Math.floor((k / 34) * ring.length)];
      const sc = 0.8 + random() * 0.5;
      m.compose(p.set(a.x, 0.6 * sc, a.z), q, s.set(sc * 1.5, sc, sc));
      hedge.setMatrixAt(k, m);
      hedge.setColorAt(k, new THREE.Color().setHSL(0.25 + random() * 0.06, 0.42, 0.3));
    }
    hedge.instanceMatrix.needsUpdate = true;
    if (hedge.instanceColor) hedge.instanceColor.needsUpdate = true;
    hedge.castShadow = true;
    hedge.userData.noMerge = true;
    g.add(hedge);
  } else if (kind === 'pen') {
    const pen = new THREE.Group();
    for (const s of [-1, 1]) {
      const long = P.fenceLine({ length: 14, spacing: 1.8, height: 1.3 });
      long.position.set(0, 0, s * 6);
      pen.add(long);
      const side = P.fenceLine({ length: 12, spacing: 1.8, height: 1.3 });
      side.rotation.y = Math.PI / 2;
      side.position.set(s * 7, 0, 0);
      pen.add(side);
    }
    g.add(pen);
    const sheep = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 7, 5), M.paint({ color: '#ffffff', roughness: 1 }), 6);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      m.compose(new THREE.Vector3((random() - 0.5) * 10, 0.5, (random() - 0.5) * 8), new THREE.Quaternion(), new THREE.Vector3(1.25, 0.85, 1));
      sheep.setMatrixAt(i, m);
      sheep.setColorAt(i, new THREE.Color().setHSL(0.1, 0.05, 0.85 + random() * 0.1));
    }
    sheep.instanceMatrix.needsUpdate = true;
    if (sheep.instanceColor) sheep.instanceColor.needsUpdate = true;
    sheep.castShadow = true;
    sheep.userData.noMerge = true;
    g.add(sheep);
    const hut = B.roundHouse({ radius: 3.4, height: 3.2, roofStyle: 'thatch', roofTone: '#a8894a', wallKind: 'warm', seed: Math.round(project.z) });
    hut.position.set(9, 0, 0);
    g.add(hut);
  } else if (kind === 'kiln') {
    const kiln = new THREE.Group();
    kiln.add(P.cyl(2.1, 2.4, 3.4, 12, M.stone('warm'), { tile: 2, pos: [0, 1.7, 0] }));
    kiln.add(P.cone(2.5, 1.8, 12, M.stone('dark'), { tile: 1.6, pos: [0, 4.2, 0] }));
    kiln.add(P.box(1.2, 1.4, 0.4, M.paint({ color: '#241f1a', roughness: 1 }), { tile: 0.6, pos: [0, 0.7, 2.3] }));
    const fire = P.flame({ size: 0.8, y: 0.4 });
    fire.position.set(0, 0.4, 2.5);
    kiln.add(fire);
    onTickFlame(fire);
    kiln.add(P.box(3.4, 0.9, 2.2, M.planks({ tone: '#6b5540' }), { tile: 1.2, pos: [3.6, 0.45, 0] }));
    g.add(kiln);
  } else if (kind === 'wharf') {
    const zc = L.river.centerZ(project.x + 0);
    const reach = clamp(zc - project.z, 6, 30);
    const pier = new THREE.Group();
    const wood = M.planks({ tone: '#7c5a38' });
    pier.add(P.box(4.4, 0.4, reach, wood, { tile: 2.2, pos: [0, 0.9, reach / 2] }));
    for (let k = 0; k < 4; k++) {
      for (const s of [-1.8, 1.8]) {
        pier.add(P.cyl(0.2, 0.26, 5, 6, M.planks({ tone: '#5b4630' }), { tile: 1, pos: [s, -1.2, 3 + k * (reach / 4)] }));
      }
    }
    for (let k = 0; k < 4; k++) {
      const crate = P.crate(0.8 + random() * 0.4);
      crate.position.set(-1.2 + (k % 2) * 2.4, 1.4, 4 + k * 3);
      pier.add(crate);
    }
    g.add(pier);
    const shed = B.house({ w: 9, d: 6, h: 4, wallKind: 'warm', roofStyle: 'thatch', roofTone: '#b5924f', ridgeAlong: 'x', windows: 1, chimney: true, seed: Math.round(project.x) });
    shed.position.set(0, 0, -6);
    g.add(shed);
  } else if (kind === 'chapel') {
    const chapel = B.chapel({ w: 9, d: 17, h: 6.2, wallKind: 'cool', roofTone: '#5d4a6b', faction: null });
    place(chapel, 0, 0);
    const tower = B.squareTower({ w: 5.4, d: 5.4, height: 12, stone, roof: 'pyramid', roofTone: '#4b6168', roofStyle: 'shingle', faction: null, seed: 3 });
    place(tower, -6, -6);
    const cross = new THREE.Group();
    cross.add(P.box(0.24, 3.2, 0.24, M.stone('warm'), { tile: 1, pos: [0, 1.6, 0] }));
    cross.add(P.box(1.4, 0.22, 0.22, M.stone('warm'), { tile: 1, pos: [0, 2.6, 0] }));
    place(cross, 5, 6);
  } else if (kind === 'well') {
    place(P.wellHouse(), 0, 0);
  } else if (kind === 'windmill') {
    const mill = B.windmill({ height: 9.5, radius: 3.4, blade: 7 });
    place(mill, 0, 0, random() * 2);
  } else if (kind === 'barracksWing') {
    const wing = B.house({
      w: 22, d: 8.6, h: 4.4, wallKind: 'cool', roofStyle: cfg.roofStyle, roofTone: cfg.roofTone,
      ridgeAlong: 'x', timber: true, chimney: true, windows: 5, story: 2, seed: 77,
    });
    place(wing, 0, 0);
    const rack = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      rack.add(P.box(0.5, 0.4, 4.2, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [0, 0.7 + i * 0.5, 0] }));
    }
    place(rack, 8, 5, 0.4);
  } else {
    return null;
  }

  g.userData.project = project;
  return g;
}

function onTickFlame(marker) {
  onTick((t) => P.updateFlame(marker, t));
}
