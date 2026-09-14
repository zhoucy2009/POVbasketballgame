import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const context = vm.createContext({ THREE });
for (const {file, exports} of [{file: 'basketball-worlds', exports: ['createAnimalLook']}, {file: 'basketball-animation', exports: ['fitAnimatedRig']}]) {
  const source = readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), 'utf8').replace(/^import .*;$/mg, '').replace(/export /g, '');
  vm.runInContext(ts.transpileModule(source + exports.map(name => `\nglobalThis.${name} = ${name};`).join(''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
function loadRig(name) {
  const original = Object.getOwnPropertyDescriptor(THREE.TextureLoader.prototype, 'load');
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    const data = readFileSync(new URL(`../public/assets/basketball/${name}.fbx`, import.meta.url));
    return new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  } finally { Object.defineProperty(THREE.TextureLoader.prototype, 'load', original); }
}

test('animal faces remain upright and forward through shipped mocap clips, turns and body lean', () => {
  const rig = loadRig('140_06');
  const idle = THREE.AnimationUtils.subclip(rig.animations[0], 'Idle', 1, 60, 30);
  const mixer = context.fitAnimatedRig(rig, idle, 2.08);
  const scene = new THREE.Scene(), player = new THREE.Group(), visual = new THREE.Group();
  scene.add(player); player.add(visual); visual.add(rig); player.position.set(7, 0.35, -5);
  const look = context.createAnimalLook(player, rig, 1); look.setVisible(true);
  const animal = player.getObjectByName('animal-head'), headBone = rig.getObjectByName('Head');
  assert.ok(animal && headBone);
  const clips = [idle, ...['16_01', '102_27', '06_15'].map(name => loadRig(name).animations[0])];
  for (const clip of clips) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    mixer.stopAllAction(); mixer.clipAction(clip).reset().play(); player.rotation.y = yaw; visual.rotation.set(-0.09, 0, 0.05);
    for (const time of [0.05, 0.3, 0.7, 1.1]) {
      mixer.setTime(time); look.update(time); scene.updateMatrixWorld(true);
      const forward = new THREE.Vector3(0, 0, 1).transformDirection(animal.matrixWorld);
      const bodyForward = new THREE.Vector3(0, 0, 1).transformDirection(visual.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(animal.matrixWorld);
      assert.ok(forward.dot(bodyForward) > 0.99, `${clip.name}: face must point with the athlete after a turn`);
      assert.ok(up.y > 0.98, `${clip.name}: ears must remain above the eyes`);
      assert.ok(animal.getWorldPosition(new THREE.Vector3()).distanceTo(headBone.getWorldPosition(new THREE.Vector3())) < 0.12, 'head must follow the neck during running and jumping');
    }
  }
  assert.equal(rig.getObjectByName('Casual_Head').visible, false);
  look.setVisible(false);
  assert.equal(animal.visible, false);
  assert.equal(rig.getObjectByName('Casual_Head').visible, true, 'leaving the forest restores the human head');
});
