import * as THREE from 'three';
import * as T from './textures.js';

export const PRESETS = {
  morning: {
    label: 'Утро',
    elevation: 26, azimuth: 118,
    sunColor: '#ffdcae', sunIntensity: 3.3,
    hemiSky: '#dceaf8', hemiGround: '#6d7d50', hemiIntensity: 0.95,
    fog: '#cfdde6', fogDensity: 0.0021,
    skyTop: '#2f74b8', skyBottom: '#ecdfd2', skySun: '#fff3d6',
    exposure: 1.08, night: 0.0, window: 0.35, fire: 0.6, star: 0.0,
  },
  noon: {
    label: 'Полдень',
    elevation: 68, azimuth: 150,
    sunColor: '#fff4e0', sunIntensity: 3.7,
    hemiSky: '#bcdbf6', hemiGround: '#6b7c52', hemiIntensity: 1.0,
    fog: '#c6d9e4', fogDensity: 0.0017,
    skyTop: '#2673c4', skyBottom: '#cfe4f0', skySun: '#ffffff',
    exposure: 1.1, night: 0.0, window: 0.12, fire: 0.35, star: 0.0,
  },
  sunset: {
    label: 'Закат',
    elevation: 8, azimuth: 248,
    sunColor: '#ff9a4e', sunIntensity: 2.4,
    hemiSky: '#7a6f9c', hemiGround: '#4a3d33', hemiIntensity: 0.5,
    fog: '#8a5f5a', fogDensity: 0.0042,
    skyTop: '#25316b', skyBottom: '#f0864b', skySun: '#ffd27a',
    exposure: 1.05, night: 0.35, window: 1.0, fire: 1.15, star: 0.25,
  },
  night: {
    label: 'Ночь',
    elevation: 34, azimuth: 42,
    sunColor: '#8fa8d8', sunIntensity: 0.5,
    hemiSky: '#1d2b4a', hemiGround: '#151a1f', hemiIntensity: 0.32,
    fog: '#101623', fogDensity: 0.0062,
    skyTop: '#060a17', skyBottom: '#152034', skySun: '#dfe9ff',
    exposure: 1.15, night: 1.0, window: 1.8, fire: 1.6, star: 1.0,
  },
};

const lerpColor = (target, hex, k) => target.lerp(new THREE.Color(hex), k);

export function sunDirection(preset, out = new THREE.Vector3()) {
  const elev = THREE.MathUtils.degToRad(preset.elevation);
  const azim = THREE.MathUtils.degToRad(preset.azimuth);
  return out.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)).normalize();
}

function skyCanvas(preset) {
  const dir = sunDirection(preset);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, preset.skyTop);
  grad.addColorStop(0.62, preset.skyBottom);
  grad.addColorStop(1, preset.fog);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);
  const u = (Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5);
  const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, dir.y))) / Math.PI * 0.5;
  const glow = ctx.createRadialGradient(u * 256, (1 - v) * 128, 0, u * 256, (1 - v) * 128, 46);
  glow.addColorStop(0, preset.skySun);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 128);
  ctx.globalAlpha = 1;
  return canvas;
}

