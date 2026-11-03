import { createBattle, createUnit, KINDS } from '../src/army.js';

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

console.log('модель вторжения');

/* --- marching ------------------------------------------------------------ */
const march = createBattle({
  seed: 7,
  attackers: [{ side: 'invader', kind: 'foot', x: 0, z: 0, route: [{ x: 100, z: 0 }, { x: 200, z: 20 }] }],
  defenders: [],
});
for (let i = 0; i < 60 * 60; i++) march.step(1 / 60);
const mover = march.unit(0);
check('отряд доходит до конца маршрута', mover.mode === 'hold' && Math.abs(mover.x - 200) < 6, `x=${mover.x.toFixed(1)}`);
check('на последнем пункте отряд останавливается', mover.mode === 'hold');

/* --- engagement ---------------------------------------------------------- */
function duel({ atkKind, defKind, gap, seed = 3 }) {
  return createBattle({
    seed,
    attackers: [{ side: 'invader', kind: atkKind, x: 0, z: 0, route: [] }],
    defenders: [{ side: 'host', kind: defKind, x: gap, z: 0, route: [] }],
  });
}

const close = duel({ atkKind: 'foot', defKind: 'foot', gap: 30 });
for (let i = 0; i < 60 * 30; i++) close.step(1 / 60);
const closeEvents = close.drainEvents();
check('в упор стороны несут потери', close.summary().invader < KINDS.foot.size && close.summary().host < KINDS.foot.size, JSON.stringify(close.summary()));
check('залпы заносятся в события', closeEvents.some((e) => e.type === 'volley'));

const far = duel({ atkKind: 'foot', defKind: 'foot', gap: 90 });
for (let i = 0; i < 60 * 20; i++) far.step(1 / 60);
check('вне дальности стрельбы тишина', far.summary().invader === KINDS.foot.size && far.summary().host === KINDS.foot.size);

const guns = duel({ atkKind: 'gun', defKind: 'foot', gap: 120 });
for (let i = 0; i < 60 * 30; i++) guns.step(1 / 60);
check('орудия бьют через всю площадь', guns.summary().host < KINDS.foot.size, `хост ${guns.summary().host}`);
check('пехота орудиям не отвечает', guns.summary().invader === KINDS.gun.size);

/* --- morale and rout ----------------------------------------------------- */
const broken = createBattle({
  seed: 11,
  attackers: [{ side: 'invader', kind: 'foot', x: 0, z: 0, route: [], morale: 6 }],
  defenders: [{ side: 'host', kind: 'gun', x: 60, z: 0, route: [] }],
});
for (let i = 0; i < 60 * 60; i++) broken.step(1 / 60);
const routed = broken.unit(0);
check('низкая мораль обращает отряд в бегство', routed.state === 'rout' || routed.state === 'gone', routed.state);

const fleers = createBattle({
  seed: 12,
  attackers: [{ side: 'invader', kind: 'foot', x: 0, z: 0, route: [], morale: 4 }],
  defenders: [{ side: 'host', kind: 'gun', x: 60, z: 0, route: [] }],
});
fleers.units[0].fleeTo = { x: -400, z: -400 };
for (let i = 0; i < 60 * 400; i++) fleers.step(1 / 60);
check('бегущий отряд уходит с поля', fleers.unit(0).state === 'gone', fleers.unit(0).state);
check('с поля его никто не снимает', fleers.summary().invaderAlive === 0);

/* --- orders -------------------------------------------------------------- */
const maneuver = createBattle({
  seed: 5,
  attackers: [
    { side: 'invader', kind: 'foot', x: 0, z: -40, route: [] },
    { side: 'invader', kind: 'foot', x: 0, z: 40, route: [] },
  ],
  defenders: [],
});
maneuver.order('invader', 'maneuver', { x: 120, z: 0 });
for (let i = 0; i < 60 * 60; i++) maneuver.step(1 / 60);
check('по приказу отряды сходятся к цели', maneuver.units.every((u) => Math.abs(u.x - 120) < 8), maneuver.units.map((u) => u.x.toFixed(0)).join(','));

/* --- determinism --------------------------------------------------------- */
const runA = duel({ atkKind: 'foot', defKind: 'horse', gap: 24, seed: 99 });
const runB = duel({ atkKind: 'foot', defKind: 'horse', gap: 24, seed: 99 });
for (let i = 0; i < 60 * 45; i++) { runA.step(1 / 60); runB.step(1 / 60); }
check('один сид — один результат', JSON.stringify(runA.summary()) === JSON.stringify(runB.summary()));

/* --- helpers ------------------------------------------------------------- */
const unit = createUnit({ id: 'x', side: 'invader', kind: 'cart', x: 5, z: 5 });
check('обоз не стреляет', KINDS.cart.volley === 0 && unit.kind === 'cart');
check('созданная единица получает параметры рода', unit.strength === KINDS.cart.size);

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
if (failed) process.exit(1);
