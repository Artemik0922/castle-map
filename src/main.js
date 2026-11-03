import * as THREE from 'three';
import * as P from './parts.js';
import { makeConfig, buildFortress } from './castle.js';
import { buildSite, buildAmbience, buildUnits, createSky } from './environment.js';
import { makeLayout } from './layout.js';
import { buildLocation } from './location.js';
import { buildBarracks } from './barracks.js';
import { buildRange } from './range.js';
import { buildInvasion } from './invasion.js';
import { buildLife } from './life.js';
import { createChronicle } from './chronicle.js';
import { createLighting, PRESETS } from './lighting.js';
import { TopDownRig } from './camera-rig.js';
import { mergeStatic } from './geometry.js';
import { tickers, clearRuntime, disposeTree } from './runtime.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const dprCap = Math.min(window.devicePixelRatio, 2);
let dpr = dprCap;
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The sun barely moves; re-rendering a 2048² shadow map every frame was the
// single biggest cost. It now refreshes only when something changed.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
scene.add(P.getFireGroup());
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 3600);
const rig = new TopDownRig(camera, renderer.domElement, { radius: 175, pitch: 58 });

const lighting = createLighting({ renderer, scene, shadowSpan: 190 });
scene.add(createSky(lighting.skyUniforms));

const world = new THREE.Group();
scene.add(world);

const ui = {
  presets: document.getElementById('presets'),
  sun: document.getElementById('sun'),
  tilt: document.getElementById('tilt'),
  zoom: document.getElementById('zoom'),
  shadows: document.getElementById('shadows'),
  wireframe: document.getElementById('wireframe'),
  units: document.getElementById('units'),
  motion: document.getElementById('motion'),
  seed: document.getElementById('seed'),
  tiltVal: document.getElementById('tiltVal'),
  zoomVal: document.getElementById('zoomVal'),
  sunVal: document.getElementById('sunVal'),
  crest: document.getElementById('crestA'),
  faction: document.getElementById('faction'),
  plaque: document.getElementById('plaque'),
  stats: document.getElementById('stats'),
  bridge: document.getElementById('bridge'),
  gate: document.getElementById('gate'),
  reseed: document.getElementById('reseed'),
  reset: document.getElementById('reset'),
  shot: document.getElementById('shot'),
  panel: document.getElementById('panel'),
  loader: document.getElementById('loader'),
  views: document.getElementById('views'),
  volley: document.getElementById('volley'),
  gunfire: document.getElementById('gunfire'),
  shot: document.getElementById('shotFire'),
  alarm: document.getElementById('alarm'),
  invasion: document.getElementById('invasion'),
  invasionStop: document.getElementById('invasionStop'),
  rangeAuto: document.getElementById('rangeAuto'),
  rangeReset: document.getElementById('rangeReset'),
  rangeStats: document.getElementById('rangeStats'),
  follow: document.getElementById('follow'),
  people: document.getElementById('people'),
  orbit: document.getElementById('orbit'),
  mapMode: document.getElementById('mapMode'),
  locPlaque: document.getElementById('locPlaque'),
  chronoSpeed: document.getElementById('chronoSpeed'),
  chronoSpeedVal: document.getElementById('chronoSpeedVal'),
  chronoPause: document.getElementById('chronoPause'),
  chronoClock: document.getElementById('chronoClock'),
  chronoStats: document.getElementById('chronoStats'),
  chronoLog: document.getElementById('chronoLog'),
};

const SPEED_STEPS = [0, 1, 30, 90, 365, 1460];
const SPEED_LABELS = ['пауза', 'год в сутки', 'год за 48 мин', 'год за 16 мин', 'год за 4 мин', 'год за минуту'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function monthOf(dayOfYear) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let acc = dayOfYear;
  for (let i = 0; i < 11; i++) {
    if (acc < lengths[i]) return { name: MONTHS[i], day: Math.floor(acc) + 1 };
    acc -= lengths[i];
  }
  return { name: MONTHS[11], day: Math.floor(acc) + 1 };
}

function chronicleEvent(kind, text) {
  if (!ui.chronoLog) return;
  const line = document.createElement('div');
  line.className = 'logline';
  line.textContent = text;
  ui.chronoLog.prepend(line);
  while (ui.chronoLog.children.length > 7) ui.chronoLog.removeChild(ui.chronoLog.lastChild);
  void kind;
}

