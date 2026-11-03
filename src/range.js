import * as THREE from 'three';
import * as M from './materials.js';
import * as P from './parts.js';
import * as B from './buildings.js';
import * as T from './textures.js';
import { onTick } from './runtime.js';
import { mergeStatic, buildCapGeometry, applyPlanarUV, roundedRectRing } from './geometry.js';
import { cannon } from './barracks.js';
import { figure, wanderers } from './agents.js';
import {
  GRAVITY, MUZZLE_SPEED, aimAngle, integrate, wallHit, toWallLocal,
} from './ballistics.js';

const { clamp } = THREE.MathUtils;

/** Signed shortest turn between two yaw angles. */
function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The gunnery range: three guns on a graded platform firing real ballistic
 * shots at wall targets that take damage hit by hit — blocks are knocked out,
 * a breach opens, the section collapses, and the ground behind keeps craters.
 */

const DISPERSION = 0.016;

export function buildRange(cfg, L) {
  const group = new THREE.Group();
  const R = L.range;
  const random = T.rng(cfg.seed + 808081);
  const y = (x, z) => L.groundY(x, z);

  const line = { x: R.cx + 44, z: R.cz };
  const butts = { x: R.cx - 50 };

  /* ------------------------------------------------------------- platform */
  const pad = buildCapGeometry(roundedRectRing(22, 26, 6, 3), y(line.x, line.z) + 0.08);
  applyPlanarUV(pad, 7);
  const padMesh = new THREE.Mesh(pad, new THREE.MeshStandardMaterial({
    map: M.ground({ tone: 'path' }).map, color: '#9c8a68', roughness: 1,
  }));
  padMesh.receiveShadow = true;
  padMesh.userData.noMerge = true;
  padMesh.position.set(line.x, 0, line.z);
  group.add(padMesh);

  const guns = [];
  for (let i = 0; i < 3; i++) {
    const gz = line.z + (i - 1) * 11;
    const piece = cannon();
    piece.position.set(line.x - 4, y(line.x - 4, gz), gz);
    piece.rotation.y = Math.PI;
    piece.userData.elev = 0.06;
    piece.userData.recoil = 0;
    piece.userData.crew = i;
    group.add(piece);
    guns.push(piece);
    const shotStack = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      shotStack.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), M.metal({ color: '#23262a', roughness: 0.6, metalness: 0.5 })));
      shotStack.children[k].position.set((k % 2) * 0.66, 0.3, Math.floor(k / 2) * 0.66);
    }
    shotStack.position.set(4.5, y(line.x + 1, gz) - y(line.x - 4, gz), 2.6);
    piece.add(shotStack);
    const rammer = P.cyl(0.07, 0.07, 3.2, 5, M.planks({ tone: '#6b5540' }), { tile: 0.8, pos: [3.4, 0.9, -2.4] });
    rammer.rotation.z = Math.PI / 2 - 0.25;
    piece.add(rammer);
  }

  /* ------------------------------------------------------------ backstop */
  const berm = new THREE.Group();
  for (let i = 0; i < 13; i++) {
    const bz = R.cz - 40 + i * 5;
    berm.add(P.cone(6.4, 4.2, 9, M.ground({ tone: 'path' }), { tile: 2, pos: [butts.x - 17, y(butts.x - 17, bz) + 1.6, bz] }));
  }
  berm.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.userData.noMerge = true; } });
  group.add(berm);

  /* ------------------------------------------------------------ targets */
  const targets = [
    makeWall(L, { x: butts.x, z: R.cz - 30, ry: Math.PI / 2, cols: 6, courses: 3, label: 'низкая стена' }),
    makeWall(L, { x: butts.x, z: R.cz, ry: Math.PI / 2, cols: 7, courses: 4, label: 'высокая стена' }),
    makeWall(L, { x: butts.x, z: R.cz + 30, ry: Math.PI / 2, cols: 5, courses: 5, label: 'башня' }),
  ];

  for (const t of targets) group.add(t.node);

  /* ----------------------------------------------------- range furniture */
  for (const dist of [30, 60, 90]) {
    const mx = line.x - dist;
    const marker = new THREE.Group();
    marker.add(P.box(0.5, 1.3, 0.5, M.stone('warm'), { tile: 1, pos: [0, 0.65, 0] }));
    marker.add(P.box(1.4, 0.22, 0.22, M.planks({ tone: '#6b5540' }), { tile: 0.8, pos: [0, 1.2, 0] }));
    for (const s of [-1, 1]) {
      marker.add(P.cyl(0.06, 0.08, 1.2, 5, M.planks({ tone: '#5b4630' }), { tile: 0.6, pos: [0, 0.6, s * 2.6] }));
    }
    marker.add(P.box(0.14, 0.14, 5.6, M.planks({ tone: '#5b4630' }), { tile: 0.8, pos: [0, 1.15, 0] }));
    marker.position.set(mx, y(mx, R.cz - 12), R.cz - 12);
    group.add(marker);
  }

  const post = B.house({ w: 8, d: 6, h: 3.6, wallKind: 'warm', roofStyle: 'shingle', roofTone: '#4b6168', ridgeAlong: 'x', chimney: true, windows: 2, seed: 12 });
  post.position.set(line.x + 12, y(line.x + 12, line.z + 18), line.z + 18);
  post.rotation.y = -0.4;
  group.add(post);
  const flag = P.bannerPole({ height: 7, faction: { ...cfg.faction, mat: M.bannerMaterial({ base: cfg.faction.base, accent: cfg.faction.accent, motif: cfg.faction.motif, seed: cfg.faction.id.length * 13 }) } });
  flag.position.set(line.x + 17, y(line.x + 17, line.z + 14), line.z + 14);
  group.add(flag);
  onTick((t) => P.flapCloth(flag.userData.flag, t, 0.3, 2.6));

  const magazine = new THREE.Group();
  magazine.add(P.box(7, 4.2, 5.6, M.stone('dark'), { tile: 3, pos: [0, 2.1, 0] }));
  magazine.add(P.box(8, 0.6, 6.6, M.stone('grey'), { tile: 2.4, pos: [0, 4.4, 0] }));
  magazine.add(P.cone(4.4, 1.5, 4, M.stone('warm'), { tile: 1.8, pos: [0, 5.2, 0], rot: [0, Math.PI / 4, 0] }));
  magazine.add(P.box(1.3, 2.4, 0.3, M.planks({ tone: '#4b3626' }), { tile: 1, pos: [0, 1.2, 2.85] }));
  for (const s of [-1, 1]) magazine.add(P.cyl(0.16, 0.2, 2.2, 6, M.metal({ color: '#3a3f45', metalness: 0.8, roughness: 0.4 }), { tile: 0.8, pos: [s * 3.2, 1.1, 3.2] }));
  magazine.position.set(line.x + 14, y(line.x + 14, line.z - 16), line.z - 16);
  magazine.rotation.y = 0.3;
  group.add(magazine);

  const gunners = wanderers(group, {
    geo: figure({ robe: '#3f4a52', hat: '#2f3236' }),
    count: 9,
    seed: cfg.seed + 77,
    speed: 0.9,
    heightAt: y,
    spot: (i, r) => {
      const g = guns[i % guns.length];
      return { x: g.position.x + 3 + r() * 3, z: g.position.z + (r() - 0.5) * 5, r: 2.6 };
    },
  });

  /* ------------------------------------------------------------- effects */
  const DEBRIS = 260;
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.05, 1.35), M.stone('grey'), DEBRIS);
  debris.castShadow = true;
  debris.userData.noMerge = true;
  group.add(debris);
  const debrisState = [];
  for (let i = 0; i < DEBRIS; i++) {
    debrisState.push({ live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spin: new THREE.Vector3(), life: 0 });
    debris.setColorAt(i, new THREE.Color(0.6, 0.6, 0.6));
  }
  if (debris.instanceColor) debris.instanceColor.needsUpdate = true;

  const PUFFS = 90;
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const puffMesh = new THREE.InstancedMesh(puffGeo, new THREE.MeshBasicMaterial({
    map: T.toTexture(T.puff({ size: 96, seed: 11 }), { repeat: 1 }),
    transparent: true, opacity: 0.5, depthWrite: false,
  }), PUFFS);
  puffMesh.userData.noMerge = true;
  group.add(puffMesh);
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) puffs.push({ live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1 });

  const SCORCH = 40;
  const scorch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: T.toTexture(T.softCircle({ inner: 'rgba(20,16,12,0.95)', outer: 'rgba(20,16,12,0)' }), { repeat: 1 }),
    transparent: true, opacity: 0.85, depthWrite: false,
  }), SCORCH);
  scorch.userData.noMerge = true;
  scorch.renderOrder = 2;
  group.add(scorch);
  let scorchCursor = 0;

  const CRATERS = 30;
  const craterMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), new THREE.MeshStandardMaterial({
    map: M.ground({ tone: 'path' }).map, color: '#4e4230', roughness: 1,
  }), CRATERS);
  craterMesh.userData.noMerge = true;
  craterMesh.renderOrder = 1;
  group.add(craterMesh);
  let craterAt = 0;

  const BALLS = 8;
  const ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), M.metal({ color: '#23262a', roughness: 0.55, metalness: 0.6 }), BALLS);
  ballMesh.castShadow = true;
  ballMesh.userData.noMerge = true;
  group.add(ballMesh);
  const balls = [];
  for (let i = 0; i < BALLS; i++) balls.push({ live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() });

  const tracking = new THREE.Vector3();
  let trackingLive = false;

  /* --------------------------------------------------------- mechanics */
  const stats = { shots: 0, hits: 0, blocksDown: 0, taken: 0 };
  let auto = false;
  let autoTimer = 0;
  let gunCursor = 0;
  const pending = [];

  /**
   * Low-arc solution of h = d·tanθ − g·d²·(1+tan²θ)/(2v²): with k = g·d²/(2v²)
   * the quadratic is k·t² − d·t + (k+h) = 0, so t = (d − √(d²−4k(k+h)))/(2k).
   */
  function liveTarget() {
    for (let k = 0; k < targets.length; k++) {
      const t = targets[(k + targetCursor) % targets.length];
      if (!t.destroyed) return t;
    }
    return null;
  }

  let targetCursor = 0;

  function queueShot(gunIndex) {
    const target = liveTarget();
    if (!target) return false;
    const gun = guns[gunIndex % guns.length];
    const origin = gun.position;
    const centre = new THREE.Vector3();
    target.node.getWorldPosition(centre);
    centre.y += target.height * 0.55;
    const d = Math.hypot(centre.x - origin.x, centre.z - origin.z);
    const dh = centre.y - (origin.y + 1.2);
    const elev = clamp(aimAngle(d, dh), 0.02, 0.9) + (random() - 0.5) * DISPERSION;
    // Lay the gun on the target: local +X maps to world (cos yaw, 0, -sin yaw).
    const heading = Math.atan2(centre.z - origin.z, centre.x - origin.x);
    gun.userData.aimYaw = -heading + (random() - 0.5) * DISPERSION;
    pending.push({ gun, target, elev, timer: 0, settled: false });
    stats.shots += 1;
    return true;
  }

  function release(p) {
    const gun = p.gun;
    const yaw = gun.rotation.y;
    const dir = new THREE.Vector3(
      Math.cos(yaw) * Math.cos(p.elev),
      Math.sin(p.elev),
      -Math.sin(yaw) * Math.cos(p.elev),
    );
    const muzzle = new THREE.Vector3(
      gun.position.x + 2.9 * Math.cos(yaw),
      gun.position.y + 1.2 + 2.9 * Math.sin(p.elev),
      gun.position.z - 2.9 * Math.sin(yaw),
    );
    const ball = balls.find((b) => !b.live) || balls[0];
    ball.live = true;
    ball.pos.copy(muzzle);
    ball.vel.copy(dir).multiplyScalar(MUZZLE_SPEED);
    ball.vel.x += (random() - 0.5) * 0.9;
    ball.vel.z += (random() - 0.5) * 0.9;
    gun.userData.recoil = 1;
    puff(muzzle.clone().add(dir.clone().multiplyScalar(0.8)), 3.2, 0.5, '#ffe9b0', 2.4);
    puff(muzzle.clone().add(dir.clone().multiplyScalar(2.4)), 5.5, 0.9, '#cfc9c0', 3.6);
    for (const b of balls) {
      if (b.live) { tracking.copy(b.pos); trackingLive = true; break; }
    }
  }

  function puff(pos, size, life, color, rise) {
    const slot = puffs.find((p) => !p.live);
    if (!slot) return;
    slot.live = true;
    slot.pos.copy(pos);
    slot.vel.set((random() - 0.5) * 1.6, rise, (random() - 0.5) * 1.6);
    slot.life = life;
    slot.max = life;
    slot.size = size;
    slot.color = color;
  }

  function crater(pos) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, random() * 3));
    const s = 1.5 + random() * 1.1;
    m.compose(new THREE.Vector3(pos.x, y(pos.x, pos.z) + 0.06, pos.z), q, new THREE.Vector3(s, s, 1));
    craterMesh.setMatrixAt(craterAt % CRATERS, m);
    craterAt += 1;
    craterMesh.instanceMatrix.needsUpdate = true;
  }

  function scorchAt(world, quat, size) {
    const m = new THREE.Matrix4();
    m.compose(world, quat, new THREE.Vector3(size, size, 1));
    scorch.setMatrixAt(scorchCursor % SCORCH, m);
    scorchCursor += 1;
    scorch.instanceMatrix.needsUpdate = true;
  }

  function spawnDebris(worldPos, outward, count) {
    for (let i = 0; i < count; i++) {
      const slot = debrisState.find((d) => !d.live);
      if (!slot) return;
      slot.live = true;
      slot.pos.copy(worldPos).add(new THREE.Vector3((random() - 0.5) * 1.4, (random() - 0.5) * 1.4, (random() - 0.5) * 1.4));
      slot.vel.copy(outward).multiplyScalar(6 + random() * 9).add(new THREE.Vector3((random() - 0.5) * 5, 4 + random() * 7, (random() - 0.5) * 5));
      slot.quat.setFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3));
      slot.spin.set((random() - 0.5) * 7, (random() - 0.5) * 7, (random() - 0.5) * 7);
      slot.life = 3.4 + random() * 2.2;
      debris.setColorAt(debrisState.indexOf(slot), new THREE.Color().setHSL(0.08, 0.05, 0.42 + random() * 0.2));
    }
    if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
  }

  function impact(ball, target, localPoint) {
    stats.hits += 1;
    const speed = ball.vel.length();
    const radius = clamp(speed / 30, 2.1, 4.0);
    const outward = new THREE.Vector3(-1, 0.25, 0).normalize();
    const local = new THREE.Vector3(localPoint.x, localPoint.y, localPoint.z);
    const world = target.node.localToWorld(local.clone());
    const killed = target.damage(localPoint, radius);
    stats.blocksDown += killed;
    spawnDebris(world, outward, Math.min(14, 4 + Math.round(radius * 1.6)));
    puff(world.clone().add(new THREE.Vector3(0, 1.2, 0)), 6.5, 1.3, '#b9b0a2', 3.2);
    puff(world.clone(), 4.2, 0.9, '#6f6a62', 1.8);
    const q = target.node.getWorldQuaternion(new THREE.Quaternion());
    scorchAt(world.clone().add(new THREE.Vector3(0.9, 0, 0)), q, 3.2 + random() * 1.4);
    ball.live = false;
    if (target.breach() > 0.48 && !target.destroyed) {
      target.destroyed = true;
      stats.taken += 1;
      target.collapse((pos) => spawnDebris(pos, outward, 3));
      puff(world.clone().add(new THREE.Vector3(0, 2, 0)), 12, 2.2, '#a89e90', 2.4);
      targetCursor += 1;
    }
  }

  function step(dt) {
    for (const p of pending) {
      const slide = p.gun.userData.slide;
      p.gun.userData.elev = THREE.MathUtils.lerp(p.gun.userData.elev, p.elev, Math.min(1, dt * 3.4));
      const dyaw = shortestAngle(p.gun.rotation.y, p.gun.userData.aimYaw);
      p.gun.rotation.y += dyaw * Math.min(1, dt * 2.6);
      slide.rotation.z = p.gun.userData.elev;
      p.timer += dt;
      const settled = Math.abs(p.gun.userData.elev - p.elev) < 0.02 && Math.abs(dyaw) < 0.02;
      if (settled || p.timer > 2.2) {
        release(p);
        p.done = true;
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].done) pending.splice(i, 1);

    for (const gun of guns) {
      if (gun.userData.recoil <= 0) continue;
      gun.userData.recoil = Math.max(0, gun.userData.recoil - dt * 2.6);
      const back = Math.sin(gun.userData.recoil * Math.PI * 0.5) * 0.85;
      gun.userData.slide.position.x = back;
    }

    const sub = 4;
    const h = dt / sub;
    for (const ball of balls) {
      if (!ball.live) continue;
      for (let s = 0; s < sub; s++) {
        integrate(ball, h);
        if (ball.pos.y < y(ball.pos.x, ball.pos.z)) {
          crater(ball.pos);
          puff(ball.pos.clone().add(new THREE.Vector3(0, 1, 0)), 5, 1.1, '#8d8071', 2.6);
          ball.live = false;
          break;
        }
        const struck = wallHit(ball.pos, targets);
        if (struck) {
          impact(ball, struck, toWallLocal(struck, ball.pos));
        }
        if (!ball.live) break;
        if (ball.pos.x < butts.x - 40) {
          ball.live = false;
          break;
        }
      }
      if (ball.live) {
        tracking.copy(ball.pos);
        trackingLive = true;
      }
    }
    if (!balls.some((b) => b.live)) trackingLive = false;

    for (let i = 0; i < debrisState.length; i++) {
      const d = debrisState[i];
      if (!d.live) {
        _m.compose(_v.set(0, -80, 0), _q.identity(), _s.set(0.0001, 0.0001, 0.0001));
        debris.setMatrixAt(i, _m);
        continue;
      }
      d.life -= dt;
      d.vel.y -= GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      const floor = y(d.pos.x, d.pos.z);
      if (d.pos.y < floor + 0.4) {
        d.pos.y = floor + 0.4;
        d.vel.multiplyScalar(0.42);
        d.vel.y = Math.abs(d.vel.y) * 0.22;
        d.spin.multiplyScalar(0.5);
      }
      _e.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt);
      d.quat.multiply(new THREE.Quaternion().setFromEuler(_e));
      const shrink = d.life < 0.9 ? Math.max(0.0001, d.life / 0.9) : 1;
      _m.compose(_v.copy(d.pos), d.quat, _s.set(shrink, shrink, shrink));
      debris.setMatrixAt(i, _m);
      if (d.life <= 0) d.live = false;
    }
    debris.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      if (!p.live) {
        _m.compose(_v.set(0, -80, 0), _q.identity(), _s.set(0.0001, 0.0001, 0.0001));
        puffMesh.setMatrixAt(i, _m);
        continue;
      }
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.y *= 1 - 1.1 * dt;
      const k = 1 - p.life / p.max;
      const size = p.size * (0.5 + k * 1.5);
      _m.compose(_v.copy(p.pos), _q.copy(cameraQuat), _s.set(size, size, size));
      puffMesh.setMatrixAt(i, _m);
      puffMesh.setColorAt(i, _c.set(p.color).multiplyScalar(1 - k * 0.55));
      if (p.life <= 0) p.live = false;
    }
    puffMesh.instanceMatrix.needsUpdate = true;
    if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;

    for (const ball of balls) {
      const idx = balls.indexOf(ball);
      if (!ball.live) {
        _m.compose(_v.set(0, -80, 0), _q.identity(), _s.set(0.0001, 0.0001, 0.0001));
      } else {
        _m.compose(_v.copy(ball.pos), _q.identity(), _s.set(1, 1, 1));
      }
      ballMesh.setMatrixAt(idx, _m);
    }
    ballMesh.instanceMatrix.needsUpdate = true;
  }

  const cameraQuat = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _c = new THREE.Color();

  onTick((t, dt) => {
    gunners.update(dt, t);
    if (auto) {
      autoTimer += dt;
      if (autoTimer > 2.4) {
        autoTimer = 0;
        if (!liveTarget()) setAuto(false);
        else queueShot(gunCursor++);
      }
    }
    step(dt);
  });

  function setAuto(value) {
    auto = !!value;
    autoTimer = 0;
  }

  function reset() {
    for (const t of targets) t.reset();
    for (const d of debrisState) d.live = false;
    for (const p of puffs) p.live = false;
    for (const b of balls) b.live = false;
    pending.length = 0;
    stats.shots = 0;
    stats.hits = 0;
    stats.blocksDown = 0;
    stats.taken = 0;
    targetCursor = 0;
    scorchCursor = 0;
    craterAt = 0;
    hideAll(scorch, SCORCH);
    hideAll(craterMesh, CRATERS);
  }

  function hideAll(mesh, count) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, -80, 0), new THREE.Quaternion(), new THREE.Vector3(0.0001, 0.0001, 0.0001));
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  hideAll(debris, DEBRIS);
  hideAll(puffMesh, PUFFS);
  hideAll(ballMesh, BALLS);
  hideAll(scorch, SCORCH);
  hideAll(craterMesh, CRATERS);

  group.updateMatrixWorld(true);
  mergeStatic(group, group);

  return {
    group,
    stats,
    targets,
    guns,
    tracking,
    isTracking: () => trackingLive,
    setAuto,
    get auto() {
      return auto;
    },
    fireOne() {
      return queueShot(gunCursor++);
    },
    reset,
    setCameraQuat(q) {
      cameraQuat.copy(q);
    },
    summary() {
      return targets.map((t) => ({ label: t.label, breach: Math.round(t.breach() * 100), destroyed: t.destroyed }));
    },
  };
}

