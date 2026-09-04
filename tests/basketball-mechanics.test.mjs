import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

// Exercise the production callbacks without WebGL, random AI or asset loading.
const source = readFileSync(new URL('../app/basketball-3d.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('basketball.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['setLayupArc', 'makeBallLooseFromCollision', 'reflectBall', 'resolveBallBackboardCollisions', 'resolveBallRimCollisions', 'detectLegalBasket', 'canCatchPutback', 'catchUserPutback', 'spendStamina', 'steal', 'jump', 'startDash'];
const callbacks = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) callbacks.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(callbacks.length, names.length);
const constants = source.slice(source.indexOf('const COLORS'), source.indexOf('export default function'));
const code = ts.transpileModule(`${constants}\n${callbacks.join('\n')}\nglobalThis.api = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness() {
  const athletes = Array.from({length: 6}, (_, i) => ({team: i < 3 ? 0 : 1, stamina: 1, position: new THREE.Vector3(18, 0, 0), jump: 0, jumpV: 0, action: 0, actionKind: 'idle'}));
  const state = {
    THREE, Math, performance: {now: () => 10000}, athletes,
    ball: {owner: null, mode: 'shot', scored: false, shotMake: true, lastOwner: 0, shotPoints: 2, position: new THREE.Vector3(), velocity: new THREE.Vector3()},
    hoop: team => new THREE.Vector3(team === 0 ? 18.7 : -18.7, 3.05, 0),
    horizontalDistance: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    getHandPosition: p => p.position.clone().setY(1.9 + p.jump),
    layupArc: null, layupShotActive: true, lobPassActive: false, pendingPassReward: null,
    layingUp: false, dunking: false, charging: false, shotPending: false, dunkCharging: false,
    dunkHasBall: false, stealProtectionUntil: 0, onlineSessionRef: {current: null}, blockAttemptUntil: [],
    dashCooldown: 0, dashTime: 0, dashDuration: 0, dashWithBall: false, dashDirection: new THREE.Vector3(),
    dribbling: false, dribbleMove: 'forward', dribbleGrace: 0, separationMoveUntil: [], spinDirection: 0,
    resolveMoveDirection: () => new THREE.Vector3(1, 0, 0), resolveCarryMove: () => 'forward', resolveDribbleMove: () => 'burst',
    showMessage: () => {}, sendPeer: () => {}, points: 0,
  };
  state.scoreBasket = (_team, points) => { state.points += points; state.ball.scored = true; state.ball.mode = 'dead'; };
  vm.createContext(state);
  vm.runInContext(code, state);
  return state;
}

for (const mode of ['shot', 'loose']) for (const shotMake of [true, false]) {
  test(`real rim crossing scores once: ${mode}, planned make ${shotMake}`, () => {
    const h = harness();
    Object.assign(h.ball, {mode, shotMake});
    h.ball.position.set(18.7, 2.95, 0); h.ball.velocity.y = -2;
    assert.equal(h.api.detectLegalBasket(new THREE.Vector3(18.7, 3.15, 0), 0), true);
    h.api.detectLegalBasket(new THREE.Vector3(18.7, 3.15, 0), 0);
    assert.equal(h.points, 2);
  });
}
test('upward, outside, held and already-scored balls do not score', () => {
  for (const scenario of ['upward', 'outside', 'held', 'scored']) {
    const h = harness();
    const prev = new THREE.Vector3(18.7, 3.15, 0);
    h.ball.position.set(18.7, 2.95, 0);
    if (scenario === 'upward') { prev.y = 2.95; h.ball.position.y = 3.15; }
    if (scenario === 'outside') { prev.z = 0.6; h.ball.position.z = 0.6; }
    if (scenario === 'held') h.ball.owner = 0;
    if (scenario === 'scored') h.ball.scored = true;
    assert.equal(h.api.detectLegalBasket(prev, 0), false, scenario);
  }
});
test('rim collision retains the ability to score on the following descent', () => {
  const h = harness();
  h.api.makeBallLooseFromCollision();
  assert.equal(h.ball.mode, 'loose');
  h.ball.position.set(18.7, 2.95, 0);
  assert.equal(h.api.detectLegalBasket(new THREE.Vector3(18.7, 3.15, 0), 0), true);
});

test('layup paths reach the hoop through the real rim and backboard collision checks', () => {
  for (const team of [0, 1]) for (const acrobatic of [false, true]) for (const side of [-1, 1]) for (const y of [1.3, 1.8, 2.5, 3.2]) for (const fps of [30, 60, 144]) {
    const h = harness(); h.athletes[0].team = team;
    const rim = h.hoop(team);
    const from = rim.clone().add(new THREE.Vector3(team === 0 ? -0.65 : 0.65, y - 3.05, acrobatic ? side * 0.95 : side * 0.25));
    h.ball.position.copy(from);
    h.api.setLayupArc(from, rim, rim, acrobatic);
    const arc = h.layupArc;
    const curve = new THREE.CubicBezierCurve3(arc.start, arc.lift, arc.drop, arc.end);
    for (let time = 1/fps; time < arc.duration + 1/fps && !h.ball.scored; time += 1/fps) {
      const previous = h.ball.position.clone();
      const t = Math.min(1, time / arc.duration);
      h.ball.position.copy(curve.getPoint(t));
      h.ball.velocity.copy(curve.getTangent(t));
      const boardHit = h.api.resolveBallBackboardCollisions(previous);
      h.api.detectLegalBasket(previous, time);
      const rimHit = !h.ball.scored && h.api.resolveBallRimCollisions(previous);
      assert.equal(boardHit || rimHit, false, JSON.stringify({team, acrobatic, side, y, fps, t}));
    }
    assert.equal(h.points, 2, JSON.stringify({team, acrobatic, side, y, fps}));
  }
});

test('putback reaches nearby rebound and clears the previous guided shot', () => {
  const h = harness(); h.athletes[0].jump = 0.8;
  h.ball.position.set(18.3, 2.6, 1.1);
  assert.equal(h.api.canCatchPutback(0, 1/60), true);
  h.layupArc = {};
  h.api.catchUserPutback();
  assert.equal(h.ball.owner, 0); assert.equal(h.dunkHasBall, true); assert.equal(h.layupArc, null);
});
test('putback cannot take a held, dead, distant or grounded ball', () => {
  for (const scenario of ['held', 'scored', 'dead', 'distant', 'low', 'grounded']) {
    const h = harness(); h.athletes[0].jump = 0.8; h.ball.position.set(18.5, 2.6, 0);
    if (scenario === 'held') h.ball.owner = 3;
    if (scenario === 'scored') h.ball.scored = true;
    if (scenario === 'dead') h.ball.mode = 'dead';
    if (scenario === 'distant') h.ball.position.x = 12;
    if (scenario === 'low') h.ball.position.y = 0.2;
    if (scenario === 'grounded') h.athletes[0].jump = 0;
    assert.equal(h.api.canCatchPutback(0, 1/60), false, scenario);
  }
});
test('steal, jump and dash use one stamina balance without a steal cooldown', () => {
  const h = harness(); const me = h.athletes[0];
  h.api.steal(); h.api.steal();
  assert.ok(Math.abs(me.stamina - 0.64) < 1e-9);
  h.api.jump();
  assert.ok(Math.abs(me.stamina - 0.42) < 1e-9);
  h.api.startDash();
  assert.ok(Math.abs(me.stamina - 0.16) < 1e-9);
  h.api.steal();
  assert.ok(Math.abs(me.stamina - 0.16) < 1e-9);
});
test('insufficient stamina does not partially spend or start actions', () => {
  const h = harness(); const me = h.athletes[0]; me.stamina = 0.1;
  h.api.steal(); h.api.jump(); h.api.startDash();
  assert.equal(me.stamina, 0.1); assert.equal(me.jumpV, 0); assert.equal(h.dashTime, 0);
});