const state = {
  seed: 7,
  preset: 'morning',
  bridgeUp: false,
  gateUp: false,
  paused: false,
  orbit: false,
  mapMode: false,
};

let fort = null;
let ambience = null;
let units = null;
let loc = null;
let barracks = null;
let range = null;
let invasion = null;
let life = null;
let chrono = null;
let views = [];
let windowMaterials = [];
let fireLights = [];

function clearWorld() {
  clearRuntime();
  P.resetFires();
  for (const child of [...world.children]) {
    world.remove(child);
    disposeTree(child);
  }
  ambience = null;
  units = null;
  fort = null;
  loc = null;
  barracks = null;
  range = null;
  invasion = null;
  life = null;
  chrono = null;
}

function collectGlow(root) {
  windowMaterials = [];
  fireLights = [];
  const seen = new Set();
  root.traverse((obj) => {
    const mats = obj.isMesh || obj.isInstancedMesh ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const mat of mats) {
      if (mat && mat.userData && mat.userData.window && !seen.has(mat)) {
        seen.add(mat);
        windowMaterials.push(mat);
      }
    }
    if (obj.isLight && obj.isPointLight && !seen.has(obj)) {
      seen.add(obj);
      fireLights.push(obj);
    }
  });
}

function chimneyOrigins(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.userData && obj.userData.chimneySmoke) {
      const world = new THREE.Vector3();
      obj.getWorldPosition(world);
      out.push(world);
    }
  });
  return out;
}

function build() {
  clearWorld();
  const cfg = makeConfig(state.seed);
  const layout = makeLayout(cfg);
  fort = buildFortress(cfg);
  world.add(fort.group);
  const fortChimneys = chimneyOrigins(fort.group);
  mergeStatic(fort.group, fort.group);
  const site = buildSite(cfg, layout);
  world.add(site.group);
  loc = buildLocation(cfg, layout);
  world.add(loc.group);
  barracks = buildBarracks(cfg, layout);
  world.add(barracks.group);
  range = buildRange(cfg, layout);
  world.add(range.group);
  invasion = buildInvasion(cfg, layout, { onEvent: chronicleEvent, beacons: loc.beacons });
  world.add(invasion.group);
  invasion.setCamera(camera);
  life = buildLife(cfg, layout);
  world.add(life.group);
  chrono = createChronicle(cfg, layout, world, barracks, site.terrainMat);
  chrono.setSpeed(SPEED_STEPS[Number(ui.chronoSpeed.value)]);
  chrono.onEvent(chronicleEvent);
  world.add(chrono.group);
  scene.updateMatrixWorld(true);
  ambience = buildAmbience(world, fort.group, [...fortChimneys, ...loc.chimneys, ...barracks.chimneys]);
  units = buildUnits(fort.paths, fort.faction, cfg);
  world.add(units.group);
  collectGlow(world);
  lighting.setPreset(state.preset, { instant: false });
  applyFlags();
  views = [
    { id: 'keep', at: new THREE.Vector3(0, cfg.site.cragTopY + 10, 0), radius: 175, pitch: 58 },
    { id: 'town', at: new THREE.Vector3(layout.town.cx, 12, layout.town.cz), radius: 152, pitch: 54 },
    { id: 'wharf', at: new THREE.Vector3(layout.docks.cx, 6, layout.docks.cz), radius: 118, pitch: 44 },
    { id: 'fields', at: new THREE.Vector3(layout.fields[0] ? layout.fields[0].cx : 150, 10, layout.town.cz), radius: 140, pitch: 50 },
    { id: 'quarry', at: new THREE.Vector3(layout.quarry.cx, 12, layout.quarry.cz), radius: 112, pitch: 46 },
    { id: 'camp', at: new THREE.Vector3(layout.camp.cx, 12, layout.camp.cz), radius: 132, pitch: 44 },
    { id: 'barracks', at: new THREE.Vector3(layout.garrison.cx, 8, layout.garrison.cz), radius: 108, pitch: 46 },
    { id: 'range', at: new THREE.Vector3(layout.range.cx, 6, layout.range.cz), radius: 176, pitch: 30 },
    { id: 'field', at: new THREE.Vector3(26, 6, 66), radius: 158, pitch: 36 },
    { id: 'map', at: new THREE.Vector3(0, 6, 118), radius: 380, pitch: 89 },
  ];
  ui.seed.textContent = String(cfg.seed);
  ui.faction.textContent = cfg.faction.name;
  ui.crest.style.background = `linear-gradient(150deg, ${cfg.faction.base}, ${cfg.faction.accent})`;
  ui.plaque.innerHTML = `<b>${cfg.faction.name}</b> · ${cfg.keepStyle === 'square' ? 'квадратный донжон' : 'круглый донжон'} · `
    + `${cfg.midTowers ? '3 дозорные башни' : 'без средних башен'} · крыша: ${roofName(cfg.roofStyle)} · башен: ${fort.stats.towerCount}`;
  ui.locPlaque.innerHTML = `Локация: <b>река с мостом и пристанью</b>, город за стеной (${cfg.villageHouses * 3}+ дворов), `
    + `${layout.fields.length} полей, сад, пастбище, пруд, карьер, ${layout.watchtowers.length} дозорные башни, `
    + `лесозаготовка, лагерь осаждающих и казарма с батареей (${barracks.stats.guns} пушек, взвод ${barracks.stats.company} чел.) · `
    + `дороги: ${layout.roads.length}`;
  state.bridgeUp = false;
  state.gateUp = false;
  ui.bridge.textContent = 'Поднять мост';
  ui.gate.textContent = 'Поднять решётку';
  goTo('keep');
  renderer.shadowMap.needsUpdate = true;
}

