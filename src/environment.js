import * as THREE from 'three';
import * as T from './textures.js';
import * as M from './materials.js';
import { roundedRectRing, buildBandGeometry, buildCapGeometry, applyPlanarUV } from './geometry.js';
import { EXTENT } from './layout.js';
import { onTick } from './runtime.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform vec3 horizon;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float night;
uniform float star;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031 + vec3(0.11, 0.17, 0.19));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float t = pow(h, 0.42);
  vec3 col = mix(horizon, mix(bottomColor, topColor, t), t);
  vec3 sd = normalize(sunDir);
  float facing = dot(d, sd);
  float disc = smoothstep(0.9990, 0.99955, facing);
  float halo = pow(max(facing, 0.0), 120.0) * 0.5 + pow(max(facing, 0.0), 14.0) * 0.1;
  col += sunColor * mix(halo + disc * 1.4, disc * 0.5 + halo * 0.35, night);
  float land = smoothstep(-0.02, -0.25, d.y);
  col = mix(col, horizon * 0.75, land);
  vec3 cell = floor(d * 260.0);
  float s = step(0.9975, hash13(cell)) * step(0.03, d.y) * star;
  float twinkle = 0.6 + 0.4 * hash13(cell + 7.0);
  col += vec3(0.85, 0.9, 1.0) * s * twinkle * 2.4;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(uniforms) {
  const geo = new THREE.SphereGeometry(1400, 40, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function rings(cfg) {
  const s = cfg.site;
  const R = (half, r = 10) => roundedRectRing(half, half, r, 8);
  return {
    plain: { pts: R(s.moatOuterHalf + 9, 16), y: s.plainY },
    lip: { pts: R(s.moatOuterHalf, 14), y: s.plainY + 0.45 },
    trenchOuter: { pts: R(s.moatOuterHalf - 4.2, 11), y: s.moatBottomY },
    trenchInner: { pts: R(s.cragHalf + 4.4, 7), y: s.moatBottomY },
    cragFoot: { pts: R(s.cragHalf + 1.8, 5.5), y: s.moatBottomY + 0.5 },
    cragMid: { pts: R(s.cragHalf + 1.2, 5), y: -0.6 },
    cragTop: { pts: R(s.cragHalf + 0.6, 4.6), y: s.cragTopY },
    platform: { pts: R(s.cragHalf + 0.2, 4.4), y: s.cragTopY + 0.02 },
    waterOuter: R(s.moatOuterHalf - 0.4, 13),
    waterInner: R(s.cragHalf + 1.5, 6),
  };
}

export function buildSite(cfg, L) {
  const group = new THREE.Group();
  const s = cfg.site;
  const RG = rings(cfg);
  const grass = M.ground({ tone: cfg.hillTone });
  const terrainMat = grass.clone();
  terrainMat.vertexColors = true;

  const extent = EXTENT;
  const chunks = 4;
  const per = 52;
  const size = extent / chunks;
  const color = new THREE.Color();
  for (let cz = 0; cz < chunks; cz++) {
    for (let cx = 0; cx < chunks; cx++) {
      const geo = new THREE.PlaneGeometry(size, size, per, per);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-extent / 2 + (cx + 0.5) * size, 0, -extent / 2 + (cz + 0.5) * size);
      applyPlanarUV(geo, 11);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, L.groundY(pos.getX(i), pos.getZ(i)));
      }
      for (let i = 0; i < pos.count; i++) {
        L.biomeAt(pos.getX(i), pos.getZ(i), pos.getY(i), color);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, terrainMat);
      mesh.receiveShadow = true;
      mesh.position.y = s.plainY;
      group.add(mesh);
    }
  }

  const banks = new THREE.Mesh(
    buildBandGeometry([RG.plain, RG.lip, RG.trenchOuter, RG.trenchInner], 7),
    M.ground({ tone: 'path' }),
  );
  banks.receiveShadow = true;
  banks.castShadow = false;
  group.add(banks);

  const inner = new THREE.Mesh(
    buildBandGeometry(
      [{ pts: RG.trenchInner.pts, y: s.moatBottomY }, RG.cragFoot, RG.cragMid, RG.cragTop, RG.platform],
      5.5,
    ),
    M.rubble(),
  );
  inner.receiveShadow = true;
  inner.castShadow = true;
  group.add(inner);

  const platformCap = new THREE.Mesh(buildCapGeometry(RG.platform.pts, s.cragTopY), M.ground({ tone: 'green' }));
  applyPlanarUV(platformCap.geometry, 8);
  platformCap.receiveShadow = true;
  group.add(platformCap);

  const cliffLip = new THREE.Mesh(
    buildBandGeometry([{ pts: RG.cragTop.pts, y: s.cragTopY - 0.35 }, { pts: RG.cragTop.pts.map((p) => new THREE.Vector3(p.x * 1.012, 0, p.z * 1.012)), y: s.cragTopY + 0.05 }], 6),
    M.rubble(),
  );
  cliffLip.receiveShadow = true;
  group.add(cliffLip);

  const waterMat = M.water({ color: cfg.stoneKind === 'cool' ? '#1d4a5c' : '#20505a' });
  const waterGeo = buildCapGeometry(RG.waterOuter, s.waterY, [RG.waterInner]);
  applyPlanarUV(waterGeo, 15);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.renderOrder = 2;
  group.add(water);

  const foamCanvas = T.foam({ seed: 12 });
  const foamMat = new THREE.MeshBasicMaterial({
    map: T.toTexture(foamCanvas, { repeat: 1 }),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const foamInner = new THREE.Mesh(
    buildBandGeometry([
      { pts: RG.waterInner.map((p) => p.clone().multiplyScalar(1.001)), y: s.waterY + 0.06 },
      { pts: RG.waterInner.map((p) => p.clone().multiplyScalar(1.075)), y: s.waterY + 0.02 },
    ], 4),
    foamMat,
  );
  foamInner.renderOrder = 3;
  group.add(foamInner);
  const foamOuter = new THREE.Mesh(
    buildBandGeometry([
      { pts: RG.waterOuter.map((p) => p.clone().multiplyScalar(0.985)), y: s.waterY + 0.02 },
      { pts: RG.waterOuter.map((p) => p.clone().multiplyScalar(0.925)), y: s.waterY + 0.06 },
    ], 4),
    foamMat,
  );
  foamOuter.renderOrder = 3;
  group.add(foamOuter);

  onTick((t, dt) => {
    const nmap = waterMat.normalMap;
    nmap.offset.x = (nmap.offset.x + dt * 0.012) % 1;
    nmap.offset.y = (nmap.offset.y + dt * 0.0075) % 1;
    foamMat.map.offset.x = (foamMat.map.offset.x - dt * 0.021) % 1;
    foamMat.map.offset.y = (foamMat.map.offset.y + dt * 0.014) % 1;
    water.position.y = s.waterY + Math.sin(t * 0.6) * 0.02;
    void dt;
  });

  scatterVegetation(group, cfg, s, L);
  addGrassTufts(group, cfg, s);
  return { group, water, foamMat, waterMat, terrainMat };
}

function inMoat(x, z, s, pad = 2) {
  const innerX = s.cragHalf + pad, outerX = s.moatOuterHalf + pad;
  const ax = Math.abs(x), az = Math.abs(z);
  const inside = Math.max(ax, az);
  const outside = Math.min(ax, az);
  return inside > innerX && inside < outerX && outside < outerX - 2;
}

function scatterVegetation(group, cfg, s, L) {
  const random = T.rng(cfg.seed + 404);
  const grove = T.fbm(cfg.seed + 61, 7);
  const pine = { trunk: new THREE.CylinderGeometry(0.3, 0.5, 3.6, 6), crown1: new THREE.ConeGeometry(2.6, 4.4, 8), crown2: new THREE.ConeGeometry(1.7, 3.6, 8) };
  const oak = { trunk: new THREE.CylinderGeometry(0.36, 0.6, 3.2, 6), blob: new THREE.IcosahedronGeometry(2.1, 1), blob2: new THREE.IcosahedronGeometry(1.5, 1) };
  const barkMat = M.planks({ tone: '#57432f', boards: 4 });
  const pineMat = M.foliage({ color: '#2f5f34' });
  const oakMat = M.foliage({ color: '#4c7d38' });
  const transforms = { pineTrunk: [], pineA: [], pineB: [], oakTrunk: [], oakA: [], oakB: [], rock: [], reed: [], bush: [] };
  const colors = { pine: [], oak: [], rock: [], bush: [] };
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const c = new THREE.Color();
  const maxR = 332;
  const target = cfg.forestDensity + 230;
  let guard = 0;
  let placed = 0;
  while (placed < target && guard < target * 26) {
    guard++;
    const a = random() * Math.PI * 2;
    const r = s.moatOuterHalf + 12 + random() * (maxR - s.moatOuterHalf - 12);
    const x = Math.cos(a) * r * (1 + Math.abs(Math.cos(a)) * 0.12);
    const z = Math.sin(a) * r * (1 + Math.abs(Math.sin(a)) * 0.12);
    const rr = Math.hypot(x, z);
    if (rr > maxR || rr < s.moatOuterHalf + 10) continue;
    if (inMoat(x, z, s, 4) || L.isBuilt(x, z) || L.roadDist(x, z) < 4.2) continue;
    if (L.riverDist(x, z) < L.river.half + 7) continue;
    const groundY = L.groundY(x, z);
    if (groundY > 20) continue;
    const clump = grove(x / EXTENT + 0.5, z / EXTENT + 0.5);
    if (clump < 0.4 + random() * 0.3) continue;
    const near = rr < s.moatOuterHalf + 34;
    const scale = (near ? 0.7 : 0.85) + random() * (clump > 0.62 ? 0.95 : 0.5);
    const yaw = random() * Math.PI * 2;
    const isPine = clump > 0.52 ? random() > 0.24 : random() > 0.62;
    if (isPine) {
      m.compose(p.set(x, groundY + 1.8 * scale, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), sc.set(scale, scale, scale));
      transforms.pineTrunk.push(m.clone());
      m.compose(p.set(x, groundY + 4.2 * scale, z), q, sc.set(scale, scale, scale));
      transforms.pineA.push(m.clone());
      m.compose(p.set(x, groundY + 6.6 * scale, z), q, sc.set(scale * 0.86, scale, scale * 0.86));
      transforms.pineB.push(m.clone());
      c.setHSL(0.3 + random() * 0.06, 0.4 + random() * 0.18, 0.5 + random() * 0.16);
      colors.pine.push(c.clone(), c.clone());
    } else {
      m.compose(p.set(x, groundY + 1.6 * scale, z), q, sc.set(scale, scale, scale));
      transforms.oakTrunk.push(m.clone());
      m.compose(p.set(x, groundY + 4.2 * scale, z), q, sc.set(scale, scale * 0.8, scale));
      transforms.oakA.push(m.clone());
      m.compose(p.set(x + scale, groundY + 5.4 * scale, z - scale * 0.6), q, sc.set(scale * 0.75, scale * 0.65, scale * 0.75));
      transforms.oakB.push(m.clone());
      c.setHSL(0.22 + random() * 0.1, 0.45 + random() * 0.2, 0.5 + random() * 0.18);
      colors.oak.push(c.clone(), c.clone());
    }
    placed++;
  }
  const addInstanced = (geo, mat, list, tintList) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      mesh.setMatrixAt(i, list[i]);
      if (tintList) mesh.setColorAt(i, tintList[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addInstanced(pine.trunk, barkMat, transforms.pineTrunk);
  addInstanced(pine.crown1, pineMat, transforms.pineA, colors.pine);
  addInstanced(pine.crown2, pineMat, transforms.pineB, colors.pine);
  addInstanced(oak.trunk, barkMat, transforms.oakTrunk);
  addInstanced(oak.blob, oakMat, transforms.oakA, colors.oak);
  addInstanced(oak.blob2, oakMat, transforms.oakB, colors.oak);

  for (let i = 0; i < 95; i++) {
    const a = random() * Math.PI * 2;
    const r = s.moatOuterHalf + 8 + random() * 250;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (L.roadDist(x, z) < 2.4 || L.isBuilt(x, z)) continue;
    const scale = 0.45 + random() * 1.3;
    m.compose(p.set(x, L.groundY(x, z) + scale * 0.25, z), q.setFromEuler(new THREE.Euler(random() * 0.5, random() * 6.283, random() * 0.4)), sc.set(scale, scale * 0.62, scale));
    transforms.rock.push(m.clone());
    c.setHSL(0.09, 0.07, 0.26 + random() * 0.1);
    colors.rock.push(c.clone());
  }
  addInstanced(new THREE.DodecahedronGeometry(1, 0), M.rubble(), transforms.rock, colors.rock);

  for (let i = 0; i < 260; i++) {
    const a = random() * Math.PI * 2;
    const r = s.moatOuterHalf + 10 + random() * 244;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (L.isBuilt(x, z) || L.roadDist(x, z) < 2.6) continue;
    if (L.riverDist(x, z) < L.river.half + 3) continue;
    const gy = L.groundY(x, z);
    if (gy > 18) continue;
    const scale = 0.4 + random() * 0.6;
    m.compose(p.set(x, gy + scale * 0.4, z), q.setFromEuler(new THREE.Euler(0, random() * 6.283, 0)), sc.set(scale * 1.5, scale * 0.85, scale * 1.5));
    transforms.bush.push(m.clone());
    c.setHSL(0.24 + random() * 0.09, 0.42 + random() * 0.18, 0.34 + random() * 0.14);
    colors.bush.push(c.clone());
  }
  addInstanced(new THREE.IcosahedronGeometry(1, 0), M.foliage({ color: '#54783c' }), transforms.bush, colors.bush);

  const reedInner = roundedRectRing(s.cragHalf + 2.4, s.cragHalf + 2.4, 5, 64);
  const reedOuter = roundedRectRing(s.moatOuterHalf - 1.6, s.moatOuterHalf - 1.6, 13, 64);
  for (let i = 0; i < 760; i++) {
    const src = random() > 0.45 ? reedInner : reedOuter;
    const base = src[Math.floor(random() * src.length)];
    const x = base.x + (random() - 0.5) * 2.6;
    const z = base.z + (random() - 0.5) * 2.6;
    if (L.roadDist(x, z) < 2) continue;
    const scale = 0.7 + random() * 0.9;
    m.compose(
      p.set(x, s.waterY + 1.1 * scale, z),
      q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.35, random() * 6.283, (random() - 0.5) * 0.35)),
      sc.set(scale, scale, scale),
    );
    transforms.reed.push(m.clone());
  }
  for (let i = 0; i < 900; i++) {
    const x = -380 + random() * 760;
    const z = L.river.centerZ(x) + (random() > 0.5 ? 1 : -1) * (L.river.half - 2 + random() * 4);
    const scale = 0.7 + random() * 0.9;
    m.compose(
      p.set(x, L.river.waterY + 1.1 * scale, z),
      q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.35, random() * 6.283, (random() - 0.5) * 0.35)),
      sc.set(scale, scale, scale),
    );
    transforms.reed.push(m.clone());
  }
  for (let i = 0; i < 340; i++) {
    const a = random() * Math.PI * 2;
    const rr = 0.92 + random() * 0.16;
    const x = L.pond.cx + Math.cos(a) * L.pond.hx * rr;
    const z = L.pond.cz + Math.sin(a) * L.pond.hz * rr;
    const scale = 0.7 + random() * 0.8;
    m.compose(
      p.set(x, L.pondWaterY + 1.05 * scale, z),
      q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.3, random() * 6.283, (random() - 0.5) * 0.3)),
      sc.set(scale, scale, scale),
    );
    transforms.reed.push(m.clone());
  }
  const reedGeo = new THREE.ConeGeometry(0.09, 2.2, 3, 1, true);
  if (transforms.reed.length) {
    const mesh = new THREE.InstancedMesh(reedGeo, M.foliage({ color: '#5d7a44' }), transforms.reed.length);
    for (let i = 0; i < transforms.reed.length; i++) mesh.setMatrixAt(i, transforms.reed[i]);
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
}

