import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

const library = readFileSync(new URL('../lib/basketball-highlights.ts', import.meta.url), 'utf8').replace(/export /g, '');
const h = vm.createContext({ Float32Array });
vm.runInContext(ts.transpileModule(`${library}\nglobalThis.api = { HighlightRecorder, matchDecision };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, h);
const { HighlightRecorder, matchDecision } = h.api;

test('regulation ties enter unlimited sudden death for either team, practice stays unlimited', () => {
  assert.equal(matchDecision('3v3', 0.01, [4, 2], false), 'playing');
  assert.equal(matchDecision('3v3', 0, [4, 4], false), 'overtime');
  assert.equal(matchDecision('1v1', 0, [0, 0], true), 'overtime');
  for (const score of [[6, 4], [4, 7]]) {
    assert.equal(matchDecision('3v3', 0, score, true), 'finished');
    assert.equal(matchDecision('1v1', 0, score, false), 'finished');
  }
  assert.equal(matchDecision('practice', 0, [100, 0], false), 'playing');
});

test('clips contain real lead-in and follow-through; the final basket frame is retained', () => {
  const recorder = new HighlightRecorder();
  for (let time = 0; time <= 8; time += 0.25) {
    if (time === 5) recorder.mark('score', '2 分', 0, time);
    recorder.add({ time, pose: new Float32Array([time]) });
  }
  const clip = recorder.finish()[0];
  assert.equal(clip.frames[0].time, 1);
  assert.equal(clip.frames.at(-1).time, 6);
  recorder.mark('score', '加时绝杀', 0, 8);
  recorder.add({ time: 8, pose: new Float32Array([42]) });
  assert.equal(recorder.finish().at(-1).frames.at(-1).time, 8);
  assert.equal(recorder.finish().at(-1).frames.at(-1).pose[0], 42);
});

test('long overtime stays bounded, retains each category, and restart clears all clips', () => {
  const recorder = new HighlightRecorder();
  for (let time = 0; time < 1000; time += 0.05) {
    recorder.add({ time, pose: new Float32Array([time]) });
    if (Math.round(time * 20) % 20 === 0) {
      for (const kind of ['score', 'block', 'teamwork']) recorder.mark(kind, kind, 0, time);
    }
  }
  const clips = recorder.finish();
  assert.equal(clips.length, 12);
  for (const kind of ['score', 'block', 'teamwork']) assert.equal(clips.filter(clip => clip.kind === kind).length, 4);
  assert.ok(clips.every(clip => clip.frames.length <= 103));
  recorder.clear();
  assert.equal(recorder.finish().length, 0);
});

// Exercise actual match/scoring callbacks, including the multiplayer guest path.
const source = readFileSync(new URL('../app/basketball-3d.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['checkMatchEnd', 'scoreBasket', 'applyPeerWorld', 'markHighlight'];
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) declarations.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
const callbacks = ts.transpileModule(`${declarations.join('\n')}\nglobalThis.api={${names.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function matchHarness(role = null) {
  const state = {
    THREE, Math, matchDecision, onlineSessionRef: { current: role ? { role } : null },
    modeRef: { current: '3v3' }, phaseRef: { current: 'playing' },
    matchFinished: false, isOvertime: false, gameTime: 0, gameScore: [2, 2], matchElapsed: 90,
    athletes: [{ team: 0 }, { team: 1 }], recorder: new HighlightRecorder(),
    ball: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), group: new THREE.Group(), scored: false, lastOwner: 0 },
    nets: [{ energy: 0 }, { energy: 0 }], layupArc: null, layupShotActive: false, dunking: false, nextPossession: 0, resetAt: 0,
    setScore() {}, setClock() {}, setOvertime() {}, showMessage() {},
    mapPeerOwner: owner => owner === 0 ? 3 : owner === 3 ? 0 : owner,
    latestWorldReceivedAt: 100,
  };
  state.finishMatch = () => { state.matchFinished = true; state.phaseRef.current = 'replay'; };
  vm.createContext(state); vm.runInContext(callbacks, state);
  return state;
}
test('the first overtime basket ends play exactly once and records our winning shot', () => {
  const state = matchHarness();
  state.recorder.add({ time: 89, pose: new Float32Array([1]) });
  state.api.checkMatchEnd(); assert.equal(state.isOvertime, true);
  state.api.scoreBasket(0, 3, 100);
  assert.equal(state.matchFinished, true); assert.equal(state.gameScore[0], 5);
  assert.equal(state.recorder.finish()[0].label, '加时绝杀 · 3 分命中');
  state.ball.scored = false;
  state.api.scoreBasket(0, 2, 101);
  assert.equal(state.gameScore[0], 5);
});
test('only actual friendly events enter our highlights', () => {
  const state = matchHarness();
  state.recorder.add({ time: 89, pose: new Float32Array([1]) });
  state.api.markHighlight('block', 'opponent', 1);
  state.api.markHighlight('teamwork', 'our pass', 0);
  assert.equal(state.recorder.finish().length, 1);
  state.modeRef.current = 'practice';
  state.api.markHighlight('score', 'practice', 0);
  assert.equal(state.recorder.finish().length, 1);
});
test('guest never ends on its estimated clock and uses the final mirrored host result', () => {
  const state = matchHarness('guest');
  state.gameScore = [0, 2]; state.api.checkMatchEnd();
  assert.equal(state.matchFinished, false);
  state.latestWorldState = { ball: { x: 18, y: 3, z: 0, vx: 0, vy: -2, vz: 0, owner: null, mode: 'dead' }, score: [2, 4], time: 0, overtime: true, finished: true };
  state.api.applyPeerWorld(1 / 60, 100);
  assert.equal(state.matchFinished, true); assert.equal(state.isOvertime, true);
  assert.equal(state.gameScore[0], 4); assert.equal(state.gameScore[1], 2);
});