function goTo(id) {
  const view = views.find((v) => v.id === id) || views[0];
  if (!view) return;
  state.mapMode = id === 'map';
  if (ui.mapMode) ui.mapMode.checked = state.mapMode;
  rig.focus(view.at, view.radius);
  rig.setPitch(view.pitch);
  ui.tilt.value = Math.round(view.pitch);
  ui.zoom.value = Math.round(view.radius);
}

const roofName = (style) => ({ tile: 'черепица', shingle: 'гонт', thatch: 'солома' }[style] || style);

function applyFlags() {
  renderer.shadowMap.enabled = ui.shadows.checked;
  renderer.shadowMap.needsUpdate = true;
  world.traverse((obj) => {
    if (obj.isPoints || obj.isSprite) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat && 'wireframe' in mat && !mat.isShaderMaterial) mat.wireframe = ui.wireframe.checked;
    }
  });
  if (units) units.group.visible = ui.units.checked;
  if (loc) for (const c of loc.crowd) c.group.visible = ui.people.checked;
  if (ambience) {
    const motion = ui.motion.checked;
    ambience.birds.mesh.visible = motion;
    ambience.smoke.points.visible = motion;
    ambience.sparks.points.visible = motion;
  }
}

function setBridge(up) {
  state.bridgeUp = up;
  ui.bridge.textContent = up ? 'Опустить мост' : 'Поднять мост';
  if (fort) fort.setBridge(up);
}

function setGate(up) {
  state.gateUp = up;
  ui.gate.textContent = up ? 'Опустить решётку' : 'Поднять решётку';
  if (fort) fort.setGate(up);
}

function setPreset(name) {
  if (!PRESETS[name]) return;
  state.preset = name;
  lighting.setPreset(name);
  for (const chip of ui.presets.children) chip.classList.toggle('active', chip.dataset.preset === name);
}

ui.presets.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-preset]');
  if (chip) setPreset(chip.dataset.preset);
});