function addGrassTufts(group, cfg, s) {
  const random = T.rng(cfg.seed + 909);
  const geo = new THREE.ConeGeometry(0.16, 0.8, 3, 1, true);
  const count = 850;
  const mesh = new THREE.InstancedMesh(geo, M.foliage({ color: '#6ea34a' }), count);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const c = new THREE.Color();
  const hidden = new THREE.Matrix4().compose(new THREE.Vector3(0, -60, 0), new THREE.Quaternion(), new THREE.Vector3(0.0001, 0.0001, 0.0001));
  const limit = s.cragHalf - 0.8;
  const inner = cfg.site.wallHalf - 2.5;
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0, ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      x = (random() - 0.5) * 2 * limit;
      z = (random() - 0.5) * 2 * limit;
      const courtyard = Math.max(Math.abs(x), Math.abs(z)) < inner;
      ok = !courtyard || random() > 0.85;
    }
    if (!ok) {
      mesh.setMatrixAt(i, hidden);
      mesh.setColorAt(i, c.setRGB(1, 1, 1));
      continue;
    }
    const scale = 0.55 + random() * 0.95;
    q.setFromEuler(new THREE.Euler((random() - 0.5) * 0.3, random() * 6.283, (random() - 0.5) * 0.3));
    m.compose(p.set(x, s.cragTopY + 0.32 * scale, z), q, sc.set(scale, scale * (0.7 + random() * 0.9), scale));
    mesh.setMatrixAt(i, m);
    c.setHSL(0.22 + random() * 0.11, 0.42 + random() * 0.22, 0.28 + random() * 0.24);
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
}