/**
 * A wall built out of individual blocks so that each hit can knock some out.
 * Damage is measured in local space, which keeps the hit test and the breach
 * bookkeeping independent of where the wall stands.
 */
function makeWall(L, opts) {
  const block = 1.7;
  const courseH = 1.15;
  const thickness = 1.5;
  const cols = opts.cols;
  const courses = opts.courses;
  const total = cols * courses;

  const node = new THREE.Group();
  const wx = opts.x;
  const wz = opts.z;
  node.position.set(wx, L.groundY(wx, wz), wz);
  node.rotation.y = opts.ry;

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(block * 0.94, courseH * 0.94, thickness), M.stone('grey'), total);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noMerge = true;
  node.add(mesh);

  const foot = new THREE.Mesh(new THREE.BoxGeometry(cols * block + 1.6, 0.7, thickness + 1.4), M.stone('dark'));
  foot.position.set(0, 0.35, 0);
  foot.receiveShadow = true;
  node.add(foot);

  const locals = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let i = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < courses; r++) {
      const lx = (c - (cols - 1) / 2) * block + (r % 2 ? block * 0.22 : 0);
      const ly = 0.7 + courseH * (r + 0.5);
      locals.push({ x: lx, y: ly, z: 0, alive: true });
      m.compose(p.set(lx, ly, 0), q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color().setHSL(0.08, 0.04, 0.5 + ((c * 5 + r * 11) % 4) * 0.045));
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const hidden = new THREE.Matrix4().compose(new THREE.Vector3(0, -80, 0), q, new THREE.Vector3(0.0001, 0.0001, 0.0001));

  const wall = {
    node,
    label: opts.label,
    cx: wx,
    cz: wz,
    groundY: L.groundY(wx, wz),
    height: L.groundY(wx, wz) + 0.7 + courses * courseH,
    halfWidth: (cols * block) / 2 + block,
    halfDepth: thickness / 2 + 0.6,
    destroyed: false,
    disabled: false,
    breach() {
      const dead = locals.filter((b) => !b.alive).length;
      return dead / total;
    },
    damage(local, radius) {
      let killed = 0;
      for (let k = 0; k < locals.length; k++) {
        const b = locals[k];
        if (!b.alive) continue;
        if (Math.hypot(b.x - local.x, b.y - local.y) > radius) continue;
        b.alive = false;
        killed += 1;
        mesh.setMatrixAt(k, hidden);
      }
      if (killed) mesh.instanceMatrix.needsUpdate = true;
      return killed;
    },
    collapse(spawn) {
      wall.disabled = true;
      for (let k = 0; k < locals.length; k++) {
        const b = locals[k];
        if (!b.alive) continue;
        b.alive = false;
        mesh.setMatrixAt(k, hidden);
        spawn(node.localToWorld(new THREE.Vector3(b.x, b.y, 0)));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    reset() {
      wall.destroyed = false;
      wall.disabled = false;
      for (let k = 0; k < locals.length; k++) {
        const b = locals[k];
        b.alive = true;
        m.compose(p.set(b.x, b.y, 0), q, s);
        mesh.setMatrixAt(k, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };

  node.position.y = L.groundY(wx, wz);
  return wall;
}
