import * as THREE from 'three';
import * as M from './materials.js';
import { quatYaw } from './geometry.js';
import { boxUV, scaleUV } from './materials.js';
import * as T from './textures.js';

export const UP = new THREE.Vector3(0, 1, 0);

/**
 * Primitives are requested thousands of times per build with the same
 * dimensions, so identical ones share one BufferGeometry. The UV baking below
 * is a pure function of the parameters, which is what makes sharing safe.
 */
const geoCache = new Map();
const shared = new WeakSet();

function cachedGeo(key, build) {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = build();
    geoCache.set(key, geo);
    shared.add(geo);
  }
  return geo;
}

export function isSharedGeometry(geo) {
  return shared.has(geo);
}

export function geometryCacheSize() {
  return geoCache.size;
}

function meshFrom(geo, mat, pos, rot, cast, receive) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.fromArray(pos);
  mesh.rotation.fromArray(rot);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

export function box(w, h, d, mat, { tile = 4, pos = [0, 0, 0], rot = [0, 0, 0], cast = true, receive = true } = {}) {
  const geo = cachedGeo(`b:${w}|${h}|${d}|${tile}`, () => boxUV(new THREE.BoxGeometry(w, h, d), tile));
  return meshFrom(geo, mat, pos, rot, cast, receive);
}

