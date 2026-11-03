import * as THREE from 'three';

/**
 * Closed rounded-rectangle loop in the XZ plane, counter-clockwise, `segs` points per corner.
 * Every ring of a section shares this vertex count so bands can be stitched column by column.
 */
export function roundedRectRing(hx, hz, r = 6, segs = 6) {
  r = Math.max(0.01, Math.min(r, Math.min(hx, hz) - 0.01));
  const corners = [
    [-hx + r, -hz + r, Math.PI, Math.PI * 1.5],
    [hx - r, -hz + r, Math.PI * 1.5, Math.PI * 2],
    [hx - r, hz - r, 0, Math.PI * 0.5],
    [-hx + r, hz - r, Math.PI * 0.5, Math.PI],
  ];
  const pts = [];
  for (const [cx, cz, a0, a1] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      pts.push(new THREE.Vector3(cx + r * Math.cos(a), 0, cz + r * Math.sin(a)));
    }
  }
  return pts;
}

export function ringAt(pts, y) {
  return pts.map((p) => new THREE.Vector3(p.x, y, p.z));
}

/** Quads between consecutive rings; each quad is wound so its face normal points up. */
export function buildBandGeometry(rings, uvScale = 8) {
  const count = rings[0].pts.length;
  const pos = [];
  const uv = [];
  const idx = [];
  const u = new Float32Array(count);
  for (let i = 1; i < count; i++) u[i] = u[i - 1] + rings[0].pts[i].distanceTo(rings[0].pts[i - 1]);
  const vStart = [0];
  for (let k = 0; k < rings.length - 1; k++) {
    let acc = 0;
    for (let i = 0; i < count; i++) acc += rings[k].pts[i].distanceTo(rings[k + 1].pts[i]);
    vStart.push(vStart[k] + acc / count);
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
  const ab = new THREE.Vector3(), ad = new THREE.Vector3();
  for (let k = 0; k < rings.length - 1; k++) {
    const y0 = rings[k].y, y1 = rings[k + 1].y;
    const base = pos.length / 3;
    for (let i = 0; i < count; i++) {
      const p = rings[k].pts[i], q = rings[k + 1].pts[i];
      pos.push(p.x, y0, p.z);
      uv.push(u[i] / uvScale, vStart[k] / uvScale);
      pos.push(q.x, y1, q.z);
      uv.push(u[i] / uvScale, vStart[k + 1] / uvScale);
    }
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const i0 = base + i * 2, i1 = base + j * 2;
      a.fromArray(pos, i0 * 3);
      b.fromArray(pos, i1 * 3);
      d.fromArray(pos, (i0 + 1) * 3);
      ab.subVectors(b, a);
      ad.subVectors(d, a);
      n.crossVectors(ab, ad);
      if (n.y >= 0) idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      else idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat cap (water surface, courtyard floor) from a loop; optional holes. */
export function buildCapGeometry(pts, y, holes = []) {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    hole.forEach((p, i) => (i === 0 ? path.moveTo(p.x, -p.z) : path.lineTo(p.x, -p.z)));
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ShapeGeometry(shape, 12);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

export function applyPlanarUV(geo, scale = 12) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / scale;
    uv[i * 2 + 1] = pos.getZ(i) / scale;
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

export function instanceBox({ geometry, material, transforms, colors }) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const m = new THREE.Matrix4();
  transforms.forEach((t, i) => {
    m.compose(t.position, t.quaternion, t.scale ?? new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, colors[i]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function quatYaw(yaw) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

export function lerpPath(points, count) {
  const out = [];
  const segs = points.length;
  let total = 0;
  const lens = [];
  for (let i = 0; i < segs; i++) {
    const a = points[i], b = points[(i + 1) % segs];
    const l = a.distanceTo(b);
    lens.push(l);
    total += l;
  }
  for (let i = 0; i < count; i++) {
    let target = (i / count) * total;
    let s = 0;
    while (s < segs - 1 && target > lens[s]) {
      target -= lens[s];
      s++;
    }
    const a = points[s], b = points[(s + 1) % segs];
    out.push(a.clone().lerp(b, lens[s] ? target / lens[s] : 0));
  }
  return out;
}

/** Open polyline resampled to a fixed step, so ribbons get even quads. */
export function resample(points, step = 4) {
  const out = [points[0].clone()];
  let need = step;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const segLen = a.distanceTo(b);
    if (!segLen) continue;
    acc += segLen;
    while (acc >= need) {
      const t = Math.min(1, (need - (acc - segLen)) / segLen);
      out.push(a.clone().lerp(b, t));
      need += step;
    }
  }
  const last = points[points.length - 1];
  if (out[out.length - 1].distanceTo(last) > step * 0.3) out.push(last.clone());
  return out;
}

/**
 * Strip along an XZ spine: roads, river, leats. `half` may be constant or a
 * function of the along-track distance; `yFn` lets the ribbon hug the terrain.
 */
export function ribbonGeometry(spine, half = 3, yFn = () => 0, uvScale = 8, offsetY = 0) {
  const pts = spine;
  const pos = [];
  const uv = [];
  const idx = [];
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  let along = 0;
  const sides = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    t.set(next.x - prev.x, 0, next.z - prev.z);
    if (t.lengthSq() < 1e-8) t.set(1, 0, 0);
    t.normalize();
    n.set(-t.z, 0, t.x);
    if (i > 0) along += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const hw = typeof half === 'function' ? half(along, i / (pts.length - 1)) : half;
    const y = yFn(pts[i].x, pts[i].z) + offsetY;
    pos.push(pts[i].x + n.x * hw, y, pts[i].z + n.z * hw);
    pos.push(pts[i].x - n.x * hw, y, pts[i].z - n.z * hw);
    uv.push(along / uvScale, 0, along / uvScale, 1);
    sides.push(along);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  void sides;
  return geo;
}

const MERGE_ATTRS = ['position', 'normal', 'uv'];
const INSTANCE_BUDGET = 4096;
const INSTANCE_LIMIT = 64;

/**
 * Bake a subtree into one mesh per material. Plain meshes and small
 * InstancedMeshes (merlons, palisade stakes, bridge planks) both go in; large
 * or animated instanced populations must stay instances and are left alone.
 * Per-instance tints survive as vertex colors on a cloned material.
 */
export function mergeStatic(root, target = root) {
  const buckets = new Map();
  const absorbed = [];
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();

  const addPart = (material, geometry, tint, cast, receive) => {
    if (!buckets.has(material.uuid)) {
      buckets.set(material.uuid, { material, parts: [], colored: false, cast: false, receive: false });
    }
    const b = buckets.get(material.uuid);
    b.parts.push({ geometry, tint });
    if (tint) b.colored = true;
    b.cast ||= cast;
    b.receive ||= receive;
  };

  root.traverse((obj) => {
    if (obj === root || obj.userData.noMerge) return;
    const material = obj.isMesh && !Array.isArray(obj.material) ? obj.material : null;
    if (!material || !obj.geometry) return;
    if (!MERGE_ATTRS.every((name) => obj.geometry.attributes[name])) return;
    if (!obj.geometry.index && !obj.isInstancedMesh && obj.geometry.attributes.position.count < 4) return;
    obj.updateWorldMatrix(true, false);

    if (obj.isInstancedMesh) {
      const per = obj.geometry.attributes.position.count;
      if (obj.count > INSTANCE_LIMIT || per * obj.count > INSTANCE_BUDGET) return;
      const base = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, local);
        world.multiplyMatrices(obj.matrixWorld, local);
        const g = base.clone();
        g.applyMatrix4(world);
        const tint = obj.instanceColor ? new THREE.Color().fromArray(obj.instanceColor.array, i * 3) : null;
        addPart(material, g, tint, obj.castShadow, obj.receiveShadow);
      }
      base.dispose();
      absorbed.push(obj);
      return;
    }

    const src = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    src.applyMatrix4(obj.matrixWorld);
    addPart(material, src, null, obj.castShadow, obj.receiveShadow);
    absorbed.push(obj);
  });

  if (!buckets.size) return 0;
  for (const obj of absorbed) if (obj.parent) obj.parent.remove(obj);

  const white = new THREE.Color(1, 1, 1);
  for (const bucket of buckets.values()) {
    let vertexCount = 0;
    for (const part of bucket.parts) vertexCount += part.geometry.attributes.position.count;
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const uv = new Float32Array(vertexCount * 2);
    const color = bucket.colored ? new Float32Array(vertexCount * 3) : null;
    let offset = 0;
    for (const part of bucket.parts) {
      const count = part.geometry.attributes.position.count;
      const pa = part.geometry.attributes.position.array;
      const na = part.geometry.attributes.normal.array;
      const ua = part.geometry.attributes.uv.array;
      position.set(pa.subarray(0, count * 3), offset * 3);
      normal.set(na.subarray(0, count * 3), offset * 3);
      uv.set(ua.subarray(0, count * 2), offset * 2);
      if (color) {
        const t = part.tint || white;
        for (let i = 0; i < count; i++) color.set([t.r, t.g, t.b], (offset + i) * 3);
      }
      offset += count;
      part.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    let material = bucket.material;
    if (color) {
      material = material.clone();
      material.vertexColors = true;
      geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    // Already a batch: an outer merge pass must leave it where it is.
    mesh.userData.noMerge = true;
    target.add(mesh);
  }
  return buckets.size;
}
/**
 * Move every mesh smaller than `maxDim` into `target` so it can be hidden on
 * the wide map view. World transform is baked into the object's own
 * position/quaternion/scale, which makes the move safe out of translated and
 * rotated sub-groups.
 */
export function splitBySize(root, target, maxDim = 1.7) {
  const moved = [];
  const size = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || obj.userData.noMerge || obj.userData.keepDetail) return;
    if (!MERGE_ATTRS.every((name) => obj.geometry.attributes[name])) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    obj.geometry.boundingBox.getSize(size);
    obj.getWorldScale(scale);
    const max = Math.max(size.x * scale.x, size.y * scale.y, size.z * scale.z);
    if (max <= maxDim) moved.push(obj);
  });
  for (const obj of moved) {
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(pos, quat, scale);
    obj.position.copy(pos);
    obj.quaternion.copy(quat);
    obj.scale.copy(scale);
    obj.parent.remove(obj);
    target.add(obj);
  }
  return moved.length;
}
