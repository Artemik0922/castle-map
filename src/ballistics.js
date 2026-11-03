const { sqrt, atan, cos, sin, hypot } = Math;

/**
 * Shared artillery math for the gunnery range: one integrator and one
 * collision routine, used both by the live scene and by the headless test, so
 * the numbers on screen and the numbers under test cannot drift apart.
 */

export const GRAVITY = 30;
export const MUZZLE_SPEED = 95;
export const DRAG = 0.004;

/**
 * Low-arc elevation that puts a shell from (0,0) onto (d, dh).
 * With k = g·d²/(2v²) the trajectory equation reduces to k·t² − d·t + (k+dh) = 0.
 */
export function aimAngle(d, dh, v0 = MUZZLE_SPEED, g = GRAVITY) {
  if (!(d > 0)) return 0.05;
  const k = (g * d * d) / (2 * v0 * v0);
  const disc = d * d - 4 * k * (k + dh);
  if (disc < 0) return Math.PI / 4;
  return atan((d - sqrt(disc)) / (2 * k));
}

/** One substep of motion: gravity plus a light quadratic-ish drag. */
export function integrate(ball, h, g = GRAVITY, drag = DRAG) {
  ball.vel.y -= g * h;
  const keep = 1 - drag * h;
  ball.vel.x *= keep;
  ball.vel.y *= keep;
  ball.vel.z *= keep;
  ball.pos.x += ball.vel.x * h;
  ball.pos.y += ball.vel.y * h;
  ball.pos.z += ball.vel.z * h;
}

/**
 * Axis-aligned wall target: centre on the ground, half extent along world X
 * (its thickness) and along world Z (its length).
 */
export function wallHit(pos, walls) {
  for (const w of walls) {
    if (w.disabled) continue;
    if (pos.y < -0.2 + (w.groundY || 0) || pos.y > w.height + (w.groundY || 0)) continue;
    if (Math.abs(pos.x - w.cx) > w.halfDepth) continue;
    if (Math.abs(pos.z - w.cz) > w.halfWidth) continue;
    return w;
  }
  return null;
}

/** World point → the wall's own block coordinates (walls face east). */
export function toWallLocal(wall, point) {
  return { x: -(point.z - wall.cz), y: point.y - wall.groundY, z: point.x - wall.cx };
}

/**
 * Fire one shot and fly it to the end: used by the test and by the range's
 * own "will this hit" bookkeeping. Returns the impact and where it landed.
 */
export function solveShot({ from, to, v0 = MUZZLE_SPEED, g = GRAVITY, drag = DRAG, groundAt, walls, sub = 4, fps = 60 }) {
  const d = hypot(to.x - from.x, to.z - from.z);
  const elev = aimAngle(d, to.y - from.y, v0, g);
  const heading = Math.atan2(to.z - from.z, to.x - from.x);
  const dir = { x: cos(heading) * cos(elev), y: sin(elev), z: sin(heading) * cos(elev) };
  const ball = {
    pos: { x: from.x, y: from.y, z: from.z },
    vel: { x: dir.x * v0, y: dir.y * v0, z: dir.z * v0 },
  };
  const h = 1 / (fps * sub);
  for (let step = 0; step < fps * sub * 12; step++) {
    integrate(ball, h, g, drag);
    if (ball.pos.y < groundAt(ball.pos.x, ball.pos.z)) {
      return { hit: false, reason: 'ground', elev, point: { ...ball.pos } };
    }
    const wall = wallHit(ball.pos, walls);
    if (wall) return { hit: true, reason: 'wall', elev, wall, point: { ...ball.pos } };
  }
  return { hit: false, reason: 'flyout', elev, point: { ...ball.pos } };
}
