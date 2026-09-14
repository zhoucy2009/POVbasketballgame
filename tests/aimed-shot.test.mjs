import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
const physics = readFileSync(new URL('../lib/basketball-physics.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '').replace(/export /g, '');
const source = readFileSync(new URL('../app/basketball-3d.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['releaseShot', 'processPeerCommands'].includes(node.name.getText(ast))) callbacks.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(`${physics}\n${callbacks.join('\n')}\nglobalThis.api = { releaseShot, processPeerCommands, aimedShotVelocity, flightPoint, flightTimeToFloor, advanceFlight };`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
function harness() {
  const athletes = Array.from({length: 6}, (_, i) => ({team: i < 3 ? 0 : 1, position: new THREE.Vector3(0, 0, 0), jumpV: 1.4, jump: 0.7, action: 0.5}));
  const h = {THREE, Math, Number, Array, athletes, BALL_RADIUS: 0.125,
    ball: {owner: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3()}, ballSpin: new THREE.Vector3(),
    onlineSessionRef: {current: null}, cameraYaw: Math.PI / 2, cameraPitch: 0.7, shotStyle: 'normal', layupShotActive: false, layupArc: null,
    charging: false, shotPending: true, shotReleaseDelay: 0, shotCharge: 0.65, dunkCharging: false, dunkPower: 0, dunking: false, dunkElapsed: 0, dunkHasBall: false, dunkResolved: false, dribbling: false, dribbleGrace: 0, dribbleMove: 'forward', dashTime: 0,
    assistedShotUntil: [], assistedShotBonus: [], peerCommands: [], sent: [],
    clamp: THREE.MathUtils.clamp, hoop: () => new THREE.Vector3(18.7, 3.05, 0),
    getGatherPosition: () => new THREE.Vector3(0.4, 2.7, 0.1),
    showMessage: () => {}, setCharge: () => {}, setDunkCharge: () => {},
    facePoint: () => {throw new Error('human shots must never face the hoop automatically');},
    readShotCone: () => {throw new Error('human shots must not depend on random accuracy');},
  };
  h.sendPeer = packet => h.sent.push(packet);
  vm.createContext(h); vm.runInContext(code, h); return h;
}
test('turning completely away from the hoop sends the shot behind the player', () => {
  const h = harness(); h.cameraYaw = -Math.PI / 2;
  h.api.releaseShot(0, 0.6);
  assert.ok(h.ball.velocity.x < -9); assert.ok(h.ball.velocity.y > 0);
  assert.equal(h.athletes[0].jumpV, 1.4, 'release must not cause a second upward impulse');
  assert.equal(h.ball.owner, null); assert.equal(h.ball.mode, 'shot');
});
test('view pitch controls elevation, including deliberately throwing downward', () => {
  const h = harness();
  for (const pitch of [-0.8, 0, 0.4, 1.2]) {
    const v = h.api.aimedShotVelocity(0.9, pitch, 0.7);
    const direction = new THREE.Vector3(Math.sin(0.9) * Math.cos(pitch), Math.sin(pitch), -Math.cos(0.9) * Math.cos(pitch));
    assert.ok(v.clone().normalize().distanceTo(direction) < 1e-12);
  }
});
test('more power increases range and power stays bounded', () => {
  const h = harness(), origin = new THREE.Vector3(0, 2.5, 0);
  const ranges = [-1, 0, 0.4, 0.7, 1, 2].map(power => {
    const v = h.api.aimedShotVelocity(Math.PI / 2, 0.65, power);
    const t = h.api.flightTimeToFloor(origin.y, v.y, 0.125);
    return h.api.flightPoint(origin, v, t).x;
  });
  assert.equal(ranges[0], ranges[1]); assert.equal(ranges[4], ranges[5]);
  assert.ok(ranges[1] < ranges[2] && ranges[2] < ranges[3] && ranges[3] < ranges[4]);
});
test('preview equation matches actual released ball at multiple frame rates and directions', () => {
  for (const yaw of [-Math.PI / 2, 0, 1.7]) for (const pitch of [-0.6, 0.7, 1.2]) for (const fps of [30, 60, 144]) {
    const h = harness(); h.cameraYaw = yaw; h.cameraPitch = pitch; h.api.releaseShot(0, 0.7);
    const origin = h.ball.position.clone(), velocity = h.ball.velocity.clone();
    for (let i = 0; i < fps; i++) h.api.advanceFlight(h.ball.position, h.ball.velocity, 1 / fps);
    assert.ok(h.ball.position.distanceTo(h.api.flightPoint(origin, velocity, 1)) < 1e-10);
  }
});
test('guest aim and release point survive the mirrored host court without auto targeting', () => {
  const guest = harness(); guest.onlineSessionRef.current = {role: 'guest'}; guest.cameraYaw = 0.4;
  guest.api.releaseShot(0, 0.73);
  const host = harness(); host.onlineSessionRef.current = {role: 'host'}; host.ball.owner = 3;
  host.peerCommands.push(guest.sent[0].command); host.api.processPeerCommands(0);
  assert.ok(Math.abs(host.ball.velocity.x + guest.ball.velocity.x) < 1e-10);
  assert.equal(host.ball.velocity.y, guest.ball.velocity.y); assert.equal(host.ball.velocity.z, guest.ball.velocity.z);
  assert.equal(host.ball.position.x, -guest.ball.position.x); assert.equal(host.ball.position.y, guest.ball.position.y);
});
test('invalid peer shot data cannot produce NaN physics or a distant release point', () => {
  for (const patch of [{yaw: NaN}, {pitch: Infinity}, {origin: [100, 2, 0]}, {origin: [0, NaN, 0]}, {power: Infinity}, {origin: null}]) {
    const h = harness(); h.onlineSessionRef.current = {role:'host'}; h.ball.owner = 3;
    h.peerCommands.push({kind:'shot', power:0.5, yaw:0, pitch:0.7, origin:[0,2,0], ...patch});
    h.api.processPeerCommands(0); assert.equal(h.ball.owner, 3);
  }
});