const PARTICLE_VERT = `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (420.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
uniform sampler2D map;
uniform vec3 color;
uniform float opacity;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(map, gl_PointCoord);
  float a = tex.a * vAlpha * opacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
  #include <colorspace_fragment>
}`;

class ParticleField {
  constructor({ origins, perOrigin = 18, texture, color, size = 8, lifetime = [2.5, 5], kind = 'smoke', count }) {
    this.kind = kind;
    this.lifetime = lifetime;
    this.originList = origins;
    const total = count ?? Math.max(1, origins.length * perOrigin);
    this.total = total;
    this.origins = new Array(total);
    this.positions = new Float32Array(total * 3);
    this.alpha = new Float32Array(total);
    this.sizes = new Float32Array(total);
    this.age = new Float32Array(total);
    this.life = new Float32Array(total);
    this.vel = new Float32Array(total * 3);
    this.seed = new Float32Array(total);
    const random = T.rng(1234);
    for (let i = 0; i < total; i++) {
      const o = origins.length ? origins[i % origins.length] : new THREE.Vector3();
      this.reset(i, o, random, true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    const canvas = texture || T.puff({ size: 128, seed: 8 });
    if (!canvas.__tag) canvas.__tag = `particles-${kind}`;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: T.toTexture(canvas, { repeat: 1 }) },
        color: { value: new THREE.Color(color) },
        opacity: { value: 1 },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.geo = geo;
    this.size = size;
    this.random = random;
  }

  reset(i, origin, random = this.random, spread = false) {
    this.origins[i] = origin.clone();
    this.age[i] = spread ? random() * this.lifetime[1] : 0;
    this.life[i] = this.lifetime[0] + random() * (this.lifetime[1] - this.lifetime[0]);
    const angle = random() * Math.PI * 2;
    const speed = this.kind === 'spark' ? 0.6 + random() * 1.4 : 0.25 + random() * 0.5;
    this.vel[i * 3] = Math.cos(angle) * speed * 0.35;
    this.vel[i * 3 + 1] = this.kind === 'spark' ? 1.2 + random() * 1.6 : 0.7 + random() * 0.7;
    this.vel[i * 3 + 2] = Math.sin(angle) * speed * 0.35;
    this.seed[i] = random() * 6.283;
    const o = this.origins[i];
    this.positions[i * 3] = o.x + (random() - 0.5) * 0.5;
    this.positions[i * 3 + 1] = o.y;
    this.positions[i * 3 + 2] = o.z + (random() - 0.5) * 0.5;
  }

  update(dt, t, wind = 0.35) {
    for (let i = 0; i < this.total; i++) {
      this.age[i] += dt;
      const o = this.origins[i];
      if (this.age[i] > this.life[i]) this.reset(i, o);
      const k = this.age[i] / this.life[i];
      const px = o.x + this.vel[i * 3] * this.age[i] + Math.sin(t * 0.8 + this.seed[i]) * k * 1.6 + k * wind * 6;
      const py = o.y + this.vel[i * 3 + 1] * this.age[i] * (this.kind === 'smoke' ? 1 : 0.4);
      const pz = o.z + this.vel[i * 3 + 2] * this.age[i] + Math.cos(t * 0.6 + this.seed[i]) * k * 1.6;
      this.positions[i * 3] = px;
      this.positions[i * 3 + 1] = py;
      this.positions[i * 3 + 2] = pz;
      if (this.kind === 'float') {
        this.alpha[i] = Math.sin(k * Math.PI) * (0.55 + 0.45 * Math.sin(t * 4 + this.seed[i] * 3));
        this.sizes[i] = this.size * (0.6 + 0.4 * Math.sin(t * 2 + this.seed[i]));
      } else {
        this.alpha[i] = Math.sin(k * Math.PI) * (this.kind === 'smoke' ? 0.42 : 0.85);
        this.sizes[i] = this.size * (0.5 + k * (this.kind === 'smoke' ? 3.2 : 0.6));
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

export function buildAmbience(parent, root, extraOrigins = []) {
  const chimneys = [];
  root.traverse((obj) => {
    if (obj.userData && obj.userData.chimneySmoke) {
      obj.updateWorldMatrix(true, false);
      const world = new THREE.Vector3();
      obj.getWorldPosition(world);
      chimneys.push(world);
    }
  });
  chimneys.push(...extraOrigins);
  const smoke = new ParticleField({
    origins: chimneys.length ? chimneys : [new THREE.Vector3(0, 20, 0)],
    perOrigin: 14,
    color: '#c8ccd4',
    size: 9,
    lifetime: [3.5, 7],
    kind: 'smoke',
  });
  parent.add(smoke.points);
  smoke.points.renderOrder = 5;

  const fires = [];
  const wp = new THREE.Vector3();
  root.traverse((obj) => {
    if (obj.isLight && obj.isPointLight) {
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(wp);
      fires.push(wp.clone());
    }
  });
  const sparks = new ParticleField({
    origins: fires.length ? fires.slice(0, 10) : [new THREE.Vector3(0, 2, 0)],
    perOrigin: 6,
    texture: T.softCircle({ inner: 'rgba(255,255,255,1)', outer: 'rgba(255,255,255,0)' }),
    color: '#ffb45c',
    size: 2.4,
    lifetime: [0.8, 1.8],
    kind: 'spark',
  });
  parent.add(sparks.points);
  sparks.points.renderOrder = 6;

  const fireflies = new ParticleField({
    origins: [new THREE.Vector3(0, 0, 0)],
    count: 220,
    texture: T.softCircle({ inner: 'rgba(255,255,255,1)', outer: 'rgba(255,255,255,0)' }),
    color: '#c8f06a',
    size: 2.2,
    lifetime: [4, 9],
    kind: 'float',
  });
  const random = T.rng(32);
  for (let i = 0; i < fireflies.total; i++) {
    const a = random() * Math.PI * 2;
    const r = 40 + random() * 230;
    const o = new THREE.Vector3(Math.cos(a) * r, 1.5 + random() * 6, Math.sin(a) * r * 0.8 + 60);
    fireflies.reset(i, o, random, true);
  }
  parent.add(fireflies.points);
  fireflies.points.renderOrder = 6;

  const birds = buildBirds(parent);
  return {
    smoke,
    sparks,
    fireflies,
    birds,
    fields: [smoke, sparks, fireflies],
    update(dt, t, state) {
      smoke.update(dt, t, 0.25);
      sparks.update(dt, t, 0.05);
      fireflies.material.uniforms.opacity.value = 0.15 + state.night * 0.85;
      fireflies.update(dt, t, 0.1);
      birds.update(dt, t);
    },
    dispose() {
      for (const f of [smoke, sparks, fireflies]) f.dispose();
      birds.dispose();
    },
  };
}

function buildBirds(scene) {
  const count = 11;
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -1.1, 0.25, -0.5, -1.1, 0.25, 0.5,
    0, 0, 0, 1.1, 0.25, -0.5, 1.1, 0.25, 0.5,
  ], 3));
  shape.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(shape, M.paint({ color: '#22282e', roughness: 1 }), count);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const random = T.rng(58);
  const flocks = [];
  for (let i = 0; i < count; i++) {
    flocks.push({
      radius: 55 + random() * 90,
      height: 34 + random() * 26,
      speed: 0.16 + random() * 0.16,
      phase: random() * Math.PI * 2,
      flap: 4 + random() * 4,
      offset: (random() - 0.5) * 14,
    });
  }
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return {
    mesh,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const b = flocks[i];
        const a = t * b.speed + b.phase;
        p.set(Math.cos(a) * b.radius + b.offset, b.height + Math.sin(t * 0.6 + b.phase) * 2.5, Math.sin(a) * b.radius);
        q.setFromEuler(new THREE.Euler(Math.sin(t * b.flap + i) * 0.55, -a + Math.PI / 2, 0, 'YXZ'));
        const sc = 1.5 + (i % 3) * 0.4;
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      void dt;
    },
    dispose() {
      scene.remove(mesh);
      shape.dispose();
    },
  };
}

export function buildUnits(paths, faction, cfg) {
  const group = new THREE.Group();
  const random = T.rng(cfg.seed + 77);
  const skin = M.paint({ color: '#c99a6c', roughness: 0.9 });
  const cloakMat = M.bannerMaterial({ base: faction.base, accent: faction.accent, motif: faction.motif, seed: 77 });
  const plans = [
    { path: paths.wallPath, count: 4, speed: 2.6, kind: 'guard' },
    { path: paths.courtyardPath, count: 5, speed: 1.5, kind: 'servant' },
    { path: paths.outerPath, count: 4, speed: 1.2, kind: 'peasant' },
  ];
  const units = [];
  const shadowGeo = new THREE.PlaneGeometry(1.6, 1.6);
  shadowGeo.rotateX(-Math.PI / 2);
  for (const plan of plans) {
    for (let i = 0; i < plan.count; i++) {
      const unit = new THREE.Group();
      const robeColor = plan.kind === 'guard'
        ? faction.base
        : plan.kind === 'servant'
          ? pick(random, ['#8a7355', '#6d6a5b', '#9b8465', '#7a6a52'])
          : pick(random, ['#6b5b8a', '#5b7a6b', '#8a6b5b', '#5f6b7a']);
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.5, 7), M.paint({ color: robeColor, roughness: 0.92 }));
      body.position.y = 0.78;
      body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), skin);
      head.position.y = 1.62;
      head.castShadow = true;
      unit.add(body, head);
      if (plan.kind === 'guard') {
        const helm = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M.metal({ color: '#6f757c', roughness: 0.4, metalness: 0.85 }));
        helm.position.y = 1.7;
        unit.add(helm);
        const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), M.planks({ tone: '#6b5334' }));
        spear.position.set(0.42, 1.5, 0);
        spear.castShadow = true;
        unit.add(spear);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 5), M.metal({ color: '#b9bec4', metalness: 1, roughness: 0.3 }));
        tip.position.set(0.42, 3.1, 0);
        unit.add(tip);
        if (random() > 0.5) {
          const shield = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.6), cloakMat);
          shield.position.set(-0.5, 1.15, 0);
          shield.castShadow = true;
          unit.add(shield);
        }
      } else {
        const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), M.paint({ color: pick(random, ['#a08b62', '#8c7a55']), roughness: 1 }));
        bundle.position.set(0, 1.95, 0);
        bundle.scale.set(1, 0.75, 1);
        bundle.castShadow = true;
        unit.add(bundle);
      }
      const shadow = new THREE.Mesh(shadowGeo, M.blobShadow({ opacity: plan.kind === 'guard' ? 0.4 : 0.3 }));
      shadow.position.y = 0.03;
      shadow.renderOrder = 1;
      unit.add(shadow);

      const loop = closedLoop(plan.path);
      unit.position.copy(loop.at(i / plan.count));
      group.add(unit);
      units.push({
        obj: unit,
        loop,
        progress: i / plan.count,
        speed: plan.speed / loop.length,
        bob: random() * 6.283,
        wobble: 0.6 + random() * 0.8,
      });
    }
  }
  const dir = new THREE.Vector3();
  return {
    group,
    update(dt, t) {
      for (const u of units) {
        u.progress += dt * u.speed;
        if (u.progress >= 1) u.progress -= 1;
        const point = u.loop.at(u.progress);
        const ahead = u.loop.at((u.progress + 0.01) % 1);
        dir.subVectors(ahead, point);
        if (dir.lengthSq() > 1e-6) u.obj.rotation.y = Math.atan2(dir.x, dir.z);
        u.obj.position.copy(point);
        u.obj.position.y += Math.abs(Math.sin(t * u.wobble * 3 + u.bob)) * 0.09;
        u.obj.rotation.z = Math.sin(t * u.wobble * 3 + u.bob) * 0.045;
      }
    },
  };
}

function closedLoop(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const len = a.distanceTo(b);
    segs.push({ a, b, len });
    total += len;
  }
  return {
    length: total,
    points,
    at(k) {
      let target = k * total;
      for (const seg of segs) {
        if (target <= seg.len) return seg.a.clone().lerp(seg.b, seg.len ? target / seg.len : 0);
        target -= seg.len;
      }
      return segs[0].a.clone();
    },
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

export { ParticleField };