export function cyl(rTop, rBottom, h, seg = 20, mat = null, { tile = 4, pos = [0, 0, 0], rot = [0, 0, 0], open = false, cast = true, receive = true, uvU } = {}) {
  const geo = cachedGeo(`c:${rTop}|${rBottom}|${h}|${seg}|${open ? 1 : 0}|${tile}|${uvU ?? '-'}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    const circumference = 2 * Math.PI * ((rTop + rBottom) / 2);
    return scaleUV(g, uvU ?? circumference / tile, h / tile);
  });
  return meshFrom(geo, mat, pos, rot, cast, receive);
}

export function cone(r, h, seg = 16, mat = null, { tile = 3, pos = [0, 0, 0], rot = [0, 0, 0], seg1 = 1 } = {}) {
  const geo = cachedGeo(`n:${r}|${h}|${seg}|${seg1}|${tile}`, () => {
    const slant = Math.hypot(r, h);
    return scaleUV(new THREE.ConeGeometry(r, h, seg, seg1), (2 * Math.PI * r) / tile, slant / tile);
  });
  return meshFrom(geo, mat, pos, rot, true, true);
}

/** Row of merlons along local X, centred on the parent. */
export function merlonLine({ length, y = 0, z = 0, mat, height = 1.6, width = 1.35, depth = 0.8, gap = 1.5, seed = 1 }) {
  const pitch = width + gap;
  const count = Math.max(2, Math.round(length / pitch));
  const geo = new THREE.BoxGeometry(width, height, depth);
  boxUV(geo, 2.4);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const random = T.rng(seed);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * pitch;
    p.set(x, y + height / 2, z);
    s.set(1, 1 + random() * 0.14, 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    color.setScalar(0.86 + random() * 0.22);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Ring of merlons on top of a round tower. */
export function merlonRing({ radius, y = 0, mat, height = 1.5, width = 1.2, depth = 0.7, pitch = 2.6 }) {
  const count = Math.max(8, Math.round((2 * Math.PI * radius) / pitch));
  const geo = new THREE.BoxGeometry(width, height, depth);
  boxUV(geo, 2.2);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion();
  const random = T.rng(Math.round(radius * 100) + 7);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    p.set(Math.sin(a) * radius, y + height / 2, Math.cos(a) * radius);
    q.setFromAxisAngle(UP, a);
    s.set(1, 0.9 + random() * 0.3, 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    color.setScalar(0.85 + random() * 0.25);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Ring of small corbels supporting a parapet or a hoarding. */
export function corbelRing({ radius, y = 0, mat, count = 16, size = 0.7, depth = 1.1 }) {
  const geo = new THREE.BoxGeometry(size, size, depth);
  boxUV(geo, 1.6);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    p.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
    q.setFromAxisAngle(UP, a);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  return mesh;
}

export function slitField({ radius, y0, y1, levels = 2, count = 5, mat, seed = 3, width = 0.34, height = 1.9, phase = 0 }) {
  const random = T.rng(seed);
  const items = [];
  for (let l = 0; l < levels; l++) {
    for (let i = 0; i < count; i++) {
      const a = phase + ((i + random() * 0.4) / count) * Math.PI * 2;
      items.push({
        position: new THREE.Vector3(Math.sin(a) * radius, y0 + (l / Math.max(1, levels - 1)) * (y1 - y0), Math.cos(a) * radius),
        quaternion: quatYaw(a),
        scale: new THREE.Vector3(1, 1, 1),
      });
    }
  }
  const geo = new THREE.BoxGeometry(width, height, 0.7);
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  items.forEach((t, i) => {
    m.compose(t.position, t.quaternion, t.scale);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function windowsRing({ radius, y0, y1, levels = 2, count = 4, mat, seed = 5, size = [0.75, 1.25], phase = 0 }) {
  const random = T.rng(seed);
  const geo = new THREE.BoxGeometry(size[0], size[1], 0.35);
  const mesh = new THREE.InstancedMesh(geo, mat, levels * count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  let i = 0;
  for (let l = 0; l < levels; l++) {
    for (let c = 0; c < count; c++, i++) {
      const a = phase + ((c + random() * 0.5) / count) * Math.PI * 2;
      p.set(Math.sin(a) * radius, y0 + (l / Math.max(1, levels - 1)) * (y1 - y0), Math.cos(a) * radius);
      q.setFromAxisAngle(UP, a);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Gabled roof: ridge along local Z, slopes toward ±X. No gable ends — the wall provides them. */
export function gableRoofGeometry(w, d, rise, overhang = 0.5, tile = 3) {
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const slope = Math.hypot(hw, rise);
  const v = {
    a: new THREE.Vector3(-hw, 0, -hd),
    b: new THREE.Vector3(hw, 0, -hd),
    c: new THREE.Vector3(hw, 0, hd),
    e: new THREE.Vector3(-hw, 0, hd),
    r0: new THREE.Vector3(0, rise, -hd),
    r1: new THREE.Vector3(0, rise, hd),
  };
  const quads = [[v.a, v.e, v.r1, v.r0], [v.b, v.r0, v.r1, v.c]];
  const pos = [], uv = [];
  const emit = (p) => {
    pos.push(p.x, p.y, p.z);
    uv.push(p.z / tile, (p.y > 0.001 ? slope : 0) / tile);
  };
  for (const quad of quads) {
    const [p0, p1, p2, p3] = quad;
    const flip = (n => n.y < 0)(new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)));
    const tris = flip
      ? [[p0, p2, p1], [p0, p3, p2]]
      : [[p0, p1, p2], [p0, p2, p3]];
    for (const tri of tris) tri.forEach(emit);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Hipped roof over a rectangle, ridge along local X. */
export function hipRoofGeometry(w, d, rise, ridge = 0.45, overhang = 0.6, tile = 3) {
  const hw = w / 2 + overhang, hd = d / 2 + overhang, rl = ridge * hw;
  const c = [
    new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd),
    new THREE.Vector3(hw, 0, hd), new THREE.Vector3(-hw, 0, hd),
  ];
  const r0 = new THREE.Vector3(-rl, rise, 0), r1 = new THREE.Vector3(rl, rise, 0);
  const slopeZ = Math.hypot(hd, rise), slopeX = Math.hypot(hw - rl, rise);
  const faces = [
    { poly: [c[0], c[1], r1, r0], axis: 'z', slope: slopeZ },
    { poly: [c[3], r0, r1, c[2]], axis: 'z', slope: slopeZ },
    { poly: [c[1], c[2], r1], axis: 'x', slope: slopeX },
    { poly: [c[3], r0, c[0]], axis: 'x', slope: slopeX },
  ];
  const pos = [], uv = [];
  for (const { poly, axis, slope } of faces) {
    const n = new THREE.Vector3().subVectors(poly[1], poly[0]).cross(new THREE.Vector3().subVectors(poly[2], poly[0]));
    const tris = poly.length === 3
      ? (n.y > 0 ? [poly] : [[poly[0], poly[2], poly[1]]])
      : (n.y > 0
        ? [[poly[0], poly[1], poly[2]], [poly[0], poly[2], poly[3]]]
        : [[poly[0], poly[3], poly[2]], [poly[0], poly[2], poly[1]]]);
    for (const tri of tris) {
      for (const p of tri) {
        const apex = p.y > 0.001;
        pos.push(p.x, p.y, p.z);
        uv.push((axis === 'z' ? p.x : p.z) / tile, (apex ? slope : 0) / tile);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

export function cloth({ w = 3, h = 4, segX = 8, segY = 12, mat, pos = [0, 0, 0], rot = [0, 0, 0] }) {
  const geo = new THREE.PlaneGeometry(w, h, segX, segY);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.fromArray(pos);
  mesh.rotation.fromArray(rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const base = Float32Array.from(geo.attributes.position.array);
  mesh.userData.base = base;
  mesh.userData.phase = Math.random() * 6.283;
  // Animated per frame: baking it into a merged batch would freeze the flutter.
  mesh.userData.noMerge = true;
  return mesh;
}

export function flapCloth(mesh, t, amplitude = 0.24, speed = 2.4) {
  const geo = mesh.geometry;
  const attr = geo.attributes.position;
  const base = mesh.userData.base;
  const phase = mesh.userData.phase ?? 0;
  const w = geo.parameters.width;
  const cols = geo.parameters.widthSegments + 1;
  for (let i = 0; i < attr.count; i++) {
    const bx = base[i * 3], by = base[i * 3 + 1];
    const along = Math.min(1, Math.max(0, (bx + w / 2) / w));
    const row = Math.floor(i / cols);
    const wave = Math.sin(t * speed - along * 5.2 + row * 0.28 + phase) * amplitude * Math.pow(along, 0.75);
    attr.setXYZ(i, bx, by, wave + along * along * 0.3);
  }
  attr.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * Fire is drawn by one shared pair of InstancedMeshes instead of a Sprite per
 * flame: ~170 torches, forge coals and beacon fires cost two draw calls.
 * `flame()` returns an invisible marker; the pool reads its world position.
 */
const fireItems = [];
const fireGroup = new THREE.Group();
fireGroup.name = 'fires';
let fireCapacity = -1;
const _fm = new THREE.Matrix4();
const _fp = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _fs = new THREE.Vector3();
const _fc = new THREE.Color();

function visibleUp(obj) {
  let o = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

export function flame({ size = 1.1, color = '#ff9c33', y = 0 }) {
  const marker = new THREE.Object3D();
  marker.position.y = 0;
  marker.userData.flame = { size, color, y, seed: Math.random() * 100, flicker: 0, hidden: false };
  fireItems.push(marker);
  return marker;
}

export function updateFlame(group, t) {
  const f = group && group.userData && group.userData.flame;
  if (!f) return;
  f.flicker = Math.sin(t * 11 + f.seed) * 0.5 + Math.sin(t * 23 + f.seed * 2) * 0.3 + Math.sin(t * 5 + f.seed) * 0.2;
}

export function getFireGroup() {
  return fireGroup;
}

/** Torch a beacon on or off without rebuilding the pool. */
export function setFlameHidden(marker, hidden) {
  const f = marker && marker.userData && marker.userData.flame;
  if (f) f.hidden = !!hidden;
}

export function resetFires() {
  fireItems.length = 0;
}

function buildFireMeshes() {
  const quad = new THREE.PlaneGeometry(1, 1);
  const puff = T.toTexture(T.puff({ size: 96, seed: 3 }), { repeat: 1 });
  const halo = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
    map: puff, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
  }), Math.max(1, fireItems.length));
  const core = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
    map: puff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }), Math.max(1, fireItems.length));
  halo.frustumCulled = false;
  core.frustumCulled = false;
  while (fireGroup.children.length) fireGroup.remove(fireGroup.children[0]);
  fireGroup.add(halo, core);
  return { halo, core };
}

let fireMeshes = null;

export function syncFires(camQuat) {
  if (fireCapacity !== fireItems.length) {
    fireMeshes = buildFireMeshes();
    fireCapacity = fireItems.length;
  }
  if (!fireMeshes) return;
  const { halo, core } = fireMeshes;
  for (let i = 0; i < fireItems.length; i++) {
    const marker = fireItems[i];
    const f = marker.userData.flame;
    const on = visibleUp(marker) && !f.hidden;
    const base = on ? f.size * (2.6 + f.flicker * 0.3) : 0.0001;
    marker.getWorldPosition(_fp);
    _fp.y += f.y + f.size * 0.4;
    _fs.set(base, base, base);
    _fm.compose(_fp, _fq.copy(camQuat), _fs);
    halo.setMatrixAt(i, _fm);
    halo.setColorAt(i, _fc.set(f.color));
    const cs = on ? f.size * (0.62 + f.flicker * 0.09) : 0.0001;
    _fs.set(cs, cs * 1.25, cs);
    _fm.compose(_fp, _fq.copy(camQuat), _fs);
    core.setMatrixAt(i, _fm);
    core.setColorAt(i, _fc.set('#fff3c4'));
  }
  halo.count = fireItems.length;
  core.count = fireItems.length;
  halo.instanceMatrix.needsUpdate = true;
  core.instanceMatrix.needsUpdate = true;
  if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
  if (core.instanceColor) core.instanceColor.needsUpdate = true;
}

export function glowSprite({ size = 3, color = '#ffb347', opacity = 0.85, pos = [0, 0, 0] }) {
  const c = T.softCircle({ inner: 'rgba(255,255,255,1)', outer: 'rgba(255,255,255,0)' });
  const mat = M.sprite({ tag: 'glow', canvas: c, color, opacity });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  sprite.position.fromArray(pos);
  return sprite;
}

export function torchSconce({ mat = null, y = 0, wall = null }) {
  const group = new THREE.Group();
  const wood = mat || M.planks({ tone: '#4a3524' });
  const bracket = box(0.28, 0.7, 0.28, wood, { tile: 1, pos: [0, y + 0.35, 0.35] });
  const shaft = cyl(0.11, 0.13, 1.1, 8, wood, { tile: 1, pos: [0, y + 1.1, 0.5] });
  shaft.rotation.x = 0.35;
  const bowl = cyl(0.34, 0.2, 0.4, 10, M.metal({ color: '#2e2a26' }), { tile: 1, pos: [0, y + 1.7, 0.62] });
  const fire = flame({ size: 0.9, y: y + 1.8 });
  group.add(bracket, shaft, bowl, fire);
  group.userData.flame = fire;
  void wall;
  return group;
}

export function barrel(mat = null) {
  const group = new THREE.Group();
  const wood = mat || M.planks({ tone: '#8a6238', boards: 3 });
  const body = cyl(0.55, 0.55, 1.2, 14, wood, { tile: 1.2, pos: [0, 0.6, 0] });
  const hoopGeo = new THREE.TorusGeometry(0.56, 0.05, 6, 16);
  for (const y of [0.28, 0.92]) {
    const hoop = new THREE.Mesh(hoopGeo, M.metal({ color: '#3b3a38' }));
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    hoop.castShadow = true;
    group.add(hoop);
  }
  group.add(body);
  return group;
}

export function crate(size = 1.2) {
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#9b7b4c', boards: 3 });
  group.add(box(size, size, size, wood, { tile: 1.4, pos: [0, size / 2, 0] }));
  const frame = M.planks({ tone: '#6b5334', boards: 2 });
  for (const [w, h, d, p] of [
    [size * 1.04, 0.14, 0.14, [0, size * 0.2, size / 2]],
    [size * 1.04, 0.14, 0.14, [0, size * 0.8, size / 2]],
    [size * 1.04, 0.14, 0.14, [0, size * 0.2, -size / 2]],
    [size * 1.04, 0.14, 0.14, [0, size * 0.8, -size / 2]],
    [0.14, size, size * 1.04, [size / 2, size / 2, 0]],
    [0.14, size, size * 1.04, [-size / 2, size / 2, 0]],
  ]) group.add(box(w, h, d, frame, { tile: 1, pos: p }));
  return group;
}

export function treePine({ scale = 1, seed = 1, snowless = true } = {}) {
  const random = T.rng(seed);
  const group = new THREE.Group();
  const bark = M.planks({ tone: '#5a4230', boards: 4 });
  const needle = M.foliage({ color: new THREE.Color().setHSL(0.31 + random() * 0.04, 0.42, 0.24 + random() * 0.07).getStyle() });
  const trunk = cyl(0.22, 0.38, 3.4, 7, bark, { tile: 1.5, pos: [0, 1.7, 0] });
  group.add(trunk);
  const layers = 3 + Math.floor(random() * 2);
  for (let i = 0; i < layers; i++) {
    const r = 2.5 * (1 - i / (layers + 0.6));
    const h = 2.6 - i * 0.2;
    group.add(cone(r, h, 8, needle, { tile: 2.4, pos: [0, 3 + i * 1.7, 0] }));
  }
  group.scale.setScalar(scale);
  void snowless;
  return group;
}

export function treeOak({ scale = 1, seed = 2 } = {}) {
  const random = T.rng(seed);
  const group = new THREE.Group();
  const bark = M.planks({ tone: '#6a4d34', boards: 4 });
  const leaf = M.foliage({ color: new THREE.Color().setHSL(0.26 + random() * 0.06, 0.5, 0.3 + random() * 0.1).getStyle() });
  group.add(cyl(0.3, 0.5, 3.2, 7, bark, { tile: 1.6, pos: [0, 1.6, 0] }));
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const blobs = 4 + Math.floor(random() * 3);
  const mesh = new THREE.InstancedMesh(geo, leaf, blobs);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < blobs; i++) {
    const a = random() * Math.PI * 2, r = 0.6 + random() * 1.7;
    p.set(Math.cos(a) * r, 4 + random() * 1.6, Math.sin(a) * r);
    const sc = 1.5 + random() * 1.1;
    s.set(sc, sc * 0.82, sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.scale.setScalar(scale);
  return group;
}

export function bush({ scale = 1, seed = 4, color = '#4a7d3f' } = {}) {
  const random = T.rng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geo, M.foliage({ color }), 3);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    p.set((random() - 0.5) * 1.4, 0.5 + random() * 0.5, (random() - 0.5) * 1.4);
    const sc = (0.7 + random() * 0.6) * scale;
    s.set(sc, sc * 0.8, sc);
    m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random() * 6, random())), s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function rock({ scale = 1, seed = 6 } = {}) {
  const random = T.rng(seed);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mesh = new THREE.Mesh(geo, M.rubble());
  mesh.scale.set(scale * (0.8 + random() * 0.6), scale * (0.5 + random() * 0.4), scale * (0.8 + random() * 0.6));
  mesh.rotation.set(random() * 0.6, random() * 6.283, random() * 0.4);
  mesh.position.y = mesh.scale.y * 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function fenceLine({ length, spacing = 2.2, height = 1.4, mat = null }) {
  const group = new THREE.Group();
  const wood = mat || M.planks({ tone: '#7a6248', boards: 4 });
  const count = Math.max(2, Math.round(length / spacing));
  const postGeo = new THREE.BoxGeometry(0.18, height, 0.18);
  const posts = new THREE.InstancedMesh(postGeo, wood, count);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    p.set((i - (count - 1) / 2) * spacing, height / 2, 0);
    m.compose(p, q, s);
    posts.setMatrixAt(i, m);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  group.add(posts);
  for (const y of [height * 0.45, height * 0.85]) {
    group.add(box(count * spacing, 0.12, 0.1, wood, { tile: 1, pos: [0, y, 0] }));
  }
  return group;
}

export function well({ radius = 1.5 } = {}) {  const group = new THREE.Group();
  const stone = M.stone('warm');
  const wood = M.planks({ tone: '#6d5138' });
  group.add(cyl(radius, radius * 1.06, 1.3, 16, stone, { tile: 2.2, pos: [0, 0.65, 0] }));
  group.add(cyl(radius * 1.08, radius * 1.08, 0.24, 16, stone, { tile: 2, pos: [0, 1.4, 0] }));
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86, 16), M.water({ color: '#123642', opacity: 0.95 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.95;
  group.add(water);
  for (const x of [-radius * 0.8, radius * 0.8]) group.add(box(0.2, 2.4, 0.2, wood, { tile: 1, pos: [x, 2.6, 0] }));
  group.add(cone(radius * 1.25, 1.1, 6, M.shingles({ tone: '#7d3f2f' }), { tile: 1.6, pos: [0, 4.1, 0] }));
  group.add(box(0.16, 0.16, radius * 1.5, wood, { tile: 1, pos: [0, 3.2, 0] }));
  return group;
}

export function campfire({ scale = 1 } = {}) {
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#4b3626', boards: 4 });
  const logGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.8, 6);
  scaleUV(logGeo, 1, 1);
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(logGeo, wood);
    const a = (i / 5) * Math.PI * 2;
    log.position.set(Math.cos(a) * 0.35, 0.2, Math.sin(a) * 0.35);
    log.rotation.set(Math.PI / 2 - 0.5, a, 0);
    log.castShadow = true;
    group.add(log);
  }
  const stoneRing = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.28, 0), M.rubble(), 9);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 0.7, 1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    p.set(Math.cos(a) * 1.15, 0.12, Math.sin(a) * 1.15);
    m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), s);
    stoneRing.setMatrixAt(i, m);
  }
  stoneRing.instanceMatrix.needsUpdate = true;
  stoneRing.castShadow = true;
  stoneRing.receiveShadow = true;
  group.add(stoneRing);
  const fire = flame({ size: 1.6, y: 0.3 });
  group.add(fire);
  const light = new THREE.PointLight('#ff8a3c', 22, 26, 2);
  light.position.y = 1.4;
  group.add(light);
  group.userData.light = light;
  group.userData.fire = fire;
  group.scale.setScalar(scale);
  return group;
}

export function marketStall({ seed = 8, canopy = '#b8433f' } = {}) {
  const random = T.rng(seed);
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#8a6a45' });
  group.add(box(3.4, 0.16, 1.6, wood, { tile: 1.2, pos: [0, 1.1, 0] }));
  group.add(box(3.4, 0.9, 0.12, wood, { tile: 1.2, pos: [0, 0.55, -0.74] }));
  for (const x of [-1.6, 1.6]) for (const z of [-0.7, 0.7]) group.add(box(0.14, 2.5, 0.14, wood, { tile: 1, pos: [x, 1.25, z] }));
  const roof = box(3.9, 0.1, 2.4, M.paint({ color: canopy, roughness: 0.9 }), { tile: 1, pos: [0, 2.55, 0], rot: [-0.32, 0, 0] });
  group.add(roof);
  const goods = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), M.paint({ color: '#d8613a' }), 12);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 0.8, 1);
  for (let i = 0; i < 12; i++) {
    p.set(-1.4 + random() * 2.8, 1.3, -0.5 + random() * 1);
    m.compose(p, new THREE.Quaternion(), s);
    goods.setMatrixAt(i, m);
  }
  goods.instanceMatrix.needsUpdate = true;
  goods.castShadow = true;
  group.add(goods);
  return group;
}

export function quintain({ seed = 12 } = {}) {
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#7c6044' });
  group.add(cyl(0.28, 0.36, 3.4, 8, wood, { tile: 1.4, pos: [0, 1.7, 0] }));
  const arm = box(3.6, 0.22, 0.22, wood, { tile: 1, pos: [0, 3.1, 0] });
  arm.userData.noMerge = true;
  group.add(arm);
  const shield = box(0.9, 1.2, 0.14, M.paint({ color: '#a63a34' }), { tile: 1, pos: [-1.7, 2.9, 0] });
  const sack = cyl(0.42, 0.42, 0.9, 10, M.paint({ color: '#c8b487' }), { tile: 1, pos: [1.7, 2.8, 0] });
  group.add(shield, sack);
  group.userData.arm = arm;
  group.userData.seed = seed;
  return group;
}

export function tent({ scale = 1, color = '#b79a6a', seed = 2 } = {}) {
  const random = T.rng(seed);
  const group = new THREE.Group();
  const canvasMat = M.paint({ color, roughness: 0.95 });
  const body = cone(2.2 * scale, 2.6 * scale, 7, canvasMat, { tile: 2, pos: [0, 1.3 * scale, 0] });
  group.add(body);
  group.add(box(0.1, 3.2 * scale, 0.1, M.planks({ tone: '#6b5540' }), { tile: 1, pos: [0, 1.6 * scale, 0] }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + random();
    const rope = cyl(0.03, 0.03, 2.4 * scale, 4, M.planks({ tone: '#c9b48a' }), { tile: 1, pos: [Math.cos(a) * 1.4 * scale, 1.1 * scale, Math.sin(a) * 1.4 * scale] });
    rope.rotation.z = Math.cos(a) * 0.6;
    rope.rotation.x = -Math.sin(a) * 0.6;
    group.add(rope);
  }
  return group;
}

export function cart({ seed = 3 } = {}) {
  const group = new THREE.Group();
  const wood = M.planks({ tone: '#7a5a38' });
  group.add(box(3.4, 0.9, 2, wood, { tile: 1.2, pos: [0, 1.2, 0] }));
  group.add(box(3.6, 0.16, 2.2, wood, { tile: 1.2, pos: [0, 0.72, 0] }));
  const wheelGeo = new THREE.TorusGeometry(0.75, 0.12, 6, 14);
  for (const [x, z] of [[-1.2, 1.1], [1.2, 1.1], [-1.2, -1.1], [1.2, -1.1]]) {
    const wheel = new THREE.Mesh(wheelGeo, wood);
    wheel.position.set(x, 0.75, z);
    wheel.castShadow = true;
    group.add(wheel);
    const spokes = box(1.4, 0.09, 0.09, wood, { tile: 1, pos: [x, 0.75, z], rot: [0, 0, 0.7] });
    group.add(spokes);
  }
  group.add(box(0.14, 0.14, 2.4, wood, { tile: 1, pos: [1.9, 1, 0], rot: [0, 0, -0.25] }));
  void seed;
  return group;
}

export function reeds({ count = 60, mat = null, seed = 5 }) {
  const random = T.rng(seed);
  const geo = new THREE.ConeGeometry(0.08, 2.2, 3, 1, true);
  const mesh = new THREE.InstancedMesh(geo, mat || M.foliage({ color: '#4d6b3c' }), count);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.set((random() - 0.5) * 24, 0.9 + random() * 0.4, (random() - 0.5) * 6);
    q.setFromEuler(new THREE.Euler(random() * 0.25 - 0.12, random() * 6.283, random() * 0.25 - 0.12));
    const sc = 0.7 + random() * 0.9;
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function bannerPole({ height = 7, faction, baseY = 0 }) {
  const group = new THREE.Group();
  group.add(cyl(0.11, 0.14, height, 8, M.planks({ tone: '#5c4530' }), { tile: 1, pos: [0, baseY + height / 2, 0] }));
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.metal({ color: '#c8a44a', roughness: 0.3, metalness: 1 })));
  group.children[1].position.y = baseY + height + 0.2;
  const flag = cloth({ w: height * 0.42, h: height * 0.55, segX: 6, segY: 8, mat: faction.mat, pos: [height * 0.22, baseY + height * 0.78, 0], rot: [0, Math.PI / 2, 0] });
  group.add(flag);
  group.userData.flag = flag;
  return group;
}

/** Roofed well head for a courtyard. */
export function wellHouse() {
  const g = new THREE.Group();
  g.add(well({ radius: 1.4 }));
  const wood = M.planks({ tone: '#5b4630', boards: 3 });
  for (const s of [-1, 1]) g.add(cyl(0.11, 0.14, 2.6, 5, wood, { tile: 0.8, pos: [s * 1.5, 1.3, 0] }));
  const roof = new THREE.Mesh(gableRoofGeometry(3.8, 2.6, 0.9, 0.4, 3), M.shingles({ tone: '#4b6168' }));
  roof.position.y = 2.6;
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);
  return g;
}

/** Round dovecote with flight holes. */
export function dovecote() {
  const g = new THREE.Group();
  g.add(cyl(1.6, 1.8, 3.2, 12, M.stone('warm'), { tile: 2, pos: [0, 1.6, 0] }));
  g.add(cone(2.1, 1.6, 12, M.thatch({ tone: '#a8894a' }), { tile: 1.4, pos: [0, 4, 0] }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(box(0.4, 0.3, 0.12, M.paint({ color: '#2a2622', roughness: 1 }), { tile: 0.4, pos: [Math.cos(a) * 1.7, 2.4, Math.sin(a) * 1.7], rot: [0, -a, 0] }));
  }
  g.add(box(0.7, 1.1, 0.16, M.planks({ tone: '#5b4630' }), { tile: 0.6, pos: [0, 0.55, 1.75] }));
  return g;
}

/** Open-sided stable with a manger and tie rings. */
export function stable() {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5540', boards: 4 });
  for (const s of [-1, 1]) {
    for (const z of [-3, 0, 3]) g.add(cyl(0.16, 0.2, 3, 6, wood, { tile: 0.9, pos: [s * 2.2, 1.5, z] }));
  }
  const roof = new THREE.Mesh(gableRoofGeometry(5, 7.4, 1.4, 0.5, 3), M.thatch({ tone: '#a8894a' }));
  roof.position.y = 3;
  g.add(roof);
  g.add(box(4.6, 0.4, 0.5, wood, { tile: 1, pos: [0, 0.9, -2.6] }));
  for (const z of [-1.5, 0.5, 2.5]) {
    g.add(cyl(0.07, 0.09, 1.4, 5, M.metal({ color: '#4a4741', metalness: 0.7, roughness: 0.5 }), { tile: 0.5, pos: [2.2, 1.9, z] }));
  }
  g.add(cone(1.1, 1.6, 7, M.thatch({ tone: '#c3a05c' }), { tile: 1.4, pos: [-1.4, 0.8, 3.4] }));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Granary on staddle posts, raised off the damp ground. */
export function granary() {
  const g = new THREE.Group();
  const wood = M.planks({ tone: '#6b5540', boards: 4 });
  for (const s of [-1, 1]) {
    for (const z of [-2.2, 2.2]) {
      g.add(cyl(0.22, 0.26, 1.5, 6, wood, { tile: 0.9, pos: [s * 2.1, 0.75, z] }));
      g.add(cyl(0.42, 0.46, 0.2, 8, M.stone('grey'), { tile: 0.6, pos: [s * 2.1, 1.55, z] }));
    }
  }
  g.add(box(5, 2.6, 5.4, M.stone('warm'), { tile: 3, pos: [0, 2.9, 0] }));
  const roof = new THREE.Mesh(gableRoofGeometry(5.8, 6.2, 1.8, 0.5, 3), M.shingles({ tone: '#5d6b52' }));
  roof.position.y = 4.2;
  g.add(roof);
  g.add(box(1.1, 1.6, 0.14, wood, { tile: 0.8, pos: [0, 2.9, 2.75] }));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Row of shields hung along a wall face. */
export function shieldRow({ length, y = 0, count = 6, faction }) {
  const g = new THREE.Group();
  const mat = M.bannerMaterial({ base: faction.base, accent: faction.accent, motif: faction.motif, seed: 13 });
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1) - 0.5) * length;
    g.add(box(0.9, 1.3, 0.12, mat, { tile: 0.6, pos: [x, y, 0.08] }));
  }
  return g;
}
