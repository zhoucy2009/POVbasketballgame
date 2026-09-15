import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
const source = readFileSync(new URL('../lib/basketball-physics.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '').replace(/export /g, '');
const context = vm.createContext({ THREE, Math });
vm.runInContext(ts.transpileModule(source + '\nglobalThis.api = { advanceFlight, contactImpulse, resolveFloor, acceleratePlanar };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { advanceFlight, contactImpulse, resolveFloor, acceleratePlanar } = context.api;

test('ballistic flight reaches the same point at 30, 60, 120 and 144 Hz', () => {
  for (const fps of [30, 60, 120, 144]) {
    const p = new THREE.Vector3(0, 2, 0), v = new THREE.Vector3(8, 7, 1);
    for (let i = 0; i < fps; i++) advanceFlight(p, v, 1 / fps);
    assert.ok(p.distanceTo(new THREE.Vector3(8, 4.1, 1)) < 1e-9);
    assert.ok(Math.abs(v.y + 2.8) < 1e-9);
  }
});
test('floor restitution yields the expected bounce height and loses energy', () => {
  const p = new THREE.Vector3(0, 2.125, 0), v = new THREE.Vector3(), spin = new THREE.Vector3();
  let hit = false, apex = 0;
  for (let i = 0; i < 600; i++) {
    advanceFlight(p, v, 1 / 240);
    if (resolveFloor(p, v, spin, 0.125, 1 / 240)) hit = true;
    if (hit) apex = Math.max(apex, p.y - 0.125);
  }
  assert.ok(Math.abs(apex - 2 * 0.6 ** 2) < 0.035, String(apex));
});
test('oblique and spinning contacts never create total kinetic energy', () => {
  for (const spinRate of [-80, 0, 80]) {
    const v = new THREE.Vector3(5, -7, 2), w = new THREE.Vector3(spinRate, 4, 12);
    const energy = () => 0.5 * v.lengthSq() + 0.2 * 0.125 ** 2 * w.lengthSq();
    const before = energy();
    contactImpulse(v, w, new THREE.Vector3(0, 1, 0), 0.125, 0.76);
    assert.ok(energy() <= before + 1e-9);
    assert.ok(v.y > 0);
  }
});
test('rolling ball settles without perpetual micro-bounces or floor penetration', () => {
  const p = new THREE.Vector3(0, 0.125, 0), v = new THREE.Vector3(2, 0, 0), w = new THREE.Vector3();
  for (let i = 0; i < 240; i++) { advanceFlight(p, v, 1 / 120); resolveFloor(p, v, w, 0.125, 1 / 120); assert.ok(p.y >= 0.125); }
  assert.ok(v.length() < 1e-6); assert.ok(w.length() < 1e-6);
});
test('movement acceleration and braking are bounded and frame-rate independent', () => {
  for (const fps of [30, 60, 144]) {
    const v = new THREE.Vector3();
    for (let i = 0; i < fps; i++) acceleratePlanar(v, new THREE.Vector3(4.25, 0, 0), 1 / fps);
    assert.ok(Math.abs(v.x - 4.25) < 1e-9);
    acceleratePlanar(v, new THREE.Vector3(-4.25, 0, 0), 1 / fps);
    assert.ok(v.x > 0, 'direction reversal must preserve momentum initially');
    for (let i = 0; i < fps; i++) acceleratePlanar(v, new THREE.Vector3(), 1 / fps);
    assert.ok(v.length() < 1e-9);
  }
});
