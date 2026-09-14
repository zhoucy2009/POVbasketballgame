import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
const source = readFileSync(new URL('../lib/basketball-animation.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '').replace(/export /g, '');
const context = vm.createContext({ THREE });
vm.runInContext(ts.transpileModule(source + '\nglobalThis.closeMotionLoop = closeMotionLoop; globalThis.fitAnimatedRig = fitAnimatedRig;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
test('loop stitching preserves the action body and closes normalized rotation and position seams', () => {
  const rotation = new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 0.5, 0.95, 1], [0,0,0,1, 0,0.70710678,0,0.70710678, 0,1,0,0, 0,1,0,0]);
  const position = new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 0.95, 1], [0,1,0, 0,1.1,0, 0,1.2,0, 0,1.3,0]);
  const clip = new THREE.AnimationClip('Run_Loop', 1, [rotation, position]);
  const midpoint = Array.from(rotation.values.slice(4, 8));
  context.closeMotionLoop(clip);
  assert.deepEqual(Array.from(rotation.values.slice(4, 8)), midpoint);
  assert.deepEqual(Array.from(rotation.values.slice(-4)), Array.from(rotation.values.slice(0, 4)));
  assert.deepEqual(Array.from(position.values.slice(-3)), Array.from(position.values.slice(0, 3)));
  assert.ok(Math.abs(new THREE.Quaternion().fromArray(rotation.values, 8).length() - 1) < 1e-6);
});

test('the shipped athlete skin has its requested height and ground contact after posing', () => {
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  let model;
  try {
    const data = readFileSync(new URL('../public/assets/basketball/140_06.fbx', import.meta.url));
    model = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  } finally { THREE.TextureLoader.prototype.load = originalLoad; }
  const clip = THREE.AnimationUtils.subclip(model.animations[0], 'Idle_Loop', 1, 60, 30);
  const mixer = context.fitAnimatedRig(model, clip, 1.98);
  const bounds = new THREE.Box3().setFromObject(model);
  assert.ok(Math.abs(bounds.max.y - bounds.min.y - 1.98) < 1e-6);
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  const head = model.getObjectByName('Head').getWorldPosition(new THREE.Vector3());
  assert.ok(head.y > 1.6 && head.y < 1.9, `head must match the eye line: ${head.y}`);
  assert.ok(model.getObjectByName('Chest'), 'kit labels must attach to the actual Chest bone');
  mixer.stopAllAction();
});