export function createLighting({ renderer, scene, shadowSpan = 130 }) {
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight('#cfe2f5', '#54603f', 0.7);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight('#ffffff', 0.1);
  scene.add(ambient);

  const fog = new THREE.FogExp2('#cfdde6', 0.0028);
  scene.fog = fog;

  let pmrem = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
  } catch (error) {
    pmrem = null;
  }

  const state = {
    name: 'morning',
    sunColor: new THREE.Color(PRESETS.morning.sunColor),
    sunIntensity: PRESETS.morning.sunIntensity,
    elevation: PRESETS.morning.elevation,
    azimuth: PRESETS.morning.azimuth,
    hemiIntensity: PRESETS.morning.hemiIntensity,
    hemiSky: new THREE.Color(PRESETS.morning.hemiSky),
    hemiGround: new THREE.Color(PRESETS.morning.hemiGround),
    fogColor: new THREE.Color(PRESETS.morning.fog),
    fogDensity: PRESETS.morning.fogDensity,
    exposure: PRESETS.morning.exposure,
    night: PRESETS.morning.night,
    window: PRESETS.morning.window,
    fire: PRESETS.morning.fire,
    star: PRESETS.morning.star,
    target: { ...PRESETS.morning },
  };
  const skyUniforms = {
    topColor: { value: new THREE.Color(PRESETS.morning.skyTop) },
    bottomColor: { value: new THREE.Color(PRESETS.morning.skyBottom) },
    sunColor: { value: new THREE.Color(PRESETS.morning.skySun) },
    sunDir: { value: sunDirection(PRESETS.morning) },
    night: { value: 0 },
    star: { value: 0 },
    horizon: { value: new THREE.Color(PRESETS.morning.fog) },
  };

  let envTexture = null;
  const rebuildEnv = () => {
    if (!pmrem) return;
    const tex = new THREE.CanvasTexture(skyCanvas({ ...state.target, ...state }));
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const next = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    if (envTexture) envTexture.dispose();
    envTexture = next;
    scene.environment = envTexture;
  };

  return {
    sun,
    hemi,
    ambient,
    fog,
    skyUniforms,
    state,
    presets: PRESETS,
    setPreset(name, { instant = false } = {}) {
      if (!PRESETS[name]) return;
      state.name = name;
      state.target = { ...PRESETS[name] };
      rebuildEnv();
      if (instant) this.snap();
    },
    setAzimuth(deg) {
      state.target.azimuth = deg;
      state.azimuth = deg;
      rebuildEnv();
    },
    setElevation(deg) {
      state.target.elevation = deg;
    },
    snap() {
      Object.assign(state, {
        sunIntensity: state.target.sunIntensity,
        elevation: state.target.elevation,
        azimuth: state.target.azimuth,
        hemiIntensity: state.target.hemiIntensity,
        fogDensity: state.target.fogDensity,
        exposure: state.target.exposure,
        night: state.target.night,
        window: state.target.window,
        fire: state.target.fire,
        star: state.target.star,
      });
      state.sunColor.set(state.target.sunColor);
      state.hemiSky.set(state.target.hemiSky);
      state.hemiGround.set(state.target.hemiGround);
      state.fogColor.set(state.target.fog);
      skyUniforms.topColor.value.set(state.target.skyTop);
      skyUniforms.bottomColor.value.set(state.target.skyBottom);
      skyUniforms.sunColor.value.set(state.target.skySun);
      skyUniforms.horizon.value.set(state.target.fog);
    },
    update(dt, windowMaterials, fireLights, focus) {
      const k = 1 - Math.exp(-2.6 * dt);
      const t = state.target;
      state.sunIntensity += (t.sunIntensity - state.sunIntensity) * k;
      state.hemiIntensity += (t.hemiIntensity - state.hemiIntensity) * k;
      state.fogDensity += (t.fogDensity - state.fogDensity) * k;
      state.exposure += (t.exposure - state.exposure) * k;
      state.night += (t.night - state.night) * k;
      state.window += (t.window - state.window) * k;
      state.fire += (t.fire - state.fire) * k;
      state.star += (t.star - state.star) * k;
      state.elevation += (t.elevation - state.elevation) * k;
      state.azimuth += (t.azimuth - state.azimuth) * k;
      lerpColor(state.sunColor, t.sunColor, k);
      lerpColor(state.hemiSky, t.hemiSky, k);
      lerpColor(state.hemiGround, t.hemiGround, k);
      lerpColor(state.fogColor, t.fog, k);
      lerpColor(skyUniforms.topColor.value, t.skyTop, k);
      lerpColor(skyUniforms.bottomColor.value, t.skyBottom, k);
      lerpColor(skyUniforms.sunColor.value, t.skySun, k);
      lerpColor(skyUniforms.horizon.value, t.fog, k);

      sunDirection({ elevation: state.elevation, azimuth: state.azimuth }, skyUniforms.sunDir.value);
      const fx = focus ? focus.x : 0;
      const fz = focus ? focus.z : 0;
      sun.target.position.set(fx, 4, fz);
      sun.position.copy(skyUniforms.sunDir.value).multiplyScalar(220).add(sun.target.position);
      sun.color.copy(state.sunColor);
      sun.intensity = state.sunIntensity;
      hemi.color.copy(state.hemiSky);
      hemi.groundColor.copy(state.hemiGround);
      hemi.intensity = state.hemiIntensity;
      fog.color.copy(state.fogColor);
      fog.density = state.fogDensity;
      skyUniforms.night.value = state.night;
      skyUniforms.star.value = state.star;
      renderer.toneMappingExposure = state.exposure;

      for (const mat of windowMaterials || []) mat.emissiveIntensity = state.window;
      for (const light of fireLights || []) {
        if (!light.userData.baseIntensity) light.userData.baseIntensity = light.intensity;
        light.intensity = light.userData.baseIntensity * state.fire;
      }
      return state;
    },
    dispose() {
      if (envTexture) envTexture.dispose();
      if (pmrem) pmrem.dispose();
    },
  };
}
