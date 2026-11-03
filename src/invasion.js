import * as THREE from 'three';
import * as T from './textures.js';
import * as M from './materials.js';
import * as P from './parts.js';
import { onTick } from './runtime.js';
import { createBattle, KINDS } from './army.js';
import { solveShot, integrate, MUZZLE_SPEED } from './ballistics.js';
import { figure, templateGeometry, agentMaterial, G } from './agents.js';

const PHASES = {
  quiet: 'тишина',
  muster: 'сбор за гребнем',
  march: 'колонна на подходе',
  deploy: 'развёртывание в линию',
  assault: 'штурм',
  repelled: 'вторжение отбито',
  lost: 'оборона сломлена',
};

/**
 * The invasion: an enemy column comes over the ridge, deploys on the plain
 * between the castle and the town and assaults the garrison. All the numbers
 * live in army.js; this module only places troops, fires the beacons and
 * draws what the model says happened.
 */
export function buildInvasion(cfg, L, { onEvent, beacons = [] } = {}) {
  const group = new THREE.Group();
  const y = (x, z) => L.groundY(x, z);
  const enemy = cfg.faction.id === 'greymark'
    ? { base: '#2f6fb2', accent: '#dfe8d2', dark: '#24496f' }
    : { base: '#8d2f3a', accent: '#e7c98a', dark: '#5f2028' };

  // Both lines run north-south and face along x, so `lane` is a place in the
  // line and `rear` the depth behind it. Without that every file would march
  // onto one point and the battle would draw as a single blob.
  const muster = { x: 252, z: -158 };
  const route = [muster, { x: 198, z: -104 }, { x: 152, z: -24 }, { x: 126, z: 44 }, { x: 112, z: 88 }];
  const line = { x: 66, z: 88 };
  const hostLine = { x: -2, z: 88 };
  const assault = { x: hostLine.x + 30, z: hostLine.z };

  const battle = createBattle({
    seed: cfg.seed + 404,
    attackers: [
      { side: 'invader', kind: 'foot', x: muster.x, z: muster.z - 14, route, morale: 58 },
      { side: 'invader', kind: 'foot', x: muster.x + 14, z: muster.z, route, morale: 58 },
      { side: 'invader', kind: 'foot', x: muster.x, z: muster.z + 14, route, morale: 54 },
      { side: 'invader', kind: 'horse', x: muster.x - 18, z: muster.z + 22, route, morale: 50 },
      { side: 'invader', kind: 'gun', x: muster.x + 6, z: muster.z + 28, route, morale: 40 },
      { side: 'invader', kind: 'cart', x: muster.x - 10, z: muster.z - 26, route },
    ],
    defenders: [
      { side: 'host', kind: 'foot', x: hostLine.x, z: hostLine.z - 22, route: [], morale: 66 },
      { side: 'host', kind: 'foot', x: hostLine.x, z: hostLine.z, route: [], morale: 66 },
      { side: 'host', kind: 'foot', x: hostLine.x, z: hostLine.z + 22, route: [], morale: 62 },
      { side: 'host', kind: 'gun', x: hostLine.x - 26, z: hostLine.z + 6, route: [], morale: 46 },
    ],
  });

  const FILES = [
    { lane: -26, rear: 0 },
    { lane: 0, rear: 0 },
    { lane: 26, rear: 0 },
    { lane: 46, rear: 6 },
    { lane: -6, rear: 26 },
    { lane: 34, rear: 56 },
    { lane: -22, rear: 0 },
    { lane: 0, rear: 0 },
    { lane: 22, rear: 0 },
    { lane: 6, rear: -26 },
  ];

  battle.units.forEach((u, i) => {
    Object.assign(u, FILES[i]);
    u.home = u.side === 'invader' ? { x: 340, z: -260 } : { x: -64, z: 124 };
    u.file = u.side;
  });

  /* ------------------------------------------------------------- templates */
  const footGeo = figure({ robe: enemy.base, hat: enemy.dark, skin: '#c99a6c', prop: { geo: G.cyl(0.05, 1.6), pos: [0.5, 1.4, 0.1], rot: [0, 0, -0.25], color: '#5b4630' } });
  const guardGeo = figure({ robe: cfg.faction.base, hat: '#8e979e', prop: { geo: G.cyl(0.05, 3), pos: [0.5, 1.5, 0], color: '#6b5334' } });
  const horseGeo = templateGeometry([
    ...horseParts('#5a4636', '#3f332a'),
    { geo: G.cone(0.42, 1.3), pos: [-0.1, 1.5, 0], color: enemy.base },
    { geo: G.ball(0.2), pos: [-0.1, 2.2, 0], color: '#c99a6c' },
  ]);
  const gunGeo = templateGeometry([
    { geo: G.box(3.4, 0.9, 1.6), pos: [0, 0.7, 0], color: '#5b4630' },
    { geo: G.cyl(0.26, 0.34, 3.6), pos: [0.5, 1.5, 0], rot: [0, 0, Math.PI / 2], color: '#2e3236' },
    { geo: G.ball(0.62), pos: [-1.1, 0.62, 0.9], rot: [Math.PI / 2, 0, 0], color: '#4b3626' },
    { geo: G.ball(0.62), pos: [-1.1, 0.62, -0.9], rot: [Math.PI / 2, 0, 0], color: '#4b3626' },
  ]);
  const cartGeo = templateGeometry([
    { geo: G.box(3.2, 1.1, 2.2), pos: [0, 1.3, 0], color: '#6b5540' },
    { geo: G.ball(0.7), pos: [-1.1, 0.7, 1.2], rot: [Math.PI / 2, 0, 0], color: '#4b3626' },
    { geo: G.ball(0.7), pos: [-1.1, 0.7, -1.2], rot: [Math.PI / 2, 0, 0], color: '#4b3626' },
  ]);

  function horseParts(body, head) {
    return [
      { geo: G.ball(0.62), pos: [0, 1.05, 0], scale: [1.7, 0.95, 0.9], color: body },
      { geo: G.ball(0.28), pos: [1.2, 1.5, 0], scale: [1.3, 1, 0.85], color: head },
      { geo: G.cyl(0.1, 0.7), pos: [0.55, 0.35, 0.3], color: head },
      { geo: G.cyl(0.1, 0.7), pos: [0.55, 0.35, -0.3], color: head },
      { geo: G.cyl(0.1, 0.7), pos: [-0.55, 0.35, 0.3], color: head },
      { geo: G.cyl(0.1, 0.7), pos: [-0.55, 0.35, -0.3], color: head },
    ];
  }

  const geoFor = (u) => (u.kind === 'horse' ? horseGeo
    : u.kind === 'gun' ? gunGeo
      : u.kind === 'cart' ? cartGeo
        : u.side === 'host' ? guardGeo : footGeo);

  /* ------------------------------------------------------------ rendering */
  const draws = [];
  for (const u of battle.units) {
    const kind = KINDS[u.kind];
    const mesh = new THREE.InstancedMesh(geoFor(u), agentMaterial, u.full);
    mesh.castShadow = true;
    mesh.userData.noMerge = true;
    mesh.count = 0;
    group.add(mesh);
    draws.push({ unit: u, mesh, spacing: kind.spacing });
  }

  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const puffMesh = new THREE.InstancedMesh(puffGeo, new THREE.MeshBasicMaterial({
    map: T.toTexture(T.puff({ size: 96, seed: 13 }), { repeat: 1 }),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }), 80);
  puffMesh.userData.noMerge = true;
  group.add(puffMesh);
  const puffs = [];
  for (let i = 0; i < 80; i++) puffs.push({ live: false, pos: new THREE.Vector3(), life: 0, max: 1, size: 1, color: '#cfc9c0' });

  const ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), M.metal({ color: '#23262a', roughness: 0.55, metalness: 0.6 }), 8);
  ballMesh.castShadow = true;
  ballMesh.userData.noMerge = true;
  ballMesh.count = 0;
  group.add(ballMesh);
  const shells = [];

  const cameraQuat = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();

  /* ---------------------------------------------------------------- phases */
  let phase = 'quiet';
  let clock = 0;
  let bombard = 0;
  let windowCamera = null;
  const baseline = { invader: battle.strengthOf('invader'), host: battle.strengthOf('host') };
  group.visible = false;

  function say(text) {
    if (onEvent) onEvent('war', text);
  }

  function setPhase(next) {
    if (phase === next) return;
    phase = next;
    clock = 0;
    say(`Тревога: ${PHASES[next]}`);
    if (next === 'muster') {
      for (const b of beacons) P.setFlameHidden(b, false);
      say('Дозорные башни зажгли костры');
    }
    if (next === 'quiet' || next === 'repelled' || next === 'lost') {
      for (const b of beacons) P.setFlameHidden(b, true);
    }
    if (next === 'quiet') group.visible = false;
    if (next === 'deploy') formUp('invader', line);
    if (next === 'assault') {
      formUp('invader', assault);
      formUp('host', hostLine);
    }
  }

  /** Send every file of `side` to its own place in the line at `anchor`. */
  function formUp(side, anchor) {
    for (const u of battle.sides[side]) {
      if (u.state !== 'alive') continue;
      u.mode = 'maneuver';
      u.objective = { x: anchor.x + u.rear, z: anchor.z + u.lane };
    }
  }

  function advance(dt) {
    clock += dt;
    if (phase === 'muster' && clock > 8) setPhase('march');
    if (phase === 'march') {
      const arrived = battle.sides.invader.filter((u) => u.state === 'alive' && u.mode === 'hold').length;
      if (clock > 90 || arrived >= 3) setPhase('deploy');
    }
    if (phase === 'deploy' && clock > 26) setPhase('assault');
    if (phase === 'assault') {
      bombard += dt;
      if (bombard > 7) {
        bombard = 0;
        shellAtTarget();
      }
      const now = battle.summary();
      if (now.invader <= baseline.invader * 0.22 || battle.alive('invader').every((u) => u.state === 'rout')) setPhase('repelled');
      else if (now.host <= baseline.host * 0.25) setPhase('lost');
      else if (clock > 300) setPhase('repelled');
    }
    if (phase === 'repelled' || phase === 'lost') {
      const losers = phase === 'repelled' ? 'invader' : 'host';
      for (const u of battle.sides[losers]) {
        if (u.state === 'alive') {
          u.state = 'rout';
          u.fleeTo = u.home;
        }
      }
      if (clock > 60) setPhase('quiet');
    }
  }

  function shellAtTarget() {
    const gun = battle.sides.host.find((u) => u.kind === 'gun' && u.state === 'alive');
    const target = battle.sides.invader.find((u) => u.kind !== 'cart' && u.state === 'alive');
    if (!gun || !target) return;
    const origin = { x: gun.x, y: y(gun.x, gun.z) + 1.6, z: gun.z };
    const solved = solveShot({
      from: origin,
      to: { x: target.x, y: y(target.x, target.z) + 1, z: target.z },
      groundAt: (x, z) => y(x, z) - 0.2,
      walls: [],
    });
    const heading = Math.atan2(target.z - gun.z, target.x - gun.x);
    const elev = solved.elev;
    shells.push({
      pos: { ...origin },
      vel: {
        x: Math.cos(heading) * Math.cos(elev) * MUZZLE_SPEED,
        y: Math.sin(elev) * MUZZLE_SPEED,
        z: Math.sin(heading) * Math.cos(elev) * MUZZLE_SPEED,
      },
      life: 8,
    });
    puff({ x: gun.x, y: y(gun.x, gun.z) + 2, z: gun.z }, 4, 0.8, '#ffe9b0');
  }

  function puff(pos, size, life, color) {
    const slot = puffs.find((p) => !p.live);
    if (!slot) return;
    slot.live = true;
    slot.pos.set(pos.x, pos.y, pos.z);
    slot.life = life;
    slot.max = life;
    slot.size = size;
    slot.color = color || '#cfc9c0';
  }

  function syncUnits() {
    for (const d of draws) {
      const u = d.unit;
      const n = u.state === 'gone' ? 0 : Math.max(0, Math.round(u.strength));
      d.mesh.count = n;
      if (!n) {
        d.mesh.instanceMatrix.needsUpdate = true;
        continue;
      }
      const files = Math.max(2, Math.ceil(Math.sqrt(n)));
      const sp = d.spacing;
      const cy = Math.cos(u.yaw);
      const sy = Math.sin(u.yaw);
      for (let i = 0; i < n; i++) {
        const f = i % files;
        const r = Math.floor(i / files);
        const lx = (f - (files - 1) / 2) * sp;
        const lz = (r - (Math.ceil(n / files) - 1) / 2) * sp * 1.15;
        const x = u.x + lx * cy - lz * sy;
        const z = u.z + lx * sy + lz * cy;
        const bob = Math.abs(Math.sin(performanceNow() * 0.004 + i)) * 0.05;
        _e.set(0, -u.yaw, 0);
        _q.setFromEuler(_e);
        _m.compose(_v.set(x, y(x, z) + bob, z), _q, _s.set(1, 1, 1));
        d.mesh.setMatrixAt(i, _m);
      }
      d.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  let time = 0;
  const performanceNow = () => time * 1000;

  function update(dt) {
    time += dt;
    if (phase !== 'quiet') advance(dt);
    battle.step(dt);
    const events = battle.drainEvents();
    for (const e of events) {
      if (e.type === 'volley') {
        puff({ x: e.at.x, y: y(e.at.x, e.at.z) + 1.8, z: e.at.z }, e.kind === 'gun' ? 4.5 : 2.2, 0.55, '#e6dcc0');
        puff({ x: e.target.x, y: y(e.target.x, e.target.z) + 1.2, z: e.target.z }, 2.6, 0.8, '#b9b0a2');
      }
      if (e.type === 'routed') say('Отряд потерял строй и бежит');
      if (e.type === 'destroyed') say('Отряд уничтожен');
    }
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.life -= dt;
      integrate(s, dt);
      if (s.pos.y < y(s.pos.x, s.pos.z) || s.life <= 0) {
        puff({ x: s.pos.x, y: y(s.pos.x, s.pos.z) + 1.2, z: s.pos.z }, 7, 1.4, '#a89e90');
        shells.splice(i, 1);
      }
    }
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      if (!p.live) {
        _m.compose(_v.set(0, -80, 0), _q.identity(), _s.set(0.0001, 0.0001, 0.0001));
        puffMesh.setMatrixAt(i, _m);
        continue;
      }
      p.life -= dt;
      const k = 1 - p.life / p.max;
      const size = p.size * (0.6 + k * 1.6);
      _m.compose(_v.copy(p.pos).add(new THREE.Vector3(0, k * 1.6, 0)), _q.copy(cameraQuat), _s.set(size, size, size));
      puffMesh.setMatrixAt(i, _m);
      puffMesh.setColorAt(i, new THREE.Color(p.color).multiplyScalar(1 - k * 0.6));
      if (p.life <= 0) p.live = false;
    }
    puffMesh.instanceMatrix.needsUpdate = true;
    if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
    ballMesh.count = Math.min(shells.length, 8);
    for (let i = 0; i < ballMesh.count; i++) {
      _m.compose(_v.set(shells[i].pos.x, shells[i].pos.y, shells[i].pos.z), _q.identity(), _s.set(1, 1, 1));
      ballMesh.setMatrixAt(i, _m);
    }
    ballMesh.instanceMatrix.needsUpdate = true;
    syncUnits();
  }

  onTick((t, dt) => {
    if (windowCamera) cameraQuat.copy(windowCamera.quaternion);
    update(dt);
  });

  function resetArmies() {
    for (const u of battle.units) {
      const kind = KINDS[u.kind];
      u.strength = kind.size;
      u.state = 'alive';
      u.morale = u.maxMorale;
      u.leg = 0;
      u.cooldown = kind.cooldown * 0.6;
      u.fleeTo = null;
      if (u.side === 'invader') {
        // The column debouches into its own place in the line as it arrives.
        u.route = [...route, { x: line.x + 44 + u.rear, z: line.z + u.lane * 0.5 }];
        u.x = muster.x + u.rear;
        u.z = muster.z + u.lane * 0.6;
        u.mode = 'march';
      } else {
        u.route = [];
        u.x = hostLine.x + u.rear;
        u.z = hostLine.z + u.lane;
        u.mode = 'hold';
      }
    }
    baseline.invader = battle.strengthOf('invader');
    baseline.host = battle.strengthOf('host');
  }

  return {
    group,
    battle,
    get phase() {
      return phase;
    },
    phaseLabel: () => PHASES[phase],
    stats: () => battle.summary(),
    setCamera(cam) {
      windowCamera = cam;
    },
    start() {
      if (phase !== 'quiet') return;
      resetArmies();
      group.visible = true;
      setPhase('muster');
    },
    stop() {
      setPhase('quiet');
      group.visible = false;
    },
    /** Advance the whole simulation in fixed steps: used to check outcomes headlessly. */
    sim(seconds) {
      const h = 1 / 30;
      for (let t = 0; t < seconds; t += h) update(h);
    },
  };
}