ui.sun.addEventListener('input', (e) => {
  lighting.setAzimuth(Number(e.target.value));
  ui.sunVal.textContent = `${e.target.value}°`;
});
ui.tilt.addEventListener('input', (e) => rig.setPitch(Number(e.target.value)));
ui.zoom.addEventListener('input', (e) => rig.setZoom(Number(e.target.value)));
ui.shadows.addEventListener('change', applyFlags);
ui.wireframe.addEventListener('change', applyFlags);
ui.units.addEventListener('change', applyFlags);
ui.motion.addEventListener('change', applyFlags);
ui.people.addEventListener('change', applyFlags);
ui.orbit.addEventListener('change', () => { state.orbit = ui.orbit.checked; });
ui.mapMode.addEventListener('change', () => {
  if (ui.mapMode.checked) goTo('map');
  else { state.mapMode = false; rig.setPitch(Number(ui.tilt.value)); }
});
ui.views.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-view]');
  if (!chip) return;
  goTo(chip.dataset.view);
  for (const c of ui.views.children) c.classList.toggle('active', c === chip);
});
ui.bridge.addEventListener('click', () => setBridge(!state.bridgeUp));
ui.gate.addEventListener('click', () => setGate(!state.gateUp));
ui.volley.addEventListener('click', () => barracks && barracks.volley());
ui.gunfire.addEventListener('click', () => barracks && barracks.fireGuns());
ui.shot.addEventListener('click', () => range && range.fireOne());
ui.invasion.addEventListener('click', () => {
  if (!invasion) return;
  goTo('field');
  invasion.start();
});
ui.invasionStop.addEventListener('click', () => invasion && invasion.stop());
ui.rangeAuto.addEventListener('change', () => range && range.setAuto(ui.rangeAuto.checked));
ui.rangeReset.addEventListener('click', () => range && range.reset());
ui.chronoSpeed.addEventListener('input', (e) => {
  if (!chrono) return;
  chrono.setSpeed(SPEED_STEPS[Number(e.target.value)]);
  ui.chronoSpeedVal.textContent = SPEED_LABELS[Number(e.target.value)];
});
ui.chronoPause.addEventListener('change', () => chrono && chrono.setPaused(ui.chronoPause.checked));
ui.reseed.addEventListener('click', () => {
  state.seed = Math.floor(Math.random() * 9999) + 1;
  build();
});
ui.reset.addEventListener('click', () => {
  rig.goalYaw = Math.PI * 0.22;
  goTo('keep');
  for (const c of ui.views.children) c.classList.toggle('active', c.dataset.view === 'keep');
});
ui.shot.addEventListener('click', () => {
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `castle-${state.seed}.png`;
  a.click();
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const key = e.code;
  if (key === 'KeyB') setBridge(!state.bridgeUp);
  if (key === 'KeyG') setGate(!state.gateUp);
  if (key === 'KeyN') {
    state.seed = Math.floor(Math.random() * 9999) + 1;
    build();
  }
  if (key === 'KeyH') ui.panel.classList.toggle('hidden');
  if (key === 'KeyP') applyPause();
  if (key === 'KeyR') ui.reset.click();
  if (key === 'KeyT') ui.mapMode.click();
  if (key === 'KeyO') ui.orbit.click();
  if (key === 'KeyV') barracks && barracks.volley();
  if (key === 'KeyK') barracks && barracks.fireGuns();
  if (key === 'KeyF') range && range.fireOne();
  if (key === 'KeyI') ui.invasion.click();
  if (key === 'Digit1') setPreset('morning');
  if (key === 'Digit2') setPreset('noon');
  if (key === 'Digit3') setPreset('sunset');
  if (key === 'Digit4') setPreset('night');
});

function applyPause() {
  state.paused = !state.paused;
}

let last = performance.now();
let elapsed = 0;
let frames = 0;
let fpsTime = 0;
let fps = 60;

const shadowFocus = new THREE.Vector3(1e9, 0, 1e9);
let shadowClock = 0;
let dprClock = 0;

function lightingSettled() {
  const st = lighting.state;
  return Math.abs(st.elevation - st.target.elevation) < 0.05
    && Math.abs(st.azimuth - st.target.azimuth) < 0.05
    && Math.abs(st.sunIntensity - st.target.sunIntensity) < 0.01;
}

/** Refresh the frozen shadow map only when the sun or the framed area moved. */
function shadowWatch(dt) {
  shadowClock += dt;
  if (shadowClock < 0.2) return;
  shadowClock = 0;
  if (rig.target.distanceToSquared(shadowFocus) > 6.25 || !lightingSettled()) {
    shadowFocus.copy(rig.target);
    renderer.shadowMap.needsUpdate = true;
  }
}

