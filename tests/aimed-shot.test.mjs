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
  if (ts.isVariableDeclaration(node) && ['readShotCone', 'getShotPressure', 'releaseShot', 'processPeerCommands', 'plannedShotOrigin', 'shotDirection', 'queueUserShot', 'cancelUserShot', 'clearUserShot'].includes(node.name.getText(ast))) callbacks.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(`${physics}\n${callbacks.join('\n')}\nglobalThis.api = { clearUserShot, isBackcourtShot, applyShotRangeLimit, getShotPressure, widenGreenWindow, assistedShotPower, releaseShot, processPeerCommands, plannedShotOrigin, queueUserShot, cancelUserShot, aimedShotVelocity, flightPoint, flightTimeToFloor, advanceFlight, projectedShotOrigin, forecastShot, findGreenWindow };`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
function harness() {
  const athletes = Array.from({length: 6}, (_, i) => ({team: i < 3 ? 0 : 1, position: new THREE.Vector3(i < 3 ? 1 : -1, 0, 0), jumpV: 1.4, jump: 0.7, action: 0.5, velocity: new THREE.Vector3()}));
  const h = {THREE, Math, Number, Array, athletes, BALL_RADIUS: 0.125, SHOT_CONE_RADIUS: 3.6, SHOT_CONE_HALF_ANGLE: Math.PI * 0.4,
    contactPressure: Array(6).fill(0), isActiveIndex: index => index === 0 || index === 3,
    ball: {owner: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3()}, ballSpin: new THREE.Vector3(),
    onlineSessionRef: {current: null}, cameraYaw: Math.PI / 2, cameraPitch: 0.7, shotStyle: 'normal', layupShotActive: false, layupArc: null,
    charging: false, shotPending: true, shotReleaseDelay: 0, shotCharge: 0.65, dunkCharging: false, dunkPower: 0, dunking: false, dunkElapsed: 0, dunkHasBall: false, dunkResolved: false, dribbling: false, dribbleGrace: 0, dribbleMove: 'forward', dashTime: 0,
    assistedShotUntil: [], assistedShotBonus: [], peerCommands: [], sent: [], currentGreenWindow: null,
    pendingShotOrigin: new THREE.Vector3(0.4, 2.9, 0.1), pendingShotPower: 0, shotAirElapsed: 0,
    shotAirStart: new THREE.Vector3(), shotAirEnd: new THREE.Vector3(),
    clamp: THREE.MathUtils.clamp, hoop: team => new THREE.Vector3(team === 0 ? 18.7 : -18.7, 3.05, 0),
    getGatherPosition: () => new THREE.Vector3(0.4, 2.7, 0.1),
    showMessage: () => {}, setCharge: () => {}, setDunkCharge: () => {},
    facePoint: () => {throw new Error('human shots must never face the hoop automatically');},
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

test('the preview origin already includes the jump and stays fixed until release', () => {
  const h = harness(); h.shotPending = false; h.charging = true;
  const before = h.api.plannedShotOrigin();
  assert.ok(before.y > 2.8 && before.y < 3.1);
  h.api.queueUserShot();
  for (const jump of [0, 0.4, 0.85]) {
    h.athletes[0].jump = jump;
    assert.ok(h.api.plannedShotOrigin().distanceTo(before) < 1e-10);
  }
  h.api.releaseShot(0, 0.6);
  assert.ok(h.ball.position.distanceTo(before) < 1e-10);
});
test('cancel preserves possession and natural descent without releasing a ball', () => {
  const h = harness(); h.athletes[0].jump = 0.5; h.athletes[0].jumpV = -1.2;
  assert.equal(h.api.cancelUserShot(), true);
  assert.equal(h.ball.owner, 0); assert.equal(h.shotPending, false);
  assert.equal(h.athletes[0].jumpV, -1.2); assert.equal(h.athletes[0].jump, 0.5);
});


test('green window supports bank shots and never rescues a shot facing away', () => {
  const h = harness(), origin = new THREE.Vector3(14, 2.9, 2);
  const green = h.api.findGreenWindow(origin, 1.1, 0.8);
  assert.ok(green && green.high > green.low);
  assert.ok(green.low <= 0.2 && green.high >= 0.2);
  for (const power of [green.low, (green.low + green.high) / 2, green.high]) {
    assert.equal(h.api.forecastShot(origin, 1.1, 0.8, power).made, true);
  }
  assert.equal(h.api.findGreenWindow(origin, -Math.PI / 2, 0.8), null);
});


test('open green timing is widened to 18 percent and contracts with pressure', () => {
  const h = harness(), base = {low: 0.7, high: 0.72, banked: false};
  const windows = [0, 0.25, 0.5, 0.75, 1].map(p => h.api.widenGreenWindow(base, p));
  assert.ok(Math.abs(windows[0].high - windows[0].low - 0.18) < 1e-10);
  for (let i = 1; i < windows.length; i++) assert.ok(windows[i].high - windows[i].low < windows[i-1].high - windows[i-1].low);
  assert.equal(windows.at(-1).low, base.low); assert.equal(windows.at(-1).high, base.high);
  const window = windows[0];
  let previous = -1;
  for (let i = 0; i <= 1000; i++) {
    const mapped = h.api.assistedShotPower(i / 1000, window);
    assert.ok(mapped >= previous && mapped >= 0 && mapped <= 1); previous = mapped;
  }
  assert.equal(h.api.assistedShotPower(0.25, null), 0.25);
});

test('expanded bank green edges really score with unchanged aim in preview and release', () => {
  const h = harness(), origin = new THREE.Vector3(14, 2.9, 2);
  const raw = h.api.findGreenWindow(origin, 1.1, 0.8);
  const window = h.api.widenGreenWindow(raw, 0);
  for (let i = 0; i <= 10; i++) {
    const input = THREE.MathUtils.lerp(window.low, window.high, i / 10);
    const power = h.api.assistedShotPower(input, window);
    const preview = h.api.forecastShot(origin, 1.1, 0.8, power);
    assert.equal(preview.made, true);
    h.ball.owner = 0; h.shotPending = true; h.pendingShotOrigin.copy(origin); h.cameraYaw = 1.1; h.cameraPitch = 0.8;
    h.api.releaseShot(0, input);
    assert.ok(h.ball.velocity.distanceTo(h.api.aimedShotVelocity(1.1, 0.8, power)) < 1e-10);
  }
});

test('closer defenders, blocks and contact progressively reduce tolerance; teammates do not', () => {
  const h = harness(), defender = h.athletes[3]; h.athletes[0].position.set(0, 0, 0); defender.jump = 0; defender.action = 0;
  defender.position.set(4, 0, 0); assert.equal(h.api.getShotPressure(0, Math.PI / 2), 0);
  defender.position.x = 3; const far = h.api.getShotPressure(0, Math.PI / 2);
  defender.position.x = 1; const near = h.api.getShotPressure(0, Math.PI / 2);
  defender.jump = 0.7; const block = h.api.getShotPressure(0, Math.PI / 2);
  assert.ok(far > 0 && near > far && block > near);
  defender.position.x = -1; defender.jump = 0;
  assert.equal(h.api.getShotPressure(0, Math.PI / 2), 0);
  h.contactPressure[0] = 0.7; assert.ok(h.api.getShotPressure(0, Math.PI / 2) > 0.5);
  h.contactPressure[0] = 0; defender.position.x = 1; defender.team = 0;
  assert.equal(h.api.getShotPressure(0, Math.PI / 2), 0);
});


test('backcourt heaves retain full range for fewer than ten percent of releases on either team', () => {
  const h = harness();
  for (const sign of [-1, 1]) {
    let fullRange = 0;
    for (let i = 0; i < 1000; i++) {
      const v = h.api.aimedShotVelocity(sign * Math.PI / 2, 0.78, 1);
      h.api.applyShotRangeLimit(v, -sign * 15, sign * 18.7, (i + 0.5) / 1000);
      if (v.length() > 9.001) fullRange++;
      else {
        // Even maximum peer release height cannot carry a failed heave from midcourt to the rim.
        const t = (v.y + Math.sqrt(v.y * v.y + 2 * 9.8 * (5.5 - 3.05))) / 9.8;
        assert.ok(Math.hypot(v.x, v.z) * t < 16);
      }
    }
    assert.equal(fullRange, 80);
    assert.equal(h.api.isBackcourtShot(0, sign * 18.7), true);
    const v = h.api.aimedShotVelocity(sign * Math.PI / 2, 0.78, 1), before = v.clone();
    h.api.applyShotRangeLimit(v, sign * 0.01, sign * 18.7, 0.99);
    assert.ok(v.distanceTo(before) < 1e-10);
  }
});

test('losing possession clears both held and pending shots so mouse-up cannot release them', () => {
  for (const pending of [false, true]) {
    const h = harness(); h.ball.owner = 3; h.charging = !pending; h.shotPending = pending;
    h.api.clearUserShot(); h.api.queueUserShot(); h.api.releaseShot(0, 0.8);
    assert.equal(h.ball.owner, 3); assert.equal(h.charging, false); assert.equal(h.shotPending, false);
    assert.equal(h.pendingShotPower, 0); assert.equal(h.shotReleaseDelay, 0);
  }
});

test('live local and host-authoritative remote releases enforce the backcourt range gate', () => {
  for (const remote of [false, true]) {
    const h = harness(); h.Math = Object.create(Math); h.Math.random = () => 0.99;
    if (remote) {
      h.onlineSessionRef.current = {role:'host'}; h.ball.owner = 3;
      h.athletes[3].position.set(8,0,0);
      h.peerCommands.push({kind:'shot',power:1,yaw:Math.PI/2,pitch:0.78,origin:[-8,2.9,0]});
      h.api.processPeerCommands(0);
    } else {
      h.athletes[0].position.set(-8,0,0); h.pendingShotOrigin.set(-8,2.9,0);
      h.api.releaseShot(0,1);
    }
    assert.equal(h.ball.owner,null); assert.ok(h.ball.velocity.length() <= 9.000001);
  }
});
