import * as THREE from 'three';
import * as T from './textures.js';

/**
 * Shared instanced-population kit: a template is a handful of low-poly parts
 * baked into ONE vertex-colored geometry, then drawn as a single InstancedMesh
 * no matter how many individuals walk around. Used by the livestock, the folk
 * and the garrison drill.
 */

export const agentMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Bake a list of {geo, pos, rot, scale, color} into one vertex-colored geometry. */
export function templateGeometry(parts) {
  const position = [];
  const normal = [];
  const color = [];
  for (const part of parts) {
    const src = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    _e.set(...(part.rot || [0, 0, 0]));
    _m.compose(
      _p.set(...(part.pos || [0, 0, 0])),
      _q.setFromEuler(_e),
      _s.set(...(part.scale || [1, 1, 1])),
    );
    src.applyMatrix4(_m);
    const pa = src.attributes.position.array;
    const na = src.attributes.normal.array;
    _c.set(part.color || '#8a8a8a');
    for (let i = 0; i < src.attributes.position.count; i++) {
      position.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      normal.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
      color.push(_c.r, _c.g, _c.b);
    }
    src.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  return geo;
}

export const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  ball: (r) => new THREE.SphereGeometry(r, 7, 5),
  cone: (r, h) => new THREE.ConeGeometry(r, h, 6),
  cyl: (r, h) => new THREE.CylinderGeometry(r, r, h, 6),
};

/** Quadruped facing +X: body, head, legs, optional tail, hump, mane, horns. */
export function quadruped({ body, head, legs = 4, size = 1, tail = null, hump = null, mane = null, horns = null }) {
  const parts = [
    { geo: G.ball(0.62), pos: [0, 0.78, 0], scale: [1.5, 0.92, 0.86], color: body },
    { geo: G.ball(0.3), pos: [0.92 * size, 1.02, 0], scale: [1.1, 1, 0.9], color: head },
  ];
  if (legs === 4) {
    for (const [x, z] of [[0.5, 0.28], [0.5, -0.28], [-0.5, 0.28], [-0.5, -0.28]]) {
      parts.push({ geo: G.cyl(0.09, 0.62), pos: [x, 0.31, z], color: head });
    }
  }
  if (tail) parts.push({ geo: G.cone(0.09, 0.5), pos: [-0.95, 0.85, 0], rot: [0, 0, 0.9], color: head });
  if (hump) parts.push({ geo: G.ball(0.28), pos: [0.1, 1.22, 0], scale: [1.3, 0.9, 1], color: head });
  if (mane) parts.push({ geo: G.box(0.22, 0.42, 0.34), pos: [0.66, 1.2, 0], color: mane });
  if (horns) {
    for (const z of [0.16, -0.16]) {
      parts.push({ geo: G.cone(0.06, 0.42), pos: [1, 1.32, z], rot: [z > 0 ? -0.4 : 0.4, 0, -0.3], color: horns });
    }
  }
  return templateGeometry(parts);
}

/** Biped in a robe facing +X. `prop` is an extra part (tool, spear, bundle). */
export function figure({ robe, skin = '#c99a6c', height = 1, bend = 0, hat = null, prop = null, pack = null }) {
  const parts = [{ geo: G.cone(0.44, 1.5), pos: [0, 0.75, 0], scale: [1, height, 1], color: robe }];
  const lean = bend;
  parts.push({ geo: G.ball(0.24), pos: [0.34 * Math.sin(lean), 1.62 * height - 0.3 * (1 - Math.cos(lean)), 0], color: skin });
  if (hat) parts.push({ geo: G.cyl(0.3, 0.1), pos: [0.34 * Math.sin(lean), 1.8 * height - 0.3 * (1 - Math.cos(lean)), 0], color: hat });
  if (pack) parts.push({ geo: G.ball(0.3), pos: [-0.3, 1.1 * height, 0], scale: [1, 0.8, 1], color: pack });
  if (prop) parts.push({ ...prop, color: prop.color || '#6b5540' });
  return templateGeometry(parts);
}

export function bird({ body, beak, wings = false, neck = 0 }) {
  const parts = [
    { geo: G.ball(0.3), pos: [0, 0.34, 0], scale: [1.5, 1, 1], color: body },
    { geo: G.ball(0.14), pos: [0.42, 0.5 + neck, 0], color: body },
    { geo: G.cone(0.07, 0.2), pos: [0.58, 0.5 + neck, 0], rot: [0, 0, -Math.PI / 2], color: beak },
  ];
  if (wings) {
    for (const z of [0.22, -0.22]) {
      parts.push({ geo: G.box(0.42, 0.05, 0.26), pos: [-0.02, 0.44, z], rot: [z > 0 ? 0.3 : -0.3, 0, 0], color: body });
    }
  }
  if (neck) parts.push({ geo: G.cyl(0.08, 0.34), pos: [0.3, 0.42 + neck / 2, 0], rot: [0, 0, -0.5], color: body });
  return templateGeometry(parts);
}