/** Drop to 1:1 rendering while the GPU is saturated, climb back when it is not. */
function adaptResolution(dt) {
  dprClock += dt;
  if (dprClock < 1.2) return;
  dprClock = 0;
  const next = fps < 42 && dpr > 1 ? 1 : fps > 58 && dpr < dprCap ? dprCap : dpr;
  if (next === dpr) return;
  dpr = next;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.needsUpdate = true;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsTime += dt;
  frames++;
  if (fpsTime > 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
  }
  if (!state.paused) {
    elapsed += dt;
    if (range) range.setCameraQuat(camera.quaternion);
    for (const tick of tickers) tick(elapsed, dt);
    if (ambience) ambience.update(dt, elapsed, lighting.state);
    if (units) units.update(dt, elapsed);
    if (loc) for (const c of loc.crowd) c.update(dt, elapsed);
  }
  P.syncFires(camera.quaternion);
  if (chrono) {
    chrono.update(dt);
    if (ui.chronoClock) {
      const c = chrono.clock;
      const m = monthOf(c.dayOfYear);
      ui.chronoClock.innerHTML = `<b>${1090 + c.year} год</b> · ${m.name} ${m.day} · ${c.season}`;
      ui.chronoStats.textContent = `дворов ${chrono.stats.dwellings} · жителей ${chrono.stats.people} · нив ${chrono.stats.fields}`
        + ` · ${chrono.stats.hectares} га · стад ${chrono.stats.herds} · гарнизон ${chrono.stats.garrison} · промыслов ${chrono.stats.works}`;
    }
  }
  const info = rig.update(dt);
  if (range && ui.follow && ui.follow.checked && range.isTracking()) rig.focus(range.tracking);
  if (state.orbit && !rig.drag) rig.goalYaw += dt * 0.05;
  lighting.update(dt, windowMaterials, fireLights, rig.target);
  if (loc) loc.setNight(lighting.state.night);
  scene.fog.density *= THREE.MathUtils.clamp(165 / Math.max(70, info.radius), 0.18, 1);
  if (loc) for (const l of loc.lod) l.group.visible = info.radius < l.maxRadius;
  if (barracks) for (const l of barracks.lod) l.group.visible = info.radius < l.maxRadius;
  if (range && ui.rangeStats) {
    const s = range.stats;
    const walls = range.summary().map((t) => `${t.label} ${t.breach}%`).join(' · ');
    ui.rangeStats.textContent = `выстрелов ${s.shots} · попаданий ${s.hits} · выбито ${s.blocksDown} блоков · взято мишеней ${s.taken}\n${walls}`;
  }
  if (invasion && ui.alarm) {
    const st = invasion.stats();
    ui.alarm.textContent = `${invasion.phaseLabel()} · враг ${st.invader} · наши ${st.host}`;
  }
  if (life) for (const l of life.lod) l.group.visible = info.radius < l.maxRadius;
  shadowWatch(dt);
  adaptResolution(dt);
  if (ambience) {
    ambience.smoke.material.uniforms.opacity.value = 0.55;
    ambience.fireflies.points.visible = lighting.state.night > 0.15 && ui.motion.checked;
  }
  renderer.render(scene, camera);
  if (ui.tiltVal) ui.tiltVal.textContent = `${Math.round(info.pitchDeg)}°`;
  if (ui.zoomVal) ui.zoomVal.textContent = `${Math.round(info.radius)} м`;
  ui.stats.textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.triangles.toLocaleString('ru-RU')} тр · `
    + `${renderer.info.render.calls} вызовов · ${dpr.toFixed(2)}×`;
  if (ui.loader && !state.loaderHidden) {
    state.loaderHidden = true;
    ui.loader.classList.add('gone');
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

ui.tilt.value = 58;
ui.zoom.value = 175;
ui.sun.value = PRESETS[state.preset].azimuth;
ui.sunVal.textContent = `${ui.sun.value}°`;
rig.setPitch(58);
rig.setZoom(175);
lighting.setAzimuth(Number(ui.sun.value));

build();
requestAnimationFrame(frame);

window.__castle = { rig, lighting, state, scene, camera, renderer, rebuild: build, setBridge, setGate, setPreset, goTo, barracks: () => barracks, chrono: () => chrono, range: () => range, invasion: () => invasion };
