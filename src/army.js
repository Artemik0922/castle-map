const { hypot } = Math;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Local PRNG: keeps this module free of Three.js so it can run headless. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Pure land-battle model for the invasion: no Three.js, no scene, just units
 * with strength, morale and a route. Kept separate so it can be tested
 * headless and so the renderer never decides who wins.
 */

export const KINDS = {
  foot: { size: 24, spacing: 1.6, speed: 5.2, range: 42, volley: 0.55, cooldown: 6, morale: 62 },
  horse: { size: 12, spacing: 2.4, speed: 11, range: 26, volley: 0.85, cooldown: 8, morale: 55 },
  gun: { size: 4, spacing: 6, speed: 3.2, range: 150, volley: 2.6, cooldown: 14, morale: 40 },
  cart: { size: 3, spacing: 5, speed: 3.4, range: 0, volley: 0, cooldown: 99, morale: 20 },
};

export function createUnit(opts) {
  const kind = KINDS[opts.kind] || KINDS.foot;
  return {
    id: opts.id,
    side: opts.side,
    kind: opts.kind || 'foot',
    x: opts.x,
    z: opts.z,
    yaw: opts.yaw || 0,
    strength: opts.strength ?? kind.size,
    full: opts.strength ?? kind.size,
    morale: opts.morale ?? kind.morale,
    maxMorale: opts.morale ?? kind.morale,
    route: opts.route || [],
    leg: 0,
    mode: 'march',
    objective: null,
    cooldown: (opts.phase || 0) * kind.cooldown,
    state: 'alive',
    file: opts.file || '',
  };
}

export function createBattle({ seed = 1, attackers = [], defenders = [] }) {
  const random = rng(seed);
  const units = [...attackers, ...defenders].map((spec, i) => createUnit({ ...spec, id: i }));
  const events = [];

  const byId = new Map(units.map((u) => [u.id, u]));
  const sides = { invader: units.filter((u) => u.side === 'invader'), host: units.filter((u) => u.side === 'host') };

  function nearestEnemy(unit, range) {
    let best = null;
    let bestD = Infinity;
    for (const other of sides[unit.side === 'invader' ? 'host' : 'invader']) {
      if (other.state !== 'alive') continue;
      const d = hypot(other.x - unit.x, other.z - unit.z);
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    if (best && bestD <= range) return { unit: best, d: bestD };
    return null;
  }

  function move(unit, dt) {
    if (unit.state === 'rout') {
      const flee = unit.fleeTo;
      if (!flee) { unit.state = 'gone'; return; }
      const d = hypot(flee.x - unit.x, flee.z - unit.z);
      if (d < 6) { unit.state = 'gone'; return; }
      const speed = KINDS[unit.kind].speed * 1.7;
      unit.x += ((flee.x - unit.x) / d) * speed * dt;
      unit.z += ((flee.z - unit.z) / d) * speed * dt;
      unit.yaw = Math.atan2(flee.x - unit.x, flee.z - unit.z);
      return;
    }
    if (unit.mode === 'hold') return;
    const path = unit.mode === 'maneuver' && unit.objective ? [unit.objective] : unit.route;
    if (!path.length || unit.state === 'gone') return;
    const target = path[Math.min(unit.leg, path.length - 1)];
    const dx = target.x - unit.x;
    const dz = target.z - unit.z;
    const d = hypot(dx, dz);
    if (d < 4) {
      if (unit.mode === 'maneuver') { unit.mode = 'hold'; return; }
      if (unit.leg >= path.length - 1) { unit.mode = 'hold'; return; }
      unit.leg += 1;
      return;
    }
    const speed = KINDS[unit.kind].speed;
    unit.x += (dx / d) * speed * dt;
    unit.z += (dz / d) * speed * dt;
    unit.yaw = Math.atan2(dx, dz);
  }

  function shoot(unit, dt) {
    const kind = KINDS[unit.kind];
    unit.cooldown -= dt;
    if (unit.cooldown > 0 || !kind.volley || unit.state !== 'alive') return;
    const found = nearestEnemy(unit, kind.range);
    if (!found) return;
    unit.cooldown = kind.cooldown * (0.75 + random() * 0.5);
    const falloff = 1 - (found.d / kind.range) * 0.45;
    const density = clamp(found.unit.strength / 18, 0.4, 1.4);
    const losses = Math.max(1, Math.round(unit.strength * kind.volley * 0.06 * falloff * density));
    found.unit.strength = Math.max(0, found.unit.strength - losses);
    found.unit.morale -= losses * (unit.kind === 'gun' ? 3.2 : 1.6);
    events.push({ type: 'volley', from: unit.id, at: { x: unit.x, z: unit.z }, target: { x: found.unit.x, z: found.unit.z }, losses, kind: unit.kind });
    if (found.unit.strength <= 0) {
      found.unit.state = 'gone';
      events.push({ type: 'destroyed', unit: found.unit.id });
    } else if (found.unit.morale <= 0 && found.unit.state === 'alive') {
      found.unit.state = 'rout';
      found.unit.fleeTo = found.unit.home || null;
      events.push({ type: 'routed', unit: found.unit.id });
    }
    if (unit.morale <= 0 && unit.state === 'alive') {
      unit.state = 'rout';
      unit.fleeTo = unit.home || null;
      events.push({ type: 'routed', unit: unit.id });
    }
  }

  function step(dt) {
    for (const unit of units) {
      if (unit.state === 'gone') continue;
      move(unit, dt);
      shoot(unit, dt);
      if (unit.state !== 'alive') continue;
      // Men only pull themselves together when no enemy is in contact.
      const threat = nearestEnemy(unit, KINDS[unit.kind].range * 1.6);
      if (!threat) unit.morale = clamp(unit.morale + dt * 1.6, 0, unit.maxMorale);
    }
  }

  function order(side, mode, objective) {
    for (const unit of sides[side]) {
      if (unit.state !== 'alive') continue;
      unit.mode = mode;
      unit.objective = objective ? { ...objective } : null;
      if (mode === 'march') unit.leg = 0;
    }
  }

  function strengthOf(side) {
    return sides[side].reduce((acc, u) => acc + (u.state === 'gone' ? 0 : u.strength), 0);
  }

  function alive(side) {
    return sides[side].filter((u) => u.state !== 'gone');
  }

  return {
    units,
    sides,
    step,
    order,
    strengthOf,
    alive,
    unit: (id) => byId.get(id),
    drainEvents() {
      const out = events.splice(0, events.length);
      return out;
    },
    summary() {
      return {
        invader: strengthOf('invader'),
        host: strengthOf('host'),
        invaderAlive: alive('invader').length,
        hostAlive: alive('host').length,
      };
    },
  };
}
