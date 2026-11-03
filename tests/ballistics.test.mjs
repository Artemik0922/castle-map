import {
  GRAVITY, MUZZLE_SPEED, DRAG, aimAngle, integrate, wallHit, toWallLocal, solveShot,
} from '../src/ballistics.js';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** The range as built: guns on the platform, three wall targets downrange. */
const GUN = { x: -166, y: 1.2, z: -18 };
const WALLS = [
  { cx: -256, cz: -48, halfWidth: 6.8, halfDepth: 1.35, height: 4.15, groundY: 0, disabled: false },
  { cx: -256, cz: -18, halfWidth: 7.65, halfDepth: 1.35, height: 5.3, groundY: 0, disabled: false },
  { cx: -256, cz: 12, halfWidth: 5.95, halfDepth: 1.35, height: 6.45, groundY: 0, disabled: false },
];
const flat = () => 0;

console.log('баллистика полигона');

check('константы заданы', GRAVITY === 30 && MUZZLE_SPEED === 95 && DRAG === 0.004);

/* --- the aim solver ---------------------------------------------------- */
const d = 90;
const elev = aimAngle(d, 0);
check('возвышение на 90 м маленькое', elev > 0.03 && elev < 0.35, `${elev.toFixed(3)} рад`);
check('возвышение растёт с дистанцией', aimAngle(140, 0) > elev);
check('возвышение растёт с высотой цели', aimAngle(d, 4) > elev);
check('нулевая дистанция не даёт NaN', Number.isFinite(aimAngle(0, 0)));
check('недостижимая дистанция — запас 45°', near(aimAngle(4000, 0), Math.PI / 4, 1e-9));

/* --- one solved shot actually lands on the wall ------------------------ */
const target = WALLS[1];
const shot = solveShot({
  from: GUN,
  to: { x: target.cx, y: target.height * 0.55, z: target.cz },
  groundAt: flat,
  walls: WALLS,
});
check('решённый выстрел попадает', shot.hit && shot.wall === target, shot.reason);
check('попадание в теле стены', shot.hit && Math.abs(shot.point.z - target.cz) < target.halfWidth, `dz=${(shot.point.z - target.cz).toFixed(2)}`);
check('попадание по высоте стены', shot.hit && shot.point.y > 0.4 && shot.point.y < target.height, `y=${shot.point.y.toFixed(2)}`);
check('угол в решении совпадает с решателем', near(shot.elev, aimAngle(90, target.height * 0.55 - GUN.y), 1e-6));

/* --- dispersion: the property that matters on a range ------------------ */
function shootWithJitter(count, jitter) {
  let hits = 0;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < count; i++) {
    const aim = solveShot({
      from: GUN,
      to: { x: target.cx, y: target.height * 0.55, z: target.cz },
      groundAt: flat,
      walls: WALLS,
    });
    const heading = Math.atan2(target.cz - GUN.z, target.cx - GUN.x);
    const ball = {
      pos: { x: GUN.x, y: GUN.y, z: GUN.z },
      vel: {
        x: Math.cos(heading) * Math.cos(aim.elev) * MUZZLE_SPEED + rnd() * jitter,
        y: Math.sin(aim.elev) * MUZZLE_SPEED,
        z: Math.sin(heading) * Math.cos(aim.elev) * MUZZLE_SPEED + rnd() * jitter,
      },
    };
    const h = 1 / 240;
    for (let s = 0; s < 240 * 6; s++) {
      integrate(ball, h);
      if (ball.pos.y < flat()) break;
      if (wallHit(ball.pos, WALLS)) {
        hits += 1;
        break;
      }
    }
  }
  return hits / count;
}

const rate = shootWithJitter(200, 0.9);
check('кучность при разбросе ±0.45 м/с ≥ 80 %', rate >= 0.8, `${Math.round(rate * 100)} %`);
// A 15 m wide wall at 90 m still catches a ±6 m/s kick (≈5.7 m of drift), so
// the monotonicity check needs dispersion that genuinely overshoots the target.
const loose = shootWithJitter(200, 25);
check('рост разброса снижает кучность', loose < rate, `${Math.round(loose * 100)} % против ${Math.round(rate * 100)} %`);

/* --- collision bookkeeping --------------------------------------------- */
check('точка внутри стены засчитана', wallHit({ x: -256, y: 2, z: -18 }, WALLS) === target);
check('точка перед стеной — мимо', wallHit({ x: -250, y: 2, z: -18 }, WALLS) === null);
check('точка выше стены — мимо', wallHit({ x: -256, y: 9, z: -18 }, WALLS) === null);
const disabled = [{ ...target, disabled: true }];
check('обрушенная секция не принимает попадания', wallHit({ x: -256, y: 2, z: -18 }, disabled) === null);

const local = toWallLocal(target, { x: target.cx + 0.75, y: 2.4, z: target.cz - 3 });
check('грань со стороны орудий — это +z в местных координатах', near(local.z, 0.75, 1e-9));
check('смещение вдоль стены переносится в local x', near(local.x, 3, 1e-9));
check('высота считается от подошвы стены', near(local.y, 2.4, 1e-9));

/* --- integrator sanity -------------------------------------------------- */
const falling = { pos: { x: 0, y: 100, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
for (let i = 0; i < 60; i++) integrate(falling, 1 / 60);
check('свободное падение ≈ ½gt²', near(falling.pos.y, 100 - 0.5 * GRAVITY * 1, 0.3), `y=${falling.pos.y.toFixed(1)}`);
const gliding = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 100, y: 0, z: 0 } };
for (let i = 0; i < 60; i++) integrate(gliding, 1 / 60);
check('сопротивление тормозит снаряд', gliding.vel.x < 100 && gliding.vel.x > 99, `vx=${gliding.vel.x.toFixed(3)}`);

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
if (failed) process.exit(1);