/** Free agents that mill about a home spot. */
export function wanderers(parent, spec) {
  const random = T.rng(spec.seed);
  const count = spec.count;
  const mesh = new THREE.InstancedMesh(spec.geo, agentMaterial, count);
  mesh.castShadow = spec.shadow !== false;
  const agents = [];
  for (let i = 0; i < count; i++) {
    const home = spec.spot(i, random);
    agents.push({
      x: home.x, z: home.z, hx: home.x, hz: home.z,
      r: home.r ?? spec.radius ?? 8,
      heading: random() * Math.PI * 2,
      speed: (spec.speed ?? 1.1) * (0.7 + random() * 0.7),
      wobble: 0.5 + random() * 1.4,
      phase: random() * 6.283,
      scale: (spec.scale ?? 1) * (0.85 + random() * 0.35),
      y: spec.y ?? 0,
      float: spec.float || 0,
    });
    mesh.setColorAt(i, _c.set(spec.tint ? spec.tint(i, random) : '#ffffff'));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.noMerge = true;
  parent.add(mesh);
  const groundY = spec.heightAt || (() => 0);
  return {
    mesh,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const a = agents[i];
        a.heading += Math.sin(t * a.wobble + a.phase) * dt * 1.7;
        const graze = spec.graze ? Math.max(0, Math.sin(t * 0.5 + a.phase)) : 1;
        const step = a.speed * graze * dt;
        let nx = a.x + Math.cos(a.heading) * step;
        let nz = a.z + Math.sin(a.heading) * step;
        if (Math.hypot(nx - a.hx, nz - a.hz) > a.r) {
          a.heading = Math.atan2(a.hz - a.z, a.hx - a.x) + (a.phase % 1 - 0.5) * 0.6;
          nx = a.x;
          nz = a.z;
        }
        a.x = nx;
        a.z = nz;
        const bob = Math.abs(Math.sin(t * a.wobble * 4 + a.phase)) * (a.float ? 0.02 : 0.05);
        const y = a.float ? a.y + Math.sin(t * 1.1 + a.phase) * a.float : groundY(a.x, a.z) + a.y;
        _e.set(0, -a.heading, Math.sin(t * a.wobble * 4 + a.phase) * 0.04);
        _q.setFromEuler(_e);
        _m.compose(_p.set(a.x, y + bob, a.z), _q, _s.set(a.scale, a.scale, a.scale));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Agents that walk a fixed circuit. */
export function loopers(parent, spec) {
  const random = T.rng(spec.seed);
  const pts = spec.loop;
  const lens = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    lens.push(l);
    total += l;
  }
  const at = (k) => {
    let target = ((k % 1) + 1) % 1 * total;
    for (let i = 0; i < pts.length; i++) {
      if (target <= lens[i]) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const t = lens[i] ? target / lens[i] : 0;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, hx: b.x - a.x, hz: b.z - a.z };
      }
      target -= lens[i];
    }
    return { x: pts[0].x, z: pts[0].z, hx: 1, hz: 0 };
  };
  const count = spec.count;
  const mesh = new THREE.InstancedMesh(spec.geo, agentMaterial, count);
  mesh.castShadow = true;
  mesh.userData.noMerge = true;
  const agents = [];
  for (let i = 0; i < count; i++) {
    agents.push({
      progress: i / count + random() * 0.04,
      speed: (spec.speed ?? 1.4) / total,
      wobble: 0.7 + random() * 0.8,
      phase: random() * 6.283,
      scale: (spec.scale ?? 1) * (0.92 + random() * 0.16),
      offset: (random() - 0.5) * (spec.spread ?? 0),
    });
    mesh.setColorAt(i, _c.set(spec.tint ? spec.tint(i, random) : '#ffffff'));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
  const groundY = spec.heightAt || (() => 0);
  return {
    mesh,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const a = agents[i];
        a.progress += dt * a.speed;
        const p = at(a.progress);
        const len = Math.hypot(p.hx, p.hz) || 1;
        const x = p.x + (-p.hz / len) * a.offset;
        const z = p.z + (p.hx / len) * a.offset;
        const bob = Math.abs(Math.sin(t * a.wobble * 3 + a.phase)) * 0.07;
        _e.set(0, Math.atan2(p.hx, p.hz), Math.sin(t * a.wobble * 3 + a.phase) * 0.05);
        _q.setFromEuler(_e);
        _m.compose(_p.set(x, groundY(x, z) + bob, z), _q, _s.set(a.scale, a.scale, a.scale));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
