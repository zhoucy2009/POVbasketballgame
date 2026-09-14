import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
const source = readFileSync(new URL('../app/basketball-3d.tsx', import.meta.url), 'utf8');
const decisions = source.slice(source.indexOf('          const shootingThreat ='), source.indexOf('        } else moveToward(player, new THREE.Vector3(ball.position.x'));
const blocks = source.slice(source.indexOf('        const shooterTeam = athletes[ball.lastOwner].team;'), source.indexOf("        if (!ball.scored && (ball.mode === 'shot' || ball.mode === 'loose'))"));
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handBlocker = '';
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'findHandBlocker') handBlocker = `const ${node.getText(ast)};`;
  ts.forEachChild(node, visit);
}
visit(ast);
const physics = readFileSync(new URL('../lib/basketball-physics.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '').replace(/export /g, '');
const code = ts.transpileModule(`${physics}\n${handBlocker}\nglobalThis.ballTouchesHand = ballTouchesHand; globalThis.decide = () => {${decisions}}; globalThis.block = () => {${blocks}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const mark = {team:0, position:new THREE.Vector3(), action:1, actionKind:'shoot', jump:0};
  const player = {team:1, position:new THREE.Vector3(0.8,0,0), velocity:new THREE.Vector3(), jump:0, jumpV:0, stamina:1, action:0, actionKind:'idle'};
  const math = Object.create(Math); math.random = () => 0.2;
  const h = {THREE, Math:math, mark, player, athletes:[mark,player], index:1, markIndex:0, now:5, dt:1/120,
    charging:true, shotPending:false, layingUp:false, dunking:false, onBall:true, reachDistance:0.8,
    SHOT_CONTEST_RADIUS:1.6, JUMP_STAMINA_COST:0.22, AI_STEAL_REACH:1.5, STEAL_STAMINA_COST:0.18, AI_STEAL_CHANCE:0.35, STEAL_POSSESSION_PROTECTION:1.8,
    HAND_CONTACT_RADIUS:0.25, BLOCK_SUCCESS_CHANCE:0.45, blockContactResolved:[0,0], blockAttemptUntil:[0,0], stealProtectionUntil:100,
    dribbleMove:'forward', dribbling:false, dribblePhase:0, ankleBreakWindow:0,
    layupShotActive:false, layupArc:null, onlineSessionRef:{current:null},
    ball:{owner:0,lastOwner:0,mode:'held',position:new THREE.Vector3(0.56,3,0),velocity:new THREE.Vector3(8,4,0)},
    previous:new THREE.Vector3(0.8,2.85,0),
    getHandPosition:p=>p.position.clone().add(new THREE.Vector3(0,1.9+p.jump,0)),
    isActiveIndex:()=>true, horizontalDistance:(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),
    markHighlight:()=>{}, showMessage:()=>{}, showBlockFeedback:()=>{}, sendPeer:()=>{},
    spendStamina:(p,cost)=>{if(p.stamina<cost)return false;p.stamina-=cost;return true;},
  };
  vm.createContext(h); vm.runInContext(code,h); return h;
}
test('a grounded gather is stealable even during the old possession-protection window',()=>{
  const h=harness(); h.decide();
  assert.equal(h.player.actionKind,'steal'); assert.equal(h.ball.owner,1); assert.equal(h.player.jumpV,0);
});
test('take-off triggers a timed block instead of an early jump during charge',()=>{
  const h=harness(); h.charging=false; h.shotPending=true; h.decide();
  assert.equal(h.player.actionKind,'jump'); assert.ok(h.blockAttemptUntil[1]>h.now);
  h.ball.owner=null; h.ball.mode='shot'; h.player.jump=0.95; h.ball.position.set(0.8,2.85,0); h.block();
  assert.equal(h.ball.mode,'loose'); assert.ok(h.ball.velocity.x<0);
});
test('defenders outside reach or without stamina cannot steal a gather',()=>{
  for(const unreachable of [true,false]){
    const h=harness(); if(unreachable)h.reachDistance=5; else h.player.stamina=0;
    h.decide(); assert.equal(h.ball.owner,0); assert.equal(h.player.jumpV,0);
  }
});


test('torso proximity cannot block a shot outside the palm volume',()=>{
  const h=harness(); h.player.jump=0.8; h.player.actionKind='jump'; h.blockAttemptUntil[1]=6;
  h.ball.owner=null; h.ball.mode='shot'; h.ball.position.set(0.8,2,0); h.previous.copy(h.ball.position);
  h.block(); assert.equal(h.ball.mode,'shot');
});
test('a missed hand block cannot reroll on every physics step',()=>{
  const h=harness(); h.player.jump=0.95; h.blockAttemptUntil[1]=6;
  h.ball.owner=null; h.ball.mode='shot'; h.ball.position.set(0.8,2.85,0);
  h.Math.random=()=>0.9; h.block(); assert.equal(h.ball.mode,'shot');
  h.Math.random=()=>0; h.block(); assert.equal(h.ball.mode,'shot');
  h.blockAttemptUntil[1]=6.5; h.block(); assert.equal(h.ball.mode,'loose');
});
test('a fast ball crossing the hand is detected without widening the contact radius',()=>{
  const h=harness(), hand=new THREE.Vector3(0,3,0);
  assert.equal(h.ballTouchesHand(new THREE.Vector3(-0.3,3,0),new THREE.Vector3(0.3,3,0),hand),true);
  assert.equal(h.ballTouchesHand(new THREE.Vector3(-0.3,3,0.3),new THREE.Vector3(0.3,3,0.3),hand),false);
});
