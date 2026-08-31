'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

type Phase = 'menu' | 'playing' | 'paused' | 'over';
type Team = 0 | 1;
type BallMode = 'held' | 'shot' | 'pass' | 'loose' | 'dead';

type Athlete = {
  group: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  team: Team;
  number: number;
  stealCooldown: number;
  stumbleSide: number;
  jump: number;
  jumpV: number;
  action: number;
  actionKind: MotionName;
  facing: number;
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  currentClip?: string;
  hand?: THREE.Object3D;
  leftHand?: THREE.Object3D;
  rightHand?: THREE.Object3D;
  feet?: [THREE.Object3D, THREE.Object3D];
  hips?: THREE.Object3D;
  head?: THREE.Object3D;
  rig?: THREE.Group;
  visual?: THREE.Group;
};

type MotionName = 'idle' | 'dribble' | 'dash' | 'shoot' | 'dunk' | 'jump' | 'steal' | 'stumble' | 'pass';
type DribbleMove = 'forward' | 'backward' | 'left' | 'right' | 'attack' | 'between' | 'cross-left' | 'cross-right' | 'burst' | 'burst-left' | 'burst-right' | 'spin-left' | 'spin-right';
type DribbleHand = 'left' | 'right';
type ShotStyle = 'normal' | 'step-left' | 'step-right' | 'fade';

type BallState = {
  group: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  owner: number | null;
  mode: BallMode;
  passTarget: number | null;
  lastOwner: number;
  shotAge: number;
  shotFlight: number;
  shotMake: boolean;
  shotPoints: number;
  scored: boolean;
};

type Runtime = { reset: () => void; setJersey: (color: string) => void };

const COLORS = ['#f25565', '#a979ff', '#ffd05f'];
const BALL_RADIUS = 0.125;
const COURT_LENGTH = 42;
const COURT_WIDTH = 23;
const COURT_HALF_X = COURT_LENGTH / 2;
const COURT_HALF_Z = COURT_WIDTH / 2;
const HOOP_X = 18.7;
const COURT_INSET = 1.1;
const PLAYER_RUN_SPEED = 4.25;
const SHOT_CONTEST_RADIUS = 2.25;
const BLOCK_HORIZONTAL_RADIUS = 0.82;
const DUNK_START_RADIUS = 5.2;
const DUNK_CONTEST_RADIUS = 1.05;
const PUTBACK_PLAYER_RADIUS = 2.65;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function Basketball3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>('menu');
  const runtimeRef = useRef<Runtime | null>(null);
  const jerseyRef = useRef(COLORS[0]);
  const [phase, setPhase] = useState<Phase>('menu');
  const [, setLocked] = useState(false);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [clock, setClock] = useState(90);
  const [charge, setCharge] = useState(0);
  const [dunkCharge, setDunkCharge] = useState(0);
  const [stamina, setStamina] = useState(1);
  const [message, setMessage] = useState('');
  const [blockImpact, setBlockImpact] = useState(false);
  const [jersey, setJersey] = useState(COLORS[0]);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const requestMouseLock = useCallback(() => {
    const canvas = canvasRef.current;
    if (new URLSearchParams(window.location.search).has('no-lock')) return;
    if (!canvas?.requestPointerLock) return;
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') void result.catch(() => setLocked(false));
    } catch {
      setLocked(false);
    }
  }, []);

  const startGame = useCallback(() => {
    runtimeRef.current?.reset();
    changePhase('playing');
    requestMouseLock();
  }, [changePhase, requestMouseLock]);

  const resume = useCallback(() => {
    changePhase('playing');
    requestMouseLock();
  }, [changePhase, requestMouseLock]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#84bee3');
    scene.fog = new THREE.Fog('#b9d7e8', 38, 82);
    // Keep the near plane close enough for the animated player's real hands and
    // forearms to remain visible from the eye camera. The previous camera-mounted
    // capsule arms were only a placeholder and could never match the mocap rig.
    // A slightly tighter first-person lens keeps players at normal human scale
    // instead of making mid-court opponents look unusually small.
    const camera = new THREE.PerspectiveCamera(72, 1, 0.035, 120);
    scene.add(camera);

    scene.add(new THREE.HemisphereLight('#e9f8ff', '#4f3427', 2.7));
    const sun = new THREE.DirectionalLight('#fff4dc', 4.4);
    sun.position.set(-10, 24, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    scene.add(sun);

    const cloudMaterial = new THREE.MeshStandardMaterial({ color: '#f5fbff', roughness: 1, flatShading: true, transparent: true, opacity: 0.88 });
    const addCloud = (x: number, y: number, z: number, scale: number) => {
      const cloud = new THREE.Group();
      [[0,0,0,1.3],[1.25,.15,0,1],[-1.15,.05,.1,.92],[.35,.5,.05,.85],[-.45,.42,0,.72]].forEach(([px,py,pz,s])=>{
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s as number, 1), cloudMaterial);
        puff.position.set(px as number,py as number,pz as number); cloud.add(puff);
      });
      cloud.position.set(x,y,z); cloud.scale.setScalar(scale); scene.add(cloud);
    };
    addCloud(5,14,-28,2.5); addCloud(-19,11,-23,1.8); addCloud(24,16,-34,2.1); addCloud(-2,19,-42,2.7);

    const court = new THREE.Mesh(
      new THREE.BoxGeometry(COURT_LENGTH, 0.5, COURT_WIDTH),
      new THREE.MeshStandardMaterial({ color: '#b96f3f', roughness: 0.64, metalness: 0.04 }),
    );
    court.position.y = -0.28;
    court.receiveShadow = true;
    scene.add(court);

    for (let x = -20.75; x < 21; x += 0.72) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(0.68, 0.018, COURT_WIDTH - 0.2),
        new THREE.MeshStandardMaterial({ color: Math.round(x * 10) % 2 ? '#c77a46' : '#d18550', roughness: 0.72 }),
      );
      plank.position.set(x, 0.006, 0);
      plank.receiveShadow = true;
      scene.add(plank);
    }

    const white = new THREE.MeshBasicMaterial({ color: '#fff7df' });
    const line = (x: number, z: number, w: number, d: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, d), white);
      mesh.position.set(x, 0.035, z);
      scene.add(mesh);
    };
    line(0, -11.05, 41.2, 0.08); line(0, 11.05, 41.2, 0.08);
    line(-20.55, 0, 0.08, 22.1); line(20.55, 0, 0.08, 22.1); line(0, 0, 0.08, 22.1);
    line(-17.3, -2.45, 6.5, 0.08); line(-17.3, 2.45, 6.5, 0.08); line(-14.05, 0, 0.08, 4.9);
    line(17.3, -2.45, 6.5, 0.08); line(17.3, 2.45, 6.5, 0.08); line(14.05, 0, 0.08, 4.9);

    const ringLine = (radius: number, x: number, start = 0, end = Math.PI * 2) => {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = start + (end - start) * (i / 72);
        points.push(new THREE.Vector3(x + Math.cos(a) * radius, 0.055, Math.sin(a) * radius));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      scene.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#fff7df' })));
    };
    ringLine(2.15, 0);
    ringLine(2.35, -14.05, -Math.PI / 2, Math.PI / 2);
    ringLine(2.35, 14.05, Math.PI / 2, Math.PI * 1.5);
    ringLine(7.25, -19.2, -1.17, 1.17);
    ringLine(7.25, 19.2, Math.PI - 1.17, Math.PI + 1.17);

    const wallColors = ['#c9c8c0','#b7bac7','#aeb0c1','#d4d0c7'];
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColors[0], roughness: 0.9, flatShading: true });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(48, 6.5, 0.6), wallMat);
    backWall.position.set(0, 3.0, -14.2); backWall.receiveShadow = true; scene.add(backWall);
    for(let i=0;i<13;i++){
      const panel=new THREE.Mesh(new THREE.BoxGeometry(3.7,6.2,0.62),new THREE.MeshStandardMaterial({color:wallColors[i%wallColors.length],roughness:.92,flatShading:true}));
      panel.position.set(-22.3+i*3.72,3.05,-14.05);panel.rotation.y=(i-6)*.006;scene.add(panel);
    }
    [-1,1].forEach((side)=>{
      for(let i=0;i<8;i++){
        const panel=new THREE.Mesh(new THREE.BoxGeometry(.62,6.1,3.45),new THREE.MeshStandardMaterial({color:wallColors[(i+1)%wallColors.length],roughness:.95,flatShading:true}));
        panel.position.set(side*23.2,3.0,-12.3+i*3.45);panel.rotation.z=side*.01;scene.add(panel);
      }
    });
    for (let x = -22; x <= 22; x += 4) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.35, 8, 0.8), new THREE.MeshStandardMaterial({ color: '#697580' }));
      column.position.set(x, 3.6, -13.72);
      scene.add(column);
    }
    const fenceMat = new THREE.MeshBasicMaterial({ color: '#253342', wireframe: true, transparent: true, opacity: 0.32 });
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(38, 5, 32, 7), fenceMat);
    fence.scale.x = 1.26;
    fence.position.set(0, 5.5, -13.7);
    scene.add(fence);

    const leafMat = new THREE.MeshStandardMaterial({color:'#8d9e22',roughness:1,flatShading:true});
    for(let i=0;i<46;i++){
      const leaf=new THREE.Mesh(new THREE.DodecahedronGeometry(.55+Math.random()*.35,0),leafMat);
      leaf.position.set(-21.5+i*.95,6.35+Math.sin(i*.7)*.18,13.35+(Math.random()-.5)*.5);leaf.rotation.set(Math.random(),Math.random(),Math.random());scene.add(leaf);
    }

    const benchMat=new THREE.MeshStandardMaterial({color:'#5b3a24',roughness:.88});
    const bench=new THREE.Mesh(new THREE.BoxGeometry(7,.25,.7),benchMat);bench.position.set(-5,.55,-12.65);bench.castShadow=true;scene.add(bench);
    [-7.4,-6.1,-4.8,-3.5,-2.2].forEach((x,i)=>{
      const fan=new THREE.Group();const shirt=new THREE.Mesh(new THREE.CapsuleGeometry(.18,.45,2,6),new THREE.MeshStandardMaterial({color:['#53bfd3','#f26471','#8b72cf','#f3c75b'][i%4],flatShading:true}));shirt.position.y=1.05;fan.add(shirt);
      const head=new THREE.Mesh(new THREE.SphereGeometry(.15,8,6),new THREE.MeshStandardMaterial({color:'#c98c65',flatShading:true}));head.position.y=1.55;fan.add(head);fan.position.set(x,0,-12.65);scene.add(fan);
    });
    for (let x = -18; x <= 18; x += 6) {
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 10 + (Math.abs(x) % 5), 5),
        new THREE.MeshStandardMaterial({ color: x % 12 ? '#526779' : '#657d8f', roughness: 1 }),
      );
      building.position.set(x, 4, -21 - Math.abs(x) * 0.08);
      scene.add(building);
    }

    const makeHoop = (side: Team) => {
      const sign = side === 0 ? -1 : 1;
      const group = new THREE.Group();
      const poleMat = new THREE.MeshStandardMaterial({ color: '#29333c', metalness: 0.75, roughness: 0.25 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 4.4, 14), poleMat);
      pole.position.set(sign * 20.3, 2.18, 0);
      pole.castShadow = true;
      group.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.18, 0.18), poleMat);
      arm.position.set(sign * 19.78, 3.8, 0);
      group.add(arm);
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.25, 2.1),
        new THREE.MeshPhysicalMaterial({ color: '#e9fbff', transmission: 0.42, transparent: true, opacity: 0.76, roughness: 0.12 }),
      );
      board.position.set(sign * 19.2, 3.55, 0);
      board.castShadow = true;
      group.add(board);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.055, 12, 40), new THREE.MeshStandardMaterial({ color: '#ff5b22', roughness: 0.4 }));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(sign * HOOP_X, 3.05, 0);
      rim.castShadow = true;
      group.add(rim);
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(0.44, 0.27, 0.72, 12, 5, true),
        new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.48 }),
      );
      net.position.set(sign * HOOP_X, 2.68, 0);
      group.add(net);
      scene.add(group);
    };
    makeHoop(0); makeHoop(1);

    const createAthlete = (color: string, number: number) => {
      const group = new THREE.Group();
      const body = new THREE.Group();
      body.name = 'proceduralBody';
      group.add(body);
      const skin = new THREE.MeshStandardMaterial({ color: number % 3 === 0 ? '#8b5438' : '#c9855d', roughness: 0.78, flatShading: true });
      const jersey = new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true });
      const shorts = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.52), roughness: 0.68, flatShading: true });
      const dark = new THREE.MeshStandardMaterial({ color: '#111820', roughness: 0.72, flatShading: true });
      const shoe = new THREE.MeshStandardMaterial({ color: number % 2 ? '#f4f4f1' : '#141b22', roughness: 0.6, flatShading: true });

      const pelvis = new THREE.Group(); pelvis.name = 'pelvis'; pelvis.position.y = 0.94; body.add(pelvis);
      const waist = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.34, 0.48), shorts);
      waist.name = 'shorts'; pelvis.add(waist);
      const torsoPivot = new THREE.Group(); torsoPivot.name = 'torsoPivot'; torsoPivot.position.y = 0.22; pelvis.add(torsoPivot);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.58, 3, 8), jersey);
      torso.position.y = 0.46; torso.scale.set(1.12, 1, 0.74); torso.name = 'jersey'; torsoPivot.add(torso);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 8), skin); neck.position.y = 1.03; torsoPivot.add(neck);
      const headPivot = new THREE.Group(); headPivot.name = 'headPivot'; headPivot.position.y = 1.23; torsoPivot.add(headPivot);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin); head.scale.y = 1.08; headPivot.add(head);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.278, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), dark); hair.position.y = 0.08; headPivot.add(hair);

      const buildArm = (side: -1 | 1) => {
        const shoulder = new THREE.Group(); shoulder.name = side < 0 ? 'leftShoulder' : 'rightShoulder'; shoulder.position.set(side * 0.48, 0.82, 0); torsoPivot.add(shoulder);
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.37, 3, 7), skin); upper.position.y = -0.27; shoulder.add(upper);
        const elbow = new THREE.Group(); elbow.name = side < 0 ? 'leftElbow' : 'rightElbow'; elbow.position.y = -0.56; shoulder.add(elbow);
        const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 3, 7), skin); lower.position.y = -0.24; elbow.add(lower);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), skin); hand.position.y = -0.5; hand.name = side < 0 ? 'leftHand' : 'rightHand'; elbow.add(hand);
      };
      buildArm(-1); buildArm(1);

      const buildLeg = (side: -1 | 1) => {
        const hip = new THREE.Group(); hip.name = side < 0 ? 'leftHip' : 'rightHip'; hip.position.set(side * 0.22, -0.08, 0); pelvis.add(hip);
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.48, 3, 7), skin); upper.position.y = -0.34; hip.add(upper);
        const shortLeg = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.37, 0.37), shorts); shortLeg.position.y = -0.15; hip.add(shortLeg);
        const knee = new THREE.Group(); knee.name = side < 0 ? 'leftKnee' : 'rightKnee'; knee.position.y = -0.7; hip.add(knee);
        const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.43, 3, 7), skin); lower.position.y = -0.3; knee.add(lower);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.46), shoe); foot.position.set(0, -0.61, 0.1); foot.name = side < 0 ? 'leftFoot' : 'rightFoot'; knee.add(foot);
      };
      buildLeg(-1); buildLeg(1);

      const numberCanvas=document.createElement('canvas');numberCanvas.width=128;numberCanvas.height=128;const nctx=numberCanvas.getContext('2d')!;nctx.clearRect(0,0,128,128);nctx.fillStyle='#fff';nctx.font='900 78px Arial';nctx.textAlign='center';nctx.textBaseline='middle';nctx.fillText(String(number),64,68);
      const numberTexture=new THREE.CanvasTexture(numberCanvas);numberTexture.colorSpace=THREE.SRGBColorSpace;
      const backNumber=new THREE.Mesh(new THREE.PlaneGeometry(.45,.5),new THREE.MeshBasicMaterial({map:numberTexture,transparent:true,side:THREE.DoubleSide}));backNumber.position.set(0,.48,-.37);backNumber.rotation.y=Math.PI;torsoPivot.add(backNumber);
      const disc = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 30), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.035; disc.name = 'selector'; disc.visible = false; group.add(disc);
      group.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      scene.add(group);
      return group;
    };

    const starts = [
      new THREE.Vector3(-7.2, 0, 0), new THREE.Vector3(-8.8, 0, -5.2), new THREE.Vector3(-8.8, 0, 5.2),
      new THREE.Vector3(7.2, 0, 0), new THREE.Vector3(8.8, 0, -5.1), new THREE.Vector3(8.8, 0, 5.1),
    ];
    const athletes: Athlete[] = starts.map((position, index) => ({
      group: createAthlete(index < 3 ? jerseyRef.current : '#3889f7', [16, 11, 23, 3, 8, 14][index]),
      position: position.clone(), velocity: new THREE.Vector3(), team: index < 3 ? 0 : 1,
      stealCooldown: 0.55 + index * 0.14, stumbleSide: index % 2 ? -1 : 1,
      number: [16, 11, 23, 3, 8, 14][index], jump: 0, jumpV: 0, action: 0, facing: index < 3 ? Math.PI / 2 : -Math.PI / 2,
      actionKind: 'idle',
    }));
    athletes[0].group.getObjectByName('selector')!.visible = false;
    athletes[0].group.visible = true;

    let rigCancelled = false;
    let viewModel: THREE.Group | undefined;
    let viewMixer: THREE.AnimationMixer | undefined;
    let viewActions: Map<string, THREE.AnimationAction> | undefined;
    let viewCurrentClip = 'Mixamo_Run';
    const rigLoader = new FBXLoader();
    void Promise.all([
      rigLoader.loadAsync('/assets/basketball/140_06.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_01.fbx'),
      rigLoader.loadAsync('/assets/basketball/09_01.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_02.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_15.fbx'),
      rigLoader.loadAsync('/assets/basketball/16_01.fbx'),
      rigLoader.loadAsync('/assets/basketball/102_27.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_12.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_13.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_06.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_08.fbx'),
      rigLoader.loadAsync('/assets/basketball/06_09.fbx'),
      rigLoader.loadAsync('/assets/basketball/102_30.fbx'),
      rigLoader.loadAsync('/assets/basketball/102_31.fbx'),
      rigLoader.loadAsync('/assets/basketball/102_32.fbx'),
      rigLoader.loadAsync('/assets/basketball/102_10.fbx'),
      rigLoader.loadAsync('/assets/basketball/124_06.fbx'),
      rigLoader.loadAsync('/assets/basketball/mixamo/dribble.fbx'),
      rigLoader.loadAsync('/assets/basketball/mixamo/steal.fbx'),
      rigLoader.loadAsync('/assets/basketball/mixamo/block.fbx'),
      rigLoader.loadAsync('/assets/basketball/mixamo/shot.fbx'),
      rigLoader.loadAsync('/assets/basketball/mixamo/run.fbx'),
    ]).then(([character, walkMotion, runMotion, dribbleMotion, shotMotion, jumpMotion, defenseMotion, crossoverMotion, betweenLegsMotion, backwardMotion, leftDribbleMotion, rightDribbleMotion, burstMotion, rightDriveMotion, leftDriveMotion, sprintMotion, dunkMotion, mixamoCharacter, mixamoSteal, mixamoBlock, mixamoShot, mixamoRun]) => {
      if (rigCancelled) return;
      const sourceClip = (source: THREE.Group, name: string) => {
        const sourceAnimation = source.animations[0];
        // The free CMU conversion has a T-pose at frame zero. Keeping it inside
        // a loop creates the distracting side-to-side arm snap at every repeat.
        const endFrame = Math.max(2, Math.floor(sourceAnimation.duration * 30));
        const clip = THREE.AnimationUtils.subclip(sourceAnimation, name, 1, endFrame, 30);
        clip.optimize();
        return clip;
      };
      const idleClip = sourceClip(character, 'Idle_Loop');
      const walkClip = sourceClip(walkMotion, 'Walk_Loop');
      const runClip = sourceClip(runMotion, 'Run_Loop');
      const dribbleClip = sourceClip(dribbleMotion, 'Basketball_Dribble_Loop');
      const jumpClip = sourceClip(jumpMotion, 'Basketball_Jump');
      const stealClip = THREE.AnimationUtils.subclip(defenseMotion.animations[0], 'Basketball_Steal', 0, 38, 30);
      const crossoverClip = THREE.AnimationUtils.subclip(crossoverMotion.animations[0], 'Basketball_Crossover', 84, 150, 30);
      const betweenLegsClip = THREE.AnimationUtils.subclip(betweenLegsMotion.animations[0], 'Basketball_BetweenLegs', 378, 438, 30);
      const backwardClip = sourceClip(backwardMotion, 'Basketball_Dribble_Backward');
      const leftDribbleClip = sourceClip(leftDribbleMotion, 'Basketball_Dribble_Left');
      const rightDribbleClip = sourceClip(rightDribbleMotion, 'Basketball_Dribble_Right');
      const burstClip = sourceClip(burstMotion, 'Basketball_Drive_Straight');
      const rightDriveClip = sourceClip(rightDriveMotion, 'Basketball_Drive_Right');
      const leftDriveClip = sourceClip(leftDriveMotion, 'Basketball_Drive_Left');
      const sprintClip = sourceClip(sprintMotion, 'Basketball_Sprint');
      const dunkClip = THREE.AnimationUtils.subclip(dunkMotion.animations[0], 'Basketball_Dunk', 54, 126, 30);
      const fullShot = shotMotion.animations[0];
      // 06_15 contains a complete set-to-release motion. The useful portion is
      // frames 45-105: hands rise through 45-75, release at roughly 81-84, then
      // follow through. Starting at frame 82 skipped the lift and made the ball
      // look as if it suddenly left the athlete's chest.
      const gatherClip = THREE.AnimationUtils.subclip(fullShot, 'Basketball_Gather', 45, 75, 30);
      const shotClip = THREE.AnimationUtils.subclip(fullShot, 'Basketball_Shot', 69, 105, 30);
      const passClip = THREE.AnimationUtils.subclip(fullShot, 'Basketball_Pass', 72, 101, 30);
      const motionClips = [idleClip, walkClip, runClip, dribbleClip, backwardClip, leftDribbleClip, rightDribbleClip, crossoverClip, betweenLegsClip, burstClip, rightDriveClip, leftDriveClip, sprintClip, gatherClip, shotClip, dunkClip, passClip, jumpClip, stealClip];
      motionClips.forEach((clip) => {
        clip.tracks.forEach((track) => {
          if (!/hips.*\.position$/i.test(track.name) || track.values.length < 3) return;
          const values = track.values;
          const rootX = values[0]; const rootZ = values[2];
          for (let frame = 0; frame < values.length; frame += 3) {
            values[frame] = rootX;
            values[frame + 2] = rootZ;
          }
        });
        clip.optimize();
      });
      const makeViewClip = (source: THREE.Group, name: string) => {
        const clip = source.animations[0].clone();
        clip.name = name;
        clip.tracks.forEach((track) => {
          if (!/Hips\.position$/i.test(track.name) || track.values.length < 3) return;
          const values = track.values;
          const rootX = values[0]; const rootZ = values[2];
          for (let frame = 0; frame < values.length; frame += 3) {
            values[frame] = rootX;
            values[frame + 2] = rootZ;
          }
        });
        clip.optimize();
        return clip;
      };
      const viewClips = [
        makeViewClip(mixamoCharacter, 'Mixamo_Dribble'),
        makeViewClip(mixamoSteal, 'Mixamo_Steal'),
        makeViewClip(mixamoBlock, 'Mixamo_Block'),
        makeViewClip(mixamoShot, 'Mixamo_Shot'),
        makeViewClip(mixamoRun, 'Mixamo_Run'),
      ];

      // The controlled guard is 1.98 m; the remaining front-court players are
      // progressively taller. The camera reads the guard's actual head bone,
      // so opponents now sit above the player's eye line for the right reason.
      const athleteHeights = [1.98, 2.06, 2.1, 2.08, 2.14, 2.06];
      athletes.forEach((player, index) => {
        const model = cloneSkeleton(character) as THREE.Group;
        model.name = 'rigModel';
        model.animations = [];
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = athleteHeights[index] / Math.max(0.01, bounds.max.y - bounds.min.y);
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);

        const visual = new THREE.Group();
        visual.name = 'rigVisual';
        visual.rotation.y = 0;
        visual.add(model);
        const teamColor = index < 3 ? jerseyRef.current : '#3789ef';
        const teamMaterials: Array<THREE.MeshStandardMaterial | THREE.MeshPhongMaterial> = [];
        const skinnedMeshes: THREE.SkinnedMesh[] = [];
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          if (object instanceof THREE.SkinnedMesh) skinnedMeshes.push(object);
          const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((entry) => entry.clone());
          object.material = materials.length === 1 ? materials[0] : materials;
          materials.forEach((entry) => {
            if (!('color' in entry) || !(entry.color instanceof THREE.Color)) return;
            if (entry.name !== 'Purple' && entry.name !== 'LightBlue') return;
            entry.color.set(teamColor);
            if ('shininess' in entry) (entry as THREE.MeshPhongMaterial).shininess = 8;
            teamMaterials.push(entry as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial);
          });
        });
        const primarySkeleton = skinnedMeshes[0]?.skeleton;
        if (primarySkeleton) skinnedMeshes.slice(1).forEach((mesh) => mesh.bind(primarySkeleton, mesh.bindMatrix));
        player.group.userData.teamMaterials = teamMaterials;

        const oldBody = player.group.getObjectByName('proceduralBody');
        if (oldBody) player.group.remove(oldBody);
        player.group.add(visual);

        const numberCanvas = document.createElement('canvas');
        numberCanvas.width = 128; numberCanvas.height = 128;
        const context = numberCanvas.getContext('2d')!;
        context.fillStyle = '#fff'; context.font = '900 82px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(String(player.number), 64, 68);
        const texture = new THREE.CanvasTexture(numberCanvas); texture.colorSpace = THREE.SRGBColorSpace;
        const numberMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.54), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
        numberMesh.name = 'rigNumber'; numberMesh.position.set(0, 1.43, -0.36); numberMesh.rotation.y = Math.PI;
        numberMesh.visible = index !== 0;
        player.group.add(numberMesh);

        const mixer = new THREE.AnimationMixer(model);
        const actions = new Map<string, THREE.AnimationAction>();
        motionClips.forEach((clip) => actions.set(clip.name, mixer.clipAction(clip)));
        const idle = actions.get('Idle_Loop');
        idle?.reset().fadeIn(0.01).play();
        player.mixer = mixer;
        player.actions = actions;
        player.currentClip = 'Idle_Loop';
        player.leftHand = primarySkeleton?.getBoneByName('HandL') ?? undefined;
        player.rightHand = primarySkeleton?.getBoneByName('HandR') ?? undefined;
        player.hand = player.rightHand;
        player.hips = primarySkeleton?.getBoneByName('Hips') ?? undefined;
        player.head = primarySkeleton?.getBoneByName('Head') ?? undefined;
        const leftFoot = primarySkeleton?.getBoneByName('FootL');
        const rightFoot = primarySkeleton?.getBoneByName('FootR');
        if (leftFoot && rightFoot) player.feet = [leftFoot, rightFoot];
        player.rig = model;
        player.visual = visual;
      });

      // Keep the Mixamo geometry intact. A shader mask reveals the animated arms
      // and lower legs without cutting triangles out of the skinned mesh. Head,
      // torso and shoulder-joint weights never render, so they cannot cross the
      // camera or create the broken polygons caused by indexed-geometry slicing.
      viewModel = cloneSkeleton(mixamoCharacter) as THREE.Group;
      const viewBounds = new THREE.Box3().setFromObject(viewModel);
      const viewCenter = viewBounds.getCenter(new THREE.Vector3());
      // The camera-mounted body is a view model, so it needs a little less scale
      // than the world athlete or nearby hands make the player feel oversized.
      const viewScale = 1.94 / Math.max(0.01, viewBounds.max.y - viewBounds.min.y);
      viewModel.scale.setScalar(viewScale);
      viewModel.position.set(-viewCenter.x * viewScale, -viewBounds.min.y * viewScale - 1.82, -0.58 - viewCenter.z * viewScale);
      viewModel.rotation.y = Math.PI;
      viewModel.name = 'firstPersonRig';
      const viewSkinnedMeshes: THREE.SkinnedMesh[] = [];
      viewModel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object instanceof THREE.SkinnedMesh) viewSkinnedMeshes.push(object);
        if (object.name !== 'Beta_Surface') {
          object.visible = false;
          return;
        }
        const sourceGeometry = object.geometry;
        const skinIndex = sourceGeometry.attributes.skinIndex;
        const skinWeight = sourceGeometry.attributes.skinWeight;
        if (object instanceof THREE.SkinnedMesh && skinIndex && skinWeight) {
          const visibleBones = new Set(object.skeleton.bones
            .map((bone, boneIndex) => (/Arm|ForeArm|Hand|UpLeg|Leg|Foot|Toe/i.test(bone.name) && !/Shoulder/i.test(bone.name) ? boneIndex : -1))
            .filter((boneIndex) => boneIndex >= 0));
          const mask = new Float32Array(sourceGeometry.attributes.position.count);
          for (let vertex = 0; vertex < mask.length; vertex += 1) {
            const indices = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
            const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
            mask[vertex] = indices.reduce((total, boneIndex, influenceIndex) => total + (visibleBones.has(boneIndex) ? weights[influenceIndex] : 0), 0);
          }
          object.geometry = sourceGeometry.clone();
          object.geometry.setAttribute('viewPartMask', new THREE.BufferAttribute(mask, 1));
        }
        object.frustumCulled = false;
        object.renderOrder = 12;
        const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((entry) => entry.clone());
        object.material = materials.length === 1 ? materials[0] : materials;
        materials.forEach((entry) => {
          entry.depthTest = true;
          entry.depthWrite = true;
          if ('color' in entry && entry.color instanceof THREE.Color) entry.color.set('#c3835d');
          entry.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
            shader.vertexShader = shader.vertexShader
              .replace('#include <common>', '#include <common>\nattribute float viewPartMask;\nvarying float vViewPartMask;')
              .replace('#include <begin_vertex>', '#include <begin_vertex>\nvViewPartMask = viewPartMask;');
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', '#include <common>\nvarying float vViewPartMask;')
              .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vViewPartMask < 0.045) discard;');
          };
          entry.customProgramCacheKey = () => 'first-person-limbs-v2';
        });
      });
      const viewSkeleton = viewSkinnedMeshes[0]?.skeleton;
      if (viewSkeleton) viewSkinnedMeshes.slice(1).forEach((mesh) => mesh.bind(viewSkeleton, mesh.bindMatrix));
      camera.add(viewModel);
      viewMixer = new THREE.AnimationMixer(viewModel);
      viewActions = new Map<string, THREE.AnimationAction>();
      viewClips.forEach((clip) => viewActions?.set(clip.name, viewMixer!.clipAction(clip)));
      viewActions.get('Mixamo_Run')?.reset().setEffectiveTimeScale(0.68).play();
      athletes[0].group.visible = false;
    }).catch((error) => console.error('Character rig failed to load', error));

    const ballGroup = new THREE.Group();
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 18), new THREE.MeshStandardMaterial({ color: '#ed7622', roughness: 0.66 }));
    ballMesh.castShadow = true; ballGroup.add(ballMesh);
    const seamMat = new THREE.MeshBasicMaterial({ color: '#2c160b' });
    const seam1 = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS + 0.001, 0.0065, 6, 40), seamMat); ballGroup.add(seam1);
    const seam2 = seam1.clone(); seam2.rotation.y = Math.PI / 2; ballGroup.add(seam2);
    const seam3 = seam1.clone(); seam3.rotation.x = Math.PI / 2; ballGroup.add(seam3);
    scene.add(ballGroup);
    const ball: BallState = {
      group: ballGroup, position: new THREE.Vector3(), velocity: new THREE.Vector3(), owner: 0, mode: 'held', passTarget: null,
      lastOwner: 0, shotAge: 0, shotFlight: 1.1, shotMake: false, shotPoints: 2, scored: false,
    };

    const keys: Record<string, boolean> = {};
    let cameraYaw = Math.PI / 2;
    let cameraPitch = -0.08;
    let cameraEyeHeight = 1.86;
    let charging = false;
    let shotCharge = 0;
    let shotStyle: ShotStyle = 'normal';
    let shotPending = false;
    let pendingShotPower = 0;
    let shotReleaseDelay = 0;
    let shotGatherElapsed = 0;
    let shotAirElapsed = 0;
    let queuedShotStyle: ShotStyle = 'normal';
    let queuedShotUntil = 0;
    let delayedDashAt = 0;
    let recentDirection: '' | 'a' | 'd' | 's' = '';
    let recentDirectionAt = 0;
    const shotStepStart = new THREE.Vector3();
    const shotStepEnd = new THREE.Vector3();
    const shotAirStart = new THREE.Vector3();
    const shotAirEnd = new THREE.Vector3();
    let dunkCharging = false;
    let dunkPower = 0;
    let dunking = false;
    let dunkElapsed = 0;
    let dunkHasBall = false;
    let dunkWasPerfect = false;
    let dunkResolved = false;
    const dunkStartPosition = new THREE.Vector3();
    const dunkFinishPosition = new THREE.Vector3();
    let dribbling = false;
    let dribbleGrace = 0;
    let dribbleMove: DribbleMove = 'forward';
    let dribbleSequenceMove: DribbleMove = 'forward';
    let dribblePhase = 0;
    let dribbleHand: DribbleHand = 'right';
    let dribbleFromHand: DribbleHand = 'right';
    let dribbleToHand: DribbleHand = 'right';
    let ankleBreakWindow = 0;
    let dashTime = 0;
    let dashCooldown = 0;
    let dashDuration = 0.34;
    let dashWithBall = false;
    let spinDirection: -1 | 0 | 1 = 0;
    const dashDirection = new THREE.Vector3(1, 0, 0);
    let sprint = 1;
    let gameTime = 90;
    let gameScore: [number, number] = [0, 0];
    let nextPossession: Team = 0;
    let resetAt = 0;
    let aiShotCooldown = 1.5;
    const aiDecisionCooldown = Array.from({ length: athletes.length }, () => 0);
    const aiPassCooldown = Array.from({ length: athletes.length }, () => 0);
    let uiAt = 0;
    let last = performance.now() / 1000;
    let dragLooking = false;
    let blockCameraKick = 0;
    let blockFeedbackTimer: number | undefined;

    const showMessage = (text: string, duration = 700) => {
      setMessage(text);
      window.setTimeout(() => setMessage((current) => current === text ? '' : current), duration);
    };
    const showBlockFeedback = () => {
      blockCameraKick = 0.24;
      setBlockImpact(false);
      window.requestAnimationFrame(() => setBlockImpact(true));
      if (blockFeedbackTimer) window.clearTimeout(blockFeedbackTimer);
      blockFeedbackTimer = window.setTimeout(() => setBlockImpact(false), 760);
    };
    const hoop = (team: Team) => new THREE.Vector3(team === 0 ? HOOP_X : -HOOP_X, 3.05, 0);
    const oppositeHand = (hand: DribbleHand): DribbleHand => hand === 'right' ? 'left' : 'right';
    const getHandPosition = (player: Athlete, hand: DribbleHand) => {
      player.group.updateMatrixWorld(true);
      const bone = hand === 'left' ? player.leftHand : player.rightHand;
      if (bone) {
        const position = bone.getWorldPosition(new THREE.Vector3());
        position.y -= BALL_RADIUS * 0.32;
        return position;
      }
      const side = hand === 'left' ? -1 : 1;
      return player.group.localToWorld(new THREE.Vector3(side * 0.38, 1.08, 0.2));
    };
    const getGatherPosition = (player: Athlete) => {
      const left = getHandPosition(player, 'left');
      const right = getHandPosition(player, 'right');
      return left.add(right).multiplyScalar(0.5).add(new THREE.Vector3(0, BALL_RADIUS * 0.22, 0));
    };

    const resetPositions = (team: Team = 0) => {
      athletes.forEach((player, index) => {
        player.position.copy(starts[index]); player.velocity.set(0, 0, 0); player.jump = 0; player.jumpV = 0; player.action = 0; player.actionKind = 'idle'; player.stealCooldown = 0.55 + index * 0.14; player.stumbleSide = index % 2 ? -1 : 1;
        aiDecisionCooldown[index] = 0.2 + index * 0.08; aiPassCooldown[index] = 0;
      });
      const owner = team === 0 ? 0 : 3;
      ball.owner = owner; ball.lastOwner = owner; ball.mode = 'held'; ball.passTarget = null; ball.scored = false; ball.velocity.set(0, 0, 0);
      charging = false; shotCharge = 0; shotStyle = 'normal'; shotPending = false; pendingShotPower = 0; shotReleaseDelay = 0; shotGatherElapsed = 0; shotAirElapsed = 0; queuedShotStyle = 'normal'; queuedShotUntil = 0; delayedDashAt = 0; recentDirection = ''; recentDirectionAt = 0; ankleBreakWindow = 0; dunkCharging = false; dunkPower = 0; dunking = false; dunkElapsed = 0; dunkHasBall = false; dunkResolved = false; dribbling = false; dribbleGrace = 0; dribbleMove = 'forward'; dribbleSequenceMove = 'forward'; dribblePhase = 0; dribbleHand = 'right'; dribbleFromHand = 'right'; dribbleToHand = 'right'; dashTime = 0; dashCooldown = 0; spinDirection = 0; resetAt = 0; aiShotCooldown = 1.2;
    };

    const resetGame = () => {
      gameTime = 90; gameScore = [0, 0]; sprint = 1; cameraYaw = Math.PI / 2; cameraPitch = -0.08; cameraEyeHeight = 1.86;
      resetPositions(0); setScore([0, 0]); setClock(90); setCharge(0); setDunkCharge(0); setStamina(1); showMessage('开球！', 800);
    };

    const resolveShotStyle = (): ShotStyle => {
      if (keys.space) {
        if (keys.s && !keys.w) return 'fade';
        if (keys.a && !keys.d) return 'step-left';
        if (keys.d && !keys.a) return 'step-right';
      }
      if (performance.now() <= queuedShotUntil) return queuedShotStyle;
      return 'normal';
    };

    const shotDirection = (style: ShotStyle) => {
      const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      if (style === 'step-left') return right.multiplyScalar(-1);
      if (style === 'step-right') return right;
      if (style === 'fade') return forward.multiplyScalar(-1);
      return new THREE.Vector3();
    };

    const beginShot = () => {
      if (ball.owner !== 0 || dunkCharging || dunking || shotPending) return false;
      const me = athletes[0];
      shotStyle = resolveShotStyle();
      queuedShotStyle = 'normal'; queuedShotUntil = 0;
      delayedDashAt = 0;
      charging = true; shotCharge = 0; shotGatherElapsed = 0; shotAirElapsed = 0;
      dribbling = false; dribbleGrace = 0; dashTime = 0; dashWithBall = false; spinDirection = 0;
      shotStepStart.copy(me.position);
      const gatherDistance = shotStyle === 'fade' ? 0.9 : shotStyle === 'normal' ? 0 : 1.3;
      shotStepEnd.copy(shotStepStart).addScaledVector(shotDirection(shotStyle), gatherDistance);
      me.velocity.set(0, 0, 0); me.action = 1.35; me.actionKind = 'shoot';
      if (shotStyle === 'fade') showMessage('后仰跳投', 650);
      else if (shotStyle === 'step-left') showMessage('左横撤步跳投', 650);
      else if (shotStyle === 'step-right') showMessage('右横撤步跳投', 650);
      return true;
    };

    const queueUserShot = () => {
      if (!charging) return;
      if (ball.owner !== 0) { charging = false; shotCharge = 0; shotStyle = 'normal'; setCharge(0); return; }
      const me = athletes[0];
      pendingShotPower = shotCharge;
      charging = false; shotPending = true; shotCharge = 0; shotAirElapsed = 0;
      // At 1.25x playback, 0.32-0.35 s lands on source frames 81-82 and
      // coincides with the apex of the gameplay jump.
      shotReleaseDelay = shotStyle === 'fade' ? 0.35 : shotStyle === 'normal' ? 0.32 : 0.33;
      shotAirStart.copy(me.position);
      const airDistance = shotStyle === 'fade' ? 1.28 : shotStyle === 'normal' ? 0 : 0.92;
      shotAirEnd.copy(shotAirStart).addScaledVector(shotDirection(shotStyle), airDistance);
      const jumpSpeed = shotStyle === 'fade' ? 5.85 : shotStyle === 'normal' ? 5.15 : 5.45;
      me.jumpV = Math.max(me.jumpV, jumpSpeed);
      // Keep the follow-through through landing, but hand control back quickly
      // instead of freezing the player for more than a second after release.
      me.action = shotStyle === 'fade' ? 0.88 : shotStyle === 'normal' ? 0.78 : 0.82;
      me.actionKind = 'shoot';
      setCharge(0);
    };

    const releaseShot = (owner: number, power: number) => {
      if (ball.owner !== owner) return;
      const player = athletes[owner];
      player.jumpV = Math.max(player.jumpV, owner === 0 && shotStyle === 'fade' ? 5.35 : 5.15);
      player.action = owner === 0 ? Math.max(player.action, 0.44) : 1.15;
      player.actionKind = 'shoot';
      ball.owner = null; ball.mode = 'shot'; ball.lastOwner = owner; ball.shotAge = 0; ball.shotFlight = 1.02 + Math.abs(player.position.x) * 0.014; ball.scored = false;
      const target = hoop(player.team);
      const distance = player.position.distanceTo(new THREE.Vector3(target.x, 0, target.z));
      const ideal = clamp(0.54 + distance * 0.012, 0.58, 0.82);
      const defenders = athletes.filter((other, index) => index !== owner && other.team !== player.team);
      const nearestDefender = defenders.reduce<{ player: Athlete | null; distance: number }>((nearest, defender) => {
        const distance = new THREE.Vector2(defender.position.x - player.position.x, defender.position.z - player.position.z).length();
        return distance < nearest.distance ? { player: defender, distance } : nearest;
      }, { player: null, distance: Infinity });
      const activeBlock = nearestDefender.player
        && (nearestDefender.player.jump > 0.16 || nearestDefender.player.actionKind === 'jump' && nearestDefender.player.action > 0)
        ? 0.34 + Math.min(0.22, nearestDefender.player.jump * 0.16)
        : 0;
      const contestStrength = nearestDefender.distance < SHOT_CONTEST_RADIUS
        ? clamp((1 - nearestDefender.distance / SHOT_CONTEST_RADIUS) * 0.78 + activeBlock, 0.12, 1)
        : 0;
      const stylePenalty = owner === 0 ? shotStyle === 'fade' ? 0.055 : shotStyle === 'normal' ? 0 : 0.025 : 0;
      const baseAccuracy = owner === 0 ? 0.9 : 0.76;
      const timingPenalty = Math.abs(power - ideal) * (owner === 0 ? 1.6 : 1.25);
      const chance = clamp(baseAccuracy - timingPenalty - distance * 0.02 - contestStrength * 0.55 - stylePenalty, 0.08, owner === 0 ? 0.89 : 0.78);
      const forcedMiss = contestStrength > 0 && Math.random() < 0.08 + contestStrength * 0.42;
      ball.shotMake = !forcedMiss && Math.random() < chance;
      if (contestStrength > 0.12) {
        const label = owner === 0
          ? contestStrength > 0.62 ? '严重干扰！' : '投篮受干扰！'
          : player.team === 0 ? '队友投篮受干扰！' : contestStrength > 0.62 ? '强力干扰！' : '成功干扰！';
        showMessage(label, 780);
      }
      ball.shotPoints = distance > 7 ? 3 : 2;
      const aim = target.clone();
      if (!ball.shotMake) aim.z += (Math.random() > 0.5 ? 1 : -1) * (0.72 + Math.random() * 0.6);
      const from = getGatherPosition(player);
      ball.position.copy(from);
      const t = ball.shotFlight;
      ball.velocity.set((aim.x - from.x) / t, (aim.y - from.y + 4.9 * t * t) / t, (aim.z - from.z) / t);
      charging = false; shotPending = false; shotReleaseDelay = 0; shotCharge = 0; dunkCharging = false; dunkPower = 0; dunking = false; dunkElapsed = 0; dunkHasBall = false; dunkResolved = false; dribbling = false; dribbleGrace = 0; dribbleMove = 'forward'; dashTime = 0; setCharge(0); setDunkCharge(0);
    };

    const beginDunk = () => {
      if (charging || shotPending || dunkCharging || dunking) return;
      const me = athletes[0];
      const target = hoop(me.team);
      const distance = new THREE.Vector2(me.position.x - target.x, me.position.z - target.z).length();
      const isPutback = ball.owner !== 0;
      if (!isPutback && distance > DUNK_START_RADIUS) { showMessage('靠近篮筐才能扣篮', 850); return; }
      if (isPutback && distance > PUTBACK_PLAYER_RADIUS) {
        showMessage('靠近篮筐才能补扣', 780);
        return;
      }
      dunkCharging = true; dunkPower = ball.owner === 0 ? 0 : 0.68; dribbling = false; dribbleGrace = 0; dashTime = 0;
      me.action = 0.5; me.actionKind = 'shoot';
      showMessage(ball.owner === 0 ? '扣篮蓄力' : '补扣准备', 500);
    };

    const releaseDunk = () => {
      if (!dunkCharging) return;
      dunkCharging = false;
      const me = athletes[0];
      const target = hoop(me.team);
      const rimDirection = Math.sign(target.x - me.position.x) || 1;
      me.facing = rimDirection > 0 ? Math.PI / 2 : -Math.PI / 2;
      me.jumpV = Math.max(me.jumpV, 7.7 + dunkPower * 0.85);
      me.action = 1.55; me.actionKind = 'dunk';
      dunking = true; dunkElapsed = 0; dunkWasPerfect = dunkPower > 0.58 && dunkPower < 0.86; dunkResolved = false;
      dunkHasBall = ball.owner === 0;
      dunkStartPosition.copy(me.position);
      dunkFinishPosition.set(target.x - rimDirection * 0.62, 0, target.z);
      if (dunkHasBall) {
        ball.mode = 'held'; ball.lastOwner = 0; ball.scored = false; ball.velocity.set(0, 0, 0);
      }
      showMessage(dunkHasBall ? (dunkWasPerfect ? '完美起跳！' : '起跳扣篮！') : '补扣起跳！', 700);
      dunkPower = 0; setDunkCharge(0);
    };

    const sendPass = (owner: number, target: number, label = '传球') => {
      if (ball.owner !== owner || owner === target || athletes[owner].team !== athletes[target].team) return false;
      const passer = athletes[owner];
      passer.action = 0.46; passer.actionKind = 'pass';
      ball.owner = null; ball.mode = 'pass'; ball.passTarget = target; ball.lastOwner = owner; ball.scored = false;
      ball.position.copy(getGatherPosition(passer));
      const catchPoint = athletes[target].position.clone().addScaledVector(athletes[target].velocity, 0.16).add(new THREE.Vector3(0, 1.3, 0));
      const distance = catchPoint.distanceTo(ball.position);
      ball.velocity.copy(catchPoint.sub(ball.position).normalize().multiplyScalar(clamp(11.8 + distance * 0.18, 11.8, 15.2)));
      aiPassCooldown[owner] = 1.15;
      aiDecisionCooldown[target] = 0.38;
      showMessage(label, 650);
      return true;
    };

    const passBall = () => {
      if (ball.owner !== 0 || dunking || shotPending) return false;
      const me = athletes[0];
      const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const mates = [1, 2].sort((a, b) => {
        const da = athletes[a].position.clone().sub(me.position).normalize().dot(forward);
        const db = athletes[b].position.clone().sub(me.position).normalize().dot(forward);
        return db - da;
      });
      const target = mates[0];
      return sendPass(0, target, '传球');
    };

    const passOrCallForBall = () => {
      if (ball.owner === 0) { passBall(); return; }
      if (ball.owner !== null && athletes[ball.owner].team === 0) {
        const owner = ball.owner;
        const nearestDefender = athletes.reduce((nearest, defender) => {
          if (defender.team === 0) return nearest;
          return Math.min(nearest, defender.position.distanceTo(athletes[0].position));
        }, Infinity);
        const distance = athletes[owner].position.distanceTo(athletes[0].position);
        if (distance > 14.5) { showMessage('距离太远，先靠近队友', 750); return; }
        sendPass(owner, 0, nearestDefender > 1.15 ? '队友回应要球！' : '有防守，注意接球！');
        return;
      }
      showMessage(ball.owner === null ? '先争抢球权' : '防守回合无法要球', 650);
    };

    const steal = () => {
      const me = athletes[0]; me.action = 0.62; me.actionKind = 'steal';
      showMessage('抢断', 450);
      if (ball.owner === null || athletes[ball.owner].team === 0) return;
      const owner = athletes[ball.owner];
      if (owner.position.distanceTo(me.position) < 1.65) {
        if (Math.random() < 0.72) { ball.owner = 0; ball.mode = 'held'; ball.lastOwner = 0; showMessage('抢断！', 900); }
        else showMessage('抢断失败');
      }
    };

    const jump = () => {
      const me = athletes[0];
      if (me.jump < 0.04) { me.jumpV = 7.2; me.action = 0.72; me.actionKind = 'jump'; }
    };

    const resolveMoveDirection = () => {
      const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const direction = new THREE.Vector3();
      if (keys.w) direction.add(forward);
      if (keys.s) direction.sub(forward);
      if (keys.d) direction.add(right);
      if (keys.a) direction.sub(right);
      return direction.lengthSq() > 0 ? direction.normalize() : forward;
    };

    const resolveDribbleMove = (burst = false): DribbleMove => {
      if (burst) {
        if (keys.s && keys.a && !keys.d) return 'spin-left';
        if (keys.s && keys.d && !keys.a) return 'spin-right';
        if (keys.s) return dribbleHand === 'right' ? 'spin-left' : 'spin-right';
        if (keys.a && !keys.d) return 'burst-left';
        if (keys.d && !keys.a) return 'burst-right';
        return 'burst';
      }
      if (keys.s) return 'between';
      if (keys.a && !keys.d) return 'cross-left';
      if (keys.d && !keys.a) return 'cross-right';
      if (keys.w) return 'attack';
      return 'between';
    };

    const resolveCarryMove = (): DribbleMove => {
      if (keys.s && !keys.w) return 'backward';
      return 'forward';
    };

    const startDash = () => {
      if (dashCooldown > 0 || sprint < 0.2 || charging || shotPending || dunkCharging || dunking) return;
      const me = athletes[0];
      dashWithBall = ball.owner === 0;
      dashDuration = dashWithBall && dribbling ? 0.42 : 0.32;
      dashTime = dashDuration;
      dashCooldown = 0.48;
      dashDirection.copy(resolveMoveDirection());
      sprint = Math.max(0, sprint - (dashWithBall && dribbling ? 0.34 : 0.26));
      if (dashWithBall) {
        dribbleMove = dribbling ? resolveDribbleMove(true) : resolveCarryMove();
        dribbleGrace = Math.max(dribbleGrace, dashDuration + 0.08);
      }
      spinDirection = dashWithBall && dribbleMove === 'spin-left' ? -1 : dashWithBall && dribbleMove === 'spin-right' ? 1 : 0;
      me.action = dashDuration + 0.12;
      me.actionKind = dashWithBall ? 'dribble' : 'dash';
      showMessage(dashWithBall && dribbling ? '爆发运球！' : '冲刺！', 430);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.code === 'Space' ? 'space' : event.key.toLowerCase(); keys[key] = true;
      if (['w', 'a', 's', 'd', 'space', 'shift', 'tab', 'f', 'p', '1', '2', '3'].includes(key)) event.preventDefault();
      if (event.repeat || phaseRef.current !== 'playing') return;
      if (key === 'a' || key === 'd' || key === 's') { recentDirection = key; recentDirectionAt = performance.now(); }
      if (key === 'space') {
        const comboDirection = keys.s ? 's' : keys.a ? 'a' : keys.d ? 'd' : performance.now() - recentDirectionAt < 380 ? recentDirection : '';
        queuedShotStyle = comboDirection === 's' ? 'fade' : comboDirection === 'a' ? 'step-left' : comboDirection === 'd' ? 'step-right' : 'normal';
        queuedShotUntil = queuedShotStyle === 'normal' ? 0 : performance.now() + 520;
      }
      if (key === 'f') passOrCallForBall();
      if (key === 'shift') steal();
      if (key === 'space') {
        // A short input buffer lets A/D/S + Space + LMB resolve as a shot
        // without briefly starting a dash. RMB dribble bursts stay immediate.
        if (ball.owner === 0 && queuedShotStyle !== 'normal' && !dribbling) delayedDashAt = performance.now() + 180;
        else startDash();
      }
      if (key === 'tab') beginDunk();
      if (key === '1') showMessage('PASS!',900);
      if (key === '2') showMessage('NICE!',900);
      if (key === '3') showMessage('SORRY!',900);
      if (key === 'p') { changePhase('paused'); document.exitPointerLock?.(); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.code === 'Space' ? 'space' : event.key.toLowerCase(); keys[key] = false;
      if (key === 'tab') { event.preventDefault(); releaseDunk(); }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (document.pointerLockElement !== canvas) dragLooking = true;
      if (event.button === 0) {
        if (ball.owner === 0) beginShot();
        else jump();
      }
      if (event.button === 2 && ball.owner === 0) {
        dribbling = true;
        dribbleMove = resolveDribbleMove(dashTime > 0);
        dribbleGrace = dashTime > 0 ? dashTime + 0.08 : 0.18;
        const label: Record<DribbleMove, string> = {
          forward: '推进运球', backward: '后撤运球', left: '左侧运球', right: '右侧运球', attack: '压低突破', between: '胯下低运球',
          'cross-left': '左交叉突破', 'cross-right': '右交叉突破', burst: '爆发运球', 'burst-left': '左变向冲刺', 'burst-right': '右变向冲刺',
          'spin-left': '左转身过人', 'spin-right': '右转身过人',
        };
        showMessage(label[dribbleMove], 520);
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0 && charging) queueUserShot();
      if (event.button === 2) { dribbling = false; dribbleGrace = Math.max(dribbleGrace, 0.12); }
      if (event.buttons === 0) dragLooking = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (phaseRef.current !== 'playing') return;
      const pointerLocked = document.pointerLockElement === canvas;
      if (!pointerLocked && !dragLooking) return;
      cameraYaw += event.movementX * 0.0019;
      cameraPitch = clamp(cameraPitch - event.movementY * 0.00155, -1.05, 0.65);
      athletes[0].facing = Math.PI - cameraYaw;
    };
    const onPointerLock = () => {
      const isLocked = document.pointerLockElement === canvas;
      setLocked(isLocked);
      if (!isLocked && phaseRef.current === 'playing') changePhase('paused');
    };
    const onContext = (event: MouseEvent) => event.preventDefault();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onPointerLock);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContext);

    const moveToward = (player: Athlete, target: THREE.Vector3, speed: number, dt: number) => {
      const delta = target.clone().sub(player.position); delta.y = 0;
      const distance = delta.length();
      if (distance > 0.04) {
        delta.normalize(); player.position.addScaledVector(delta, Math.min(distance, speed * dt)); player.velocity.copy(delta).multiplyScalar(speed);
        player.facing = Math.atan2(delta.x, delta.z);
      } else player.velocity.multiplyScalar(0.75);
    };

    const scoreBasket = (team: Team, points: number, now: number) => {
      if (ball.scored) return;
      ball.scored = true; ball.mode = 'dead'; ball.velocity.set(0, 0, 0);
      gameScore[team] += points; setScore([...gameScore] as [number, number]);
      nextPossession = team === 0 ? 1 : 0; resetAt = now + 1.35;
      showMessage(points === 3 ? '三分命中！' : '进球！', 1050);
    };

    const nearestDefenderDistance = (playerIndex: number) => athletes.reduce((nearest, defender, defenderIndex) => {
      if (defenderIndex === playerIndex || defender.team === athletes[playerIndex].team) return nearest;
      return Math.min(nearest, defender.position.distanceTo(athletes[playerIndex].position));
    }, Infinity);

    const bestAiPassTarget = (owner: number) => {
      const passer = athletes[owner];
      const attack = passer.team === 0 ? 1 : -1;
      return athletes.reduce<{ index: number; score: number }>((best, mate, index) => {
        if (index === owner || mate.team !== passer.team) return best;
        const openness = nearestDefenderDistance(index);
        const advance = (mate.position.x - passer.position.x) * attack;
        const passDistance = mate.position.distanceTo(passer.position);
        const score = openness * 1.35 + advance * 0.16 - Math.max(0, passDistance - 9) * 0.12 + (index === 0 ? 0.18 : 0);
        return score > best.score ? { index, score } : best;
      }, { index: -1, score: -Infinity });
    };

    const startAiDunk = (owner: number, putback = false) => {
      const player = athletes[owner];
      if (owner === 0 || (putback ? ball.owner !== null : ball.owner !== owner)) return false;
      const rim = hoop(player.team);
      const rimGround = rim.clone().setY(0);
      if (player.position.distanceTo(rimGround) > (putback ? 2.8 : 2.45)) return false;
      const contest = nearestDefenderDistance(owner);
      const contestPressure = contest < 1.65 ? clamp(1 - contest / 1.65, 0, 1) : 0;
      player.jumpV = Math.max(player.jumpV, putback ? 7.9 : 7.45);
      player.action = putback ? 1.28 : 1.18;
      player.actionKind = 'dunk';
      player.facing = rim.x > player.position.x ? Math.PI / 2 : -Math.PI / 2;
      ball.owner = null; ball.mode = 'shot'; ball.lastOwner = owner; ball.shotAge = 0; ball.shotFlight = putback ? 0.4 : 0.5; ball.shotPoints = 2; ball.scored = false;
      ball.shotMake = Math.random() < clamp((putback ? 0.63 : 0.76) - contestPressure * (putback ? 0.34 : 0.42), 0.2, 0.82);
      const from = getHandPosition(player, 'right');
      ball.position.copy(from);
      const t = ball.shotFlight;
      const aim = rim.clone();
      if (!ball.shotMake) aim.z += (Math.random() > 0.5 ? 1 : -1) * 0.82;
      ball.velocity.set((aim.x - from.x) / t, (aim.y - from.y + 4.9 * t * t) / t, (aim.z - from.z) / t);
      aiDecisionCooldown[owner] = 1.25;
      showMessage(putback ? '机器人补扣！' : '机器人起飞扣篮！', 850);
      return true;
    };

    const keepBallOnCourt = () => {
      if (ball.owner !== null || ball.scored) return;
      const maxX = COURT_HALF_X - BALL_RADIUS;
      const maxZ = COURT_HALF_Z - BALL_RADIUS;
      let hitBoundary = false;
      if (ball.position.x < -maxX || ball.position.x > maxX) {
        ball.position.x = clamp(ball.position.x, -maxX, maxX);
        ball.velocity.x *= -0.68;
        hitBoundary = true;
      }
      if (ball.position.z < -maxZ || ball.position.z > maxZ) {
        ball.position.z = clamp(ball.position.z, -maxZ, maxZ);
        ball.velocity.z *= -0.68;
        hitBoundary = true;
      }
      if (hitBoundary && (ball.mode === 'shot' || ball.mode === 'pass')) {
        ball.mode = 'loose'; ball.passTarget = null; ball.shotMake = false; ball.shotAge = 0;
      }
    };

    const updateBall = (dt: number, now: number) => {
      const possessionDribble = ball.owner === 0 && !charging && !shotPending && !dunkCharging && !dunking;
      if (dunking && !dunkHasBall && !dunkResolved && ball.owner === null && !ball.scored) {
        const me = athletes[0];
        const handPosition = getHandPosition(me, 'right');
        const nearPalm = ball.position.distanceTo(handPosition) < 0.62;
        const nearRim = ball.position.distanceTo(hoop(me.team)) < 0.78 && ball.position.y > 2.45;
        if (nearPalm || nearRim) {
          ball.owner = 0; ball.lastOwner = 0; ball.mode = 'held'; dunkHasBall = true;
          showMessage('空中接球！', 650);
        }
      }
      if (ball.owner !== null) {
        const player = athletes[ball.owner];
        const handPosition = getHandPosition(player, ball.owner === 0 ? dribbleHand : 'right');
        if (dunking && dunkHasBall && ball.owner === 0) {
          const palm = getHandPosition(player, 'right');
          palm.y += 0.04; palm.x += Math.sign(hoop(player.team).x - player.position.x) * 0.06;
          ball.position.lerp(palm, 0.9);
          ball.group.rotation.x += dt * 5;
          if (dunkElapsed >= 0.72 && !ball.scored && !dunkResolved) {
            const rim = hoop(player.team);
            const nearestDefender = athletes.reduce<{ player: Athlete | null; distance: number }>((nearest, defender) => {
              if (defender.team === player.team) return nearest;
              const distance = new THREE.Vector2(defender.position.x - player.position.x, defender.position.z - player.position.z).length();
              return distance < nearest.distance ? { player: defender, distance } : nearest;
            }, { player: null, distance: Infinity });
            const contestStrength = nearestDefender.distance < DUNK_CONTEST_RADIUS
              ? clamp(1 - nearestDefender.distance / DUNK_CONTEST_RADIUS + (nearestDefender.player?.jump ?? 0) * 0.2, 0.2, 1)
              : 0;
            const blockChance = contestStrength > 0 ? 0.08 + contestStrength * 0.34 : 0;
            const missChance = contestStrength > 0 ? (dunkWasPerfect ? 0.03 : 0.12) + contestStrength * 0.2 : 0;
            const outcome = Math.random();
            dunkResolved = true;
            ball.owner = null; ball.lastOwner = 0; dunkHasBall = false;
            player.action = 0;
            if (outcome < blockChance) {
              ball.mode = 'loose'; ball.shotAge = 0;
              ball.position.copy(rim).add(new THREE.Vector3(0, 0.12, 0));
              ball.velocity.set(-Math.sign(rim.x - player.position.x) * 3.6, 3.4, (Math.random() - 0.5) * 4.2);
              showMessage('扣篮被帽！', 1100);
            } else if (outcome < blockChance + missChance) {
              ball.mode = 'loose'; ball.shotAge = 0;
              ball.position.copy(rim).add(new THREE.Vector3(0, 0.16, 0));
              ball.velocity.set(-Math.sign(rim.x - player.position.x) * 1.4, 2.25, (Math.random() - 0.5) * 5.2);
              showMessage('干扰下扣飞！', 1100);
            } else {
              ball.position.copy(rim).add(new THREE.Vector3(0, -0.18, 0));
              scoreBasket(player.team, 2, now);
              showMessage(contestStrength > 0 ? '强硬暴扣！' : dunkWasPerfect ? '完美暴扣！' : '暴扣！', 1100);
            }
          }
        } else if ((charging || shotPending || dunkCharging) && ball.owner === 0) {
          const gather = getGatherPosition(player);
          ball.position.lerp(gather, 0.78);
        } else if ((possessionDribble || dribbling || dribbleGrace > 0) && ball.owner === 0) {
          const transferTarget = (move: DribbleMove, from: DribbleHand): DribbleHand => {
            if (move === 'cross-left' || move === 'burst-left') return 'left';
            if (move === 'cross-right' || move === 'burst-right') return 'right';
            if (move === 'between' || move === 'spin-left' || move === 'spin-right') return oppositeHand(from);
            if (move === 'left') return 'left';
            if (move === 'right') return 'right';
            return from;
          };
          if (dribbleSequenceMove !== dribbleMove) {
            dribbleSequenceMove = dribbleMove;
            dribblePhase = 0;
            dribbleFromHand = dribbleHand;
            dribbleToHand = transferTarget(dribbleMove, dribbleFromHand);
            if (dribbling && (dribbleMove === 'between' || dribbleMove === 'cross-left' || dribbleMove === 'cross-right' || dribbleMove.startsWith('burst') || dribbleMove === 'spin-left' || dribbleMove === 'spin-right')) ankleBreakWindow = 0.38;
          }
          const cycleRate = dribbleMove === 'between' ? 0.86
            : dribbleMove === 'cross-left' || dribbleMove === 'cross-right' ? 0.74
            : dribbleMove === 'spin-left' || dribbleMove === 'spin-right' ? 1.14
            : dribbleMove === 'backward' ? 1.55
            : dribbleMove === 'attack' || dribbleMove.startsWith('burst') ? 1.32
            : 1.9;
          dribblePhase += dt * cycleRate;
          while (dribblePhase >= 1) {
            dribblePhase -= 1;
            dribbleHand = dribbleToHand;
            dribbleFromHand = dribbleHand;
            dribbleToHand = transferTarget(dribbleMove, dribbleFromHand);
          }

          const startPalm = getHandPosition(player, dribbleFromHand);
          const endPalm = getHandPosition(player, dribbleToHand);
          const startSide = dribbleFromHand === 'left' ? -1 : 1;
          const endSide = dribbleToHand === 'left' ? -1 : 1;
          const isBurst = dribbleMove === 'attack' || dribbleMove === 'burst' || dribbleMove === 'burst-left' || dribbleMove === 'burst-right';
          const isSpin = dribbleMove === 'spin-left' || dribbleMove === 'spin-right';
          const groundLocal = new THREE.Vector3((startSide + endSide) * 0.22, 0, 0.2);
          if (dribbleMove === 'backward') groundLocal.z = -0.28;
          if (dribbleMove === 'between') groundLocal.set(0, 0, -0.26);
          if (dribbleMove === 'cross-left' || dribbleMove === 'cross-right') groundLocal.set(0, 0, 0.3);
          if (isBurst) groundLocal.set(endSide * 0.34, 0, 0.46);
          if (isSpin) groundLocal.set(0, 0, -0.44);
          const groundAnchor = player.group.getWorldPosition(new THREE.Vector3());
          const groundOffset = groundLocal.applyQuaternion(player.group.quaternion);
          const ground = groundAnchor.add(groundOffset);
          ground.y = BALL_RADIUS;

          const descending = dribblePhase < 0.5;
          const halfPhase = descending ? dribblePhase * 2 : (dribblePhase - 0.5) * 2;
          const eased = halfPhase * halfPhase * (3 - 2 * halfPhase);
          const target = descending
            ? startPalm.clone().lerp(ground, eased)
            : ground.clone().lerp(endPalm, eased);
          // The curve itself is continuous, so following it directly avoids the
          // visible one-frame lag that makes the ball appear detached from a hand.
          ball.position.copy(target);
          ball.group.rotation.x += dt * 18;
          ball.group.rotation.z += dt * (dribbleMove === 'forward' ? 4 : 11);
        } else if (ball.owner !== 0 && player.velocity.lengthSq() > 0.35 && player.jump < 0.12) {
          const palm = getHandPosition(player, 'right');
          const ground = player.group.localToWorld(new THREE.Vector3(0.34, 0, 0.24));
          ground.y = BALL_RADIUS;
          const bounce = Math.pow(Math.abs(Math.cos(now * 6.2 + ball.owner * 1.7)), 0.7);
          ball.position.copy(ground).lerp(palm, bounce);
          ball.group.rotation.x += dt * 17;
        } else {
          const held = handPosition.clone(); held.y = Math.max(0.82 + player.jump, held.y - 0.06);
          ball.position.lerp(held, 0.72);
          ball.group.rotation.x += dt * 3;
        }
      } else if (ball.mode === 'pass') {
        ball.position.addScaledVector(ball.velocity, dt);
        ball.group.rotation.x += dt * 14;
        keepBallOnCourt();
        if (ball.passTarget !== null) {
          const target = athletes[ball.passTarget];
          if (ball.position.distanceTo(target.position.clone().add(new THREE.Vector3(0, 1.1, 0))) < 1.05) {
            ball.owner = ball.passTarget; ball.lastOwner = ball.passTarget; ball.mode = 'held'; ball.passTarget = null;
          } else {
            const passingTeam = athletes[ball.lastOwner].team;
            athletes.forEach((player, index) => {
              if (ball.mode === 'pass' && player.team !== passingTeam && player.position.distanceTo(ball.position) < 0.8 && Math.random() < dt * 3) {
                ball.owner = index; ball.lastOwner = index; ball.mode = 'held'; ball.passTarget = null; showMessage('传球被断');
              }
            });
          }
        }
      } else if (ball.mode === 'shot' || ball.mode === 'loose') {
        ball.shotAge += dt;
        ball.velocity.y -= 9.8 * dt;
        ball.position.addScaledVector(ball.velocity, dt);
        ball.group.rotation.x += dt * 15;
        ball.group.rotation.z += dt * 8;
        keepBallOnCourt();

        const user = athletes[0];
        if (ball.mode === 'shot' && athletes[ball.lastOwner].team === 1 && user.jump > 0.38 && user.position.distanceTo(new THREE.Vector3(ball.position.x, 0, ball.position.z)) < BLOCK_HORIZONTAL_RADIUS && ball.position.y < user.jump + 2.38) {
          const shooter = athletes[ball.lastOwner];
          ball.mode = 'loose';
          ball.velocity.set(-ball.velocity.x * 0.72, 5.1, -ball.velocity.z * 0.4 + (Math.random() - 0.5) * 4.2);
          shooter.action = Math.max(shooter.action, 0.58); shooter.actionKind = 'stumble';
          showMessage('钉板大帽！', 1200);
          showBlockFeedback();
        }

        if (ball.mode === 'shot' && !ball.scored && ball.shotAge >= ball.shotFlight) {
          const team = athletes[ball.lastOwner].team;
          if (ball.shotMake) scoreBasket(team, ball.shotPoints, now);
          else { ball.mode = 'loose'; showMessage('篮板球'); }
        }

        if (!ball.scored && ball.position.y <= BALL_RADIUS) {
          ball.position.y = BALL_RADIUS; ball.velocity.y = Math.abs(ball.velocity.y) * 0.48;
          ball.velocity.x *= 0.8; ball.velocity.z *= 0.8; ball.mode = 'loose';
        }
        if (ball.mode === 'loose') {
          let nearest = -1; let nearestDistance = 99;
          athletes.forEach((player, index) => {
            const reach = 1.0 + player.jump * 0.5;
            const horizontal = player.position.distanceTo(new THREE.Vector3(ball.position.x, 0, ball.position.z));
            if (horizontal < reach && ball.position.y < 1.35 + player.jump && horizontal < nearestDistance) { nearest = index; nearestDistance = horizontal; }
          });
          if (nearest >= 0) {
            const rebounder = athletes[nearest];
            const nearOwnRim = rebounder.position.distanceTo(hoop(rebounder.team).setY(0)) < 2.8;
            const canPutback = nearest !== 0 && nearOwnRim && ball.position.y > 1.45 && rebounder.jump > 0.12 && Math.random() < 0.58;
            if (!canPutback || !startAiDunk(nearest, true)) {
              ball.owner = nearest; ball.lastOwner = nearest; ball.mode = 'held'; showMessage(nearest === 0 ? '抢到篮板！' : '篮板');
            }
          }
        }
      }
      if (dunking && !dunkHasBall && dunkElapsed >= 1.12) {
        dunking = false;
        if (athletes[0].actionKind === 'dunk') athletes[0].action = 0;
      }
      ball.group.position.copy(ball.position);
    };

    const updatePlayers = (dt: number, now: number) => {
      const me = athletes[0];
      const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const input = new THREE.Vector3();
      if (keys.w) input.add(forward); if (keys.s) input.sub(forward); if (keys.d) input.add(right); if (keys.a) input.sub(right);
      if (ball.owner === 0 && dashTime <= 0) {
        if (dribbling) dribbleMove = resolveDribbleMove(false);
        else if (dribbleGrace <= 0) dribbleMove = resolveCarryMove();
      }
      const specialShotActive = shotStyle !== 'normal' && (charging || shotPending || (me.actionKind === 'shoot' && me.action > 0));
      if (specialShotActive && !dunking) {
        let target: THREE.Vector3;
        if (charging) {
          shotGatherElapsed += dt;
          const progress = clamp(shotGatherElapsed / 0.24, 0, 1);
          const eased = progress * progress * (3 - 2 * progress);
          target = shotStepStart.clone().lerp(shotStepEnd, eased);
        } else {
          shotAirElapsed += dt;
          const progress = clamp(shotAirElapsed / (shotStyle === 'fade' ? 0.62 : 0.54), 0, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          target = shotAirStart.clone().lerp(shotAirEnd, eased);
        }
        me.velocity.copy(target).sub(me.position).multiplyScalar(dt > 0 ? 1 / dt : 0);
        me.position.copy(target); me.facing = Math.PI - cameraYaw;
      } else if (!dunking && dashTime > 0) {
        const dashProgress = clamp(dashTime / dashDuration, 0, 1);
        const dashSpeed = (dashWithBall && dribbling ? 11.8 : 10.6) * (0.76 + dashProgress * 0.24);
        me.position.addScaledVector(dashDirection, dashSpeed * dt);
        me.velocity.copy(dashDirection).multiplyScalar(dashSpeed);
        me.facing = Math.PI - cameraYaw;
      } else if (!dunking && input.lengthSq() > 0) {
        input.normalize();
        const directionalFactor = keys.s && !keys.w ? 0.82 : (keys.a || keys.d) && !keys.w ? 0.9 : 1;
        const speed = PLAYER_RUN_SPEED * directionalFactor;
        me.position.addScaledVector(input, speed * dt); me.velocity.copy(input).multiplyScalar(speed); me.facing = Math.PI - cameraYaw;
        sprint = Math.min(1, sprint + dt * 0.14);
      } else if (!dunking) {
        sprint = Math.min(1, sprint + dt * 0.18); me.velocity.multiplyScalar(0.72); me.facing = Math.PI - cameraYaw;
      } else {
        const progress = clamp(dunkElapsed / 0.98, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        me.position.lerpVectors(dunkStartPosition, dunkFinishPosition, eased);
        me.velocity.copy(dunkFinishPosition).sub(dunkStartPosition).normalize().multiplyScalar(7.8);
        me.facing = dunkFinishPosition.x > dunkStartPosition.x ? Math.PI / 2 : -Math.PI / 2;
      }
      me.position.x = clamp(me.position.x, -COURT_HALF_X + COURT_INSET, COURT_HALF_X - COURT_INSET);
      me.position.z = clamp(me.position.z, -COURT_HALF_Z + COURT_INSET, COURT_HALF_Z - COURT_INSET);

      const possession = ball.owner === null ? (ball.mode === 'pass' ? athletes[ball.lastOwner].team : null) : athletes[ball.owner].team;
      const offensiveFocus = ball.owner ?? ball.passTarget ?? ball.lastOwner;
      const primaryDefender: [number, number] = [-1, -1];
      ([0, 1] as Team[]).forEach((defendingTeam) => {
        if (athletes[offensiveFocus].team === defendingTeam) return;
        const candidates = athletes
          .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
          .filter(({ candidate, candidateIndex }) => candidate.team === defendingTeam && candidateIndex !== 0);
        primaryDefender[defendingTeam] = candidates.reduce((nearest, candidate) => {
          if (nearest < 0) return candidate.candidateIndex;
          const nearestDistance = athletes[nearest].position.distanceTo(athletes[offensiveFocus].position);
          const candidateDistance = candidate.candidate.position.distanceTo(athletes[offensiveFocus].position);
          return candidateDistance < nearestDistance ? candidate.candidateIndex : nearest;
        }, -1);
      });
      athletes.forEach((player, index) => {
        player.stealCooldown = Math.max(0, player.stealCooldown - dt);
        aiDecisionCooldown[index] = Math.max(0, aiDecisionCooldown[index] - dt);
        aiPassCooldown[index] = Math.max(0, aiPassCooldown[index] - dt);
        if (index === 0) return;
        if (player.action > 0 && player.actionKind === 'stumble') {
          const away = player.position.clone().sub(me.position); away.y = 0;
          if (away.lengthSq() < 0.01) away.set(0, 0, player.stumbleSide);
          away.normalize(); player.position.addScaledVector(away, dt * 2.8); player.velocity.copy(away).multiplyScalar(2.8);
          return;
        }
        if (player.action > 0 && player.actionKind === 'steal') { player.velocity.multiplyScalar(0.64); return; }
        const attack = player.team === 0 ? 1 : -1;
        if (ball.owner === index) {
          const rim = hoop(player.team).setY(0);
          const distanceToRim = player.position.distanceTo(rim);
          const defenderDistance = nearestDefenderDistance(index);
          if (aiDecisionCooldown[index] <= 0) {
            aiDecisionCooldown[index] = 0.34 + Math.random() * 0.28;
            const bestPass = bestAiPassTarget(index);
            const bestPassOpen = bestPass.index >= 0 ? nearestDefenderDistance(bestPass.index) : 0;
            const underPressure = defenderDistance < 1.35;
            const shouldMoveBall = aiPassCooldown[index] <= 0 && bestPass.index >= 0
              && bestPassOpen > defenderDistance + 0.38
              && (underPressure || distanceToRim > 7.2 && Math.random() < 0.42);
            if (shouldMoveBall && sendPass(index, bestPass.index, player.team === 0 ? '队友转移球！' : '机器人配合传球')) return;

            if (distanceToRim < 2.45 && aiShotCooldown <= 0 && Math.random() < 0.78) {
              if (startAiDunk(index)) { aiShotCooldown = 1.25; return; }
            }

            const openShot = defenderDistance > 1.25;
            const threePointTry = distanceToRim >= 7 && distanceToRim < 10.2 && (openShot ? Math.random() < 0.76 : Math.random() < 0.2);
            const midRangeTry = distanceToRim >= 3.6 && distanceToRim < 7 && (openShot ? Math.random() < 0.62 : Math.random() < 0.18);
            const layupTry = distanceToRim >= 2.35 && distanceToRim < 3.9 && Math.random() < (openShot ? 0.72 : 0.36);
            if (aiShotCooldown <= 0 && (threePointTry || midRangeTry || layupTry)) {
              const idealPower = clamp(0.54 + distanceToRim * 0.012 + (Math.random() - 0.5) * 0.055, 0.58, 0.82);
              showMessage(threePointTry ? '机器人三分出手！' : midRangeTry ? '机器人急停跳投！' : '机器人突破上篮！', 760);
              releaseShot(index, idealPower);
              aiShotCooldown = threePointTry ? 1.65 : 1.35;
              return;
            }
          }
          const laneZ = (index % 2 ? -1 : 1) * (defenderDistance < 1.2 ? 2.8 : 1.25);
          const driveX = attack * (distanceToRim > 8 ? 13.2 : 16.35);
          moveToward(player, new THREE.Vector3(driveX, 0, laneZ), PLAYER_RUN_SPEED * (defenderDistance < 1.1 ? 0.94 : 1.04), dt);
        } else if (possession === player.team) {
          if (ball.mode === 'pass' && ball.passTarget === index) {
            moveToward(player, new THREE.Vector3(ball.position.x, 0, ball.position.z), PLAYER_RUN_SPEED * 1.08, dt);
          } else {
            const role = index % 3;
            const ownerIndex = ball.owner ?? ball.lastOwner;
            const owner = athletes[ownerIndex];
            const ownerDistanceToRim = owner.position.distanceTo(hoop(owner.team).setY(0));
            const cutting = role === 2 && ownerDistanceToRim > 6.2;
            const target = cutting
              ? new THREE.Vector3(attack * 15.9, 0, (index % 2 ? -1 : 1) * 1.35)
              : new THREE.Vector3(attack * (role === 0 ? 10.2 : 12.1), 0, role === 0 ? -5.8 : 5.6);
            moveToward(player, target, PLAYER_RUN_SPEED * (cutting ? 1.08 : 0.96), dt);
          }
        } else if (possession !== null) {
          const isPrimaryDefender = primaryDefender[player.team] === index;
          const markIndex = isPrimaryDefender ? offensiveFocus : player.team === 0 ? index + 3 : index - 3;
          const mark = athletes[markIndex];
          const target = mark.position.clone(); target.x -= attack * (isPrimaryDefender ? 0.78 : 1.12);
          if (!isPrimaryDefender && ball.owner !== null) {
            const carrier = athletes[ball.owner];
            const carrierNearRim = carrier.position.distanceTo(hoop(carrier.team).setY(0)) < 4.5;
            if (carrierNearRim && player.position.distanceTo(carrier.position) < 4.2) target.lerp(carrier.position, 0.34);
          }
          moveToward(player, target, PLAYER_RUN_SPEED * (isPrimaryDefender ? 1.08 : 0.98), dt);
          const reachDistance = player.position.distanceTo(mark.position);
          const shootingThreat = ball.owner === markIndex
            && (mark.actionKind === 'shoot' && mark.action > 0.15 || markIndex === 0 && (charging || shotPending));
          if (isPrimaryDefender && shootingThreat && reachDistance < SHOT_CONTEST_RADIUS + 0.28 && player.jump < 0.03) {
            player.jumpV = 6.7;
            player.action = 0.76;
            player.actionKind = 'jump';
            player.velocity.multiplyScalar(0.45);
          }
          if (!dunking && ball.owner === markIndex && reachDistance < 1.5 && player.stealCooldown <= 0) {
            player.stealCooldown = 1.05 + (index % 3) * 0.12;
            const ankleBreakChance = dribbleMove === 'spin-left' || dribbleMove === 'spin-right' ? 0.82
              : dribbleMove === 'between' ? 0.7
              : dribbleMove === 'cross-left' || dribbleMove === 'cross-right' ? 0.62
              : 0.48;
            if (markIndex === 0 && ankleBreakWindow > 0 && Math.random() < ankleBreakChance) {
              player.action = 0.92; player.actionKind = 'stumble'; player.stumbleSide = dribbleToHand === 'left' ? -1 : 1;
              showMessage('晃倒防守！', 900);
            } else {
              player.action = 0.48; player.actionKind = 'steal';
              const exposed = markIndex !== 0 || !dribbling || (dribblePhase > 0.4 && dribblePhase < 0.58);
              if (exposed && Math.random() < 0.34) {
                ball.owner = index; ball.lastOwner = index; ball.mode = 'held'; showMessage('被抢断！', 850);
              }
            }
          }
        } else moveToward(player, new THREE.Vector3(ball.position.x, 0, ball.position.z), PLAYER_RUN_SPEED, dt);

        if (dunking && player.team !== me.team && player.position.distanceTo(me.position) < 1.25 && player.jump < 0.02) {
          player.jumpV = 6.35; player.action = 0.76; player.actionKind = 'jump';
        }
        if (ball.mode === 'loose' && ball.position.y > 1.25 && ball.position.y < 3.2 && player.position.distanceTo(new THREE.Vector3(ball.position.x, 0, ball.position.z)) < 1.45 && player.jump < 0.02) player.jumpV = 6.2;
      });

      athletes.slice(1).forEach((player) => {
        player.position.x = clamp(player.position.x, -COURT_HALF_X + COURT_INSET, COURT_HALF_X - COURT_INSET);
        player.position.z = clamp(player.position.z, -COURT_HALF_Z + COURT_INSET, COURT_HALF_Z - COURT_INSET);
      });

      athletes.forEach((player, index) => {
        player.jumpV -= 15.5 * dt; player.jump += player.jumpV * dt;
        if (player.jump < 0) { player.jump = 0; player.jumpV = 0; }
        player.action = Math.max(0, player.action - dt);
        const moving = player.velocity.lengthSq() > 0.01 || (index === 0 && input.lengthSq() > 0);
        const phase = now * ((dribbling || dribbleGrace > 0) && index === 0 ? 10.5 : 8.5) + index * 0.7;
        const swing = moving ? Math.sin(phase) : 0;
        const blend = 1 - Math.exp(-dt * 16);
        const possessionDribble = ball.owner === index && !(index === 0 && (charging || shotPending || dunkCharging || dunking));
        const active: MotionName = index === 0 && (charging || dunkCharging) ? 'shoot' : player.action > 0 ? player.actionKind : (possessionDribble ? 'dribble' : player.jump > 0.12 ? 'jump' : 'idle');
        const spinProgress = index === 0 && spinDirection !== 0 && dashDuration > 0 ? 1 - clamp(dashTime / dashDuration, 0, 1) : 0;
        const spinEase = spinProgress * spinProgress * (3 - 2 * spinProgress);
        const visualSpin = spinDirection * Math.PI * 2 * spinEase;

        if (player.mixer && player.actions) {
          let clipName = moving ? 'Run_Loop' : 'Idle_Loop';
          if (active === 'dribble') {
            clipName = moving && (index !== 0 || dribbleMove === 'forward') ? 'Basketball_Drive_Straight'
              : dribbleMove === 'backward' ? 'Basketball_Dribble_Backward'
              : dribbleMove === 'left' ? 'Basketball_Dribble_Left'
              : dribbleMove === 'right' ? 'Basketball_Dribble_Right'
              : dribbleMove === 'between' ? 'Basketball_BetweenLegs'
              : dribbleMove === 'cross-left' || dribbleMove === 'cross-right' ? 'Basketball_Crossover'
              : dribbleMove === 'attack' ? 'Basketball_Drive_Straight'
              : dribbleMove === 'burst-left' ? 'Basketball_Drive_Left'
              : dribbleMove === 'burst-right' ? 'Basketball_Drive_Right'
              : dribbleMove === 'spin-left' ? 'Basketball_Drive_Left'
              : dribbleMove === 'spin-right' ? 'Basketball_Drive_Right'
              : dribbleMove === 'burst' ? 'Basketball_Drive_Straight'
              : 'Basketball_Dribble_Loop';
          }
          if (active === 'dash') clipName = 'Basketball_Sprint';
          if (active === 'jump') clipName = 'Basketball_Jump';
          if (active === 'shoot') clipName = (charging || dunkCharging) ? 'Basketball_Gather' : 'Basketball_Shot';
          if (active === 'dunk') clipName = 'Basketball_Dunk';
          if (active === 'steal') clipName = 'Basketball_Steal';
          if (active === 'stumble') clipName = 'Basketball_Steal';
          if (active === 'pass') clipName = 'Basketball_Pass';
          if (player.currentClip !== clipName) {
            const previous = player.currentClip ? player.actions.get(player.currentClip) : undefined;
            const next = player.actions.get(clipName);
            if (next) {
              const transition = /Crossover|BetweenLegs|Drive|Dunk/.test(clipName) ? 0.075 : 0.11;
              previous?.fadeOut(transition);
              const playbackRate = clipName === 'Basketball_Shot' ? 1.25
                : clipName === 'Basketball_Gather' ? 1.08
                : clipName === 'Basketball_Dunk' ? 2
                : clipName === 'Basketball_Crossover' ? 1.55
                : clipName === 'Basketball_BetweenLegs' ? 1.68
                : clipName === 'Basketball_Dribble_Backward' ? 1.3
                : clipName === 'Basketball_Dribble_Left' || clipName === 'Basketball_Dribble_Right' ? 1.36
                : clipName.startsWith('Basketball_Drive_') ? 1.75
                : clipName === 'Basketball_Sprint' ? 1.8
                : clipName === 'Basketball_Dribble_Loop' ? 1.12
                : clipName === 'Basketball_Steal' ? 1.35
                : clipName === 'Basketball_Pass' ? 1.25
                : 1;
              next.reset().setEffectiveWeight(1).setEffectiveTimeScale(playbackRate);
              if (clipName.endsWith('_Loop') || clipName.startsWith('Basketball_Dribble_') || clipName.startsWith('Basketball_Drive_') || clipName === 'Basketball_Crossover' || clipName === 'Basketball_BetweenLegs') next.setLoop(THREE.LoopRepeat, Infinity);
              else { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
              next.fadeIn(transition).play();
              player.currentClip = clipName;
            }
          }
          player.mixer.update(dt);
          if (index === 0 && viewMixer && viewActions) {
            let viewClipName = ball.owner === 0 ? 'Mixamo_Dribble' : 'Mixamo_Run';
            if (active === 'shoot' || active === 'pass') viewClipName = 'Mixamo_Shot';
            if (active === 'jump' || active === 'dunk') viewClipName = 'Mixamo_Block';
            if (active === 'steal') viewClipName = 'Mixamo_Steal';
            const viewPlaybackRate = viewClipName === 'Mixamo_Dribble' ? (moving ? 1.18 : 0.92)
              : viewClipName === 'Mixamo_Run' ? (moving ? 1.12 : 0.58)
              : viewClipName === 'Mixamo_Shot' ? 1.42
              : viewClipName === 'Mixamo_Block' ? 1.32
              : 1.52;
            if (viewCurrentClip !== viewClipName) {
              const previousView = viewActions.get(viewCurrentClip);
              const nextView = viewActions.get(viewClipName);
              if (nextView) {
                const transition = viewClipName === 'Mixamo_Steal' || viewClipName === 'Mixamo_Block' ? 0.045 : 0.075;
                previousView?.fadeOut(transition);
                nextView.reset()
                  .setEffectiveWeight(1)
                  .setEffectiveTimeScale(viewPlaybackRate);
                if (viewClipName === 'Mixamo_Dribble' || viewClipName === 'Mixamo_Run') nextView.setLoop(THREE.LoopRepeat, Infinity);
                else { nextView.setLoop(THREE.LoopOnce, 1); nextView.clampWhenFinished = true; }
                nextView.fadeIn(transition).play();
                viewCurrentClip = viewClipName;
              }
            } else {
              viewActions.get(viewClipName)?.setEffectiveTimeScale(viewPlaybackRate);
            }
            viewMixer.update(dt);
          }
          if (player.visual) {
            let targetLeanX = 0; let targetLeanZ = 0;
            if (index === 0 && specialShotActive) {
              if (charging) {
                // Load onto the plant foot first; the visible lean comes after
                // take-off instead of snapping on as soon as the mouse is held.
                if (shotStyle === 'fade') targetLeanX = 0.13;
                if (shotStyle === 'step-left') targetLeanZ = 0.12;
                if (shotStyle === 'step-right') targetLeanZ = -0.12;
              } else {
                const airDuration = shotStyle === 'fade' ? 0.62 : 0.54;
                const airProgress = clamp(shotAirElapsed / airDuration, 0, 1);
                const airLean = Math.sin(Math.PI * airProgress);
                if (shotStyle === 'fade') targetLeanX = -0.52 * airLean;
                if (shotStyle === 'step-left') targetLeanZ = -0.28 * airLean;
                if (shotStyle === 'step-right') targetLeanZ = 0.28 * airLean;
              }
            }
            if (active === 'stumble') { targetLeanX = 0.18; targetLeanZ = player.stumbleSide * 0.3; }
            player.visual.rotation.x += (targetLeanX - player.visual.rotation.x) * blend;
            player.visual.rotation.z += (targetLeanZ - player.visual.rotation.z) * blend;
          }
          player.group.position.set(player.position.x, player.jump, player.position.z);
          player.group.rotation.y = player.facing + visualSpin;
          player.group.updateMatrixWorld(true);
          if (player.rig && player.feet) {
            const leftFootWorld = player.feet[0].getWorldPosition(new THREE.Vector3());
            const rightFootWorld = player.feet[1].getWorldPosition(new THREE.Vector3());
            const feetCenter = leftFootWorld.clone().add(rightFootWorld).multiplyScalar(0.5);
            const horizontalAnchor = moving && player.hips
              ? player.hips.getWorldPosition(new THREE.Vector3())
              : feetCenter;
            const correction = new THREE.Vector3(player.position.x - horizontalAnchor.x, 0, player.position.z - horizontalAnchor.z)
              .applyQuaternion(player.group.quaternion.clone().invert());
            player.rig.position.x += clamp(correction.x, -0.32, 0.32);
            player.rig.position.z += clamp(correction.z, -0.32, 0.32);
            player.group.updateMatrixWorld(true);
          }
          if (player.rig && player.feet) {
            const footY = Math.min(
              player.feet[0].getWorldPosition(new THREE.Vector3()).y,
              player.feet[1].getWorldPosition(new THREE.Vector3()).y,
            );
            const correction = player.jump + 0.045 - footY;
            player.rig.position.y += clamp(correction, -0.09, 0.09);
            player.group.updateMatrixWorld(true);
          }
          return;
        }

        const body = player.group.getObjectByName('proceduralBody') as THREE.Group;
        const pelvis = player.group.getObjectByName('pelvis') as THREE.Group;
        const torso = player.group.getObjectByName('torsoPivot') as THREE.Group;
        const leftShoulder = player.group.getObjectByName('leftShoulder') as THREE.Group;
        const rightShoulder = player.group.getObjectByName('rightShoulder') as THREE.Group;
        const leftElbow = player.group.getObjectByName('leftElbow') as THREE.Group;
        const rightElbow = player.group.getObjectByName('rightElbow') as THREE.Group;
        const leftHip = player.group.getObjectByName('leftHip') as THREE.Group;
        const rightHip = player.group.getObjectByName('rightHip') as THREE.Group;
        const leftKnee = player.group.getObjectByName('leftKnee') as THREE.Group;
        const rightKnee = player.group.getObjectByName('rightKnee') as THREE.Group;
        const setRot = (object: THREE.Object3D, x: number, y: number, z: number) => {
          object.rotation.x += (x - object.rotation.x) * blend;
          object.rotation.y += (y - object.rotation.y) * blend;
          object.rotation.z += (z - object.rotation.z) * blend;
        };

        let torsoX = moving ? 0.1 : Math.sin(now * 2 + index) * 0.015;
        let torsoZ = index === 0 && moving ? -input.dot(right) * 0.12 : 0;
        let leftShoulderX = swing * 0.48;
        let rightShoulderX = -swing * 0.48;
        let leftShoulderZ = -0.1;
        let rightShoulderZ = 0.1;
        let leftElbowX = -0.08;
        let rightElbowX = -0.08;
        let leftHipX = -swing * 0.62;
        let rightHipX = swing * 0.62;
        let leftKneeX = Math.max(0, swing) * 0.65;
        let rightKneeX = Math.max(0, -swing) * 0.65;
        let pelvisY = 0.94;

        if (active === 'dribble') {
          torsoX = 0.18; torsoZ = -0.05; rightShoulderX = -0.62 - Math.max(0, Math.sin(now * 12)) * 0.42; rightElbowX = -0.62;
          leftShoulderX = 0.15 + swing * 0.22; pelvisY = 0.9;
        } else if (active === 'shoot') {
          const gather = charging ? clamp(shotCharge * 2.2, 0, 1) : clamp(1 - player.action / 1.15, 0, 1);
          torsoX = -0.05 + gather * -0.08; leftShoulderX = rightShoulderX = -1.75 - gather * 0.72;
          leftShoulderZ = -0.22; rightShoulderZ = 0.22; leftElbowX = rightElbowX = -0.55 + gather * 0.42;
          leftHipX = rightHipX = -0.08; leftKneeX = rightKneeX = gather < 0.35 ? 0.42 : 0.12;
          if (index === 0 && shotStyle === 'fade') torsoX -= 0.3;
          if (index === 0 && shotStyle === 'step-left') torsoZ -= 0.2;
          if (index === 0 && shotStyle === 'step-right') torsoZ += 0.2;
        } else if (active === 'dunk') {
          torsoX = -0.16; leftShoulderX = rightShoulderX = -2.35; leftShoulderZ = -0.2; rightShoulderZ = 0.2;
          leftElbowX = rightElbowX = -0.18; leftHipX = -0.42; rightHipX = 0.12; leftKneeX = 0.82; rightKneeX = 0.22;
        } else if (active === 'jump') {
          torsoX = -0.05; leftShoulderX = rightShoulderX = -0.9; leftShoulderZ = -2.45; rightShoulderZ = 2.45;
          leftElbowX = rightElbowX = -0.15; leftHipX = rightHipX = -0.3; leftKneeX = rightKneeX = 0.48;
        } else if (active === 'steal') {
          pelvisY = 0.8; torsoX = 0.28; torsoZ = -0.18; leftShoulderX = rightShoulderX = -0.82;
          leftShoulderZ = -1.16; rightShoulderZ = 1.16; leftElbowX = rightElbowX = -0.5; leftHipX = rightHipX = -0.2; leftKneeX = rightKneeX = 0.62;
        } else if (active === 'stumble') {
          pelvisY = 0.82; torsoX = 0.35; torsoZ = player.stumbleSide * 0.38; leftShoulderX = 0.38; rightShoulderX = -0.55;
          leftHipX = -0.35; rightHipX = 0.18; leftKneeX = 0.72; rightKneeX = 0.24;
        } else if (active === 'pass') {
          torsoX = 0.08; leftShoulderX = rightShoulderX = -1.48; leftShoulderZ = -0.3; rightShoulderZ = 0.3; leftElbowX = rightElbowX = -0.28;
        }

        pelvis.position.y += (pelvisY - pelvis.position.y) * blend;
        setRot(torso, torsoX, 0, torsoZ);
        setRot(leftShoulder, leftShoulderX, 0, leftShoulderZ); setRot(rightShoulder, rightShoulderX, 0, rightShoulderZ);
        setRot(leftElbow, leftElbowX, 0, 0); setRot(rightElbow, rightElbowX, 0, 0);
        setRot(leftHip, leftHipX, 0, 0); setRot(rightHip, rightHipX, 0, 0);
        setRot(leftKnee, leftKneeX, 0, 0); setRot(rightKnee, rightKneeX, 0, 0);
        body.rotation.y += (0 - body.rotation.y) * blend;

        player.group.position.set(player.position.x, player.jump + (moving && player.jump === 0 ? Math.abs(Math.sin(phase * 2)) * 0.035 : 0), player.position.z);
        player.group.rotation.y = player.facing + visualSpin;
        player.group.updateMatrixWorld(true);
      });
      if (!charging && !shotPending && me.action <= 0 && shotStyle !== 'normal') shotStyle = 'normal';
    };

    const updateCamera = () => {
      const me = athletes[0];
      if (viewModel) viewModel.visible = phaseRef.current === 'playing';
      const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const moving = me.velocity.lengthSq() > 0.16 && me.jump < 0.06 && !dunking;
      const armClock = performance.now() / 1000;
      const stride = moving ? Math.sin(armClock * 11.5) : 0;
      const bob = stride * 0.018;
      const lateralSway = moving ? Math.cos(armClock * 5.75) * 0.014 : 0;
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      // Derive the view height from the same animated head bone used by every
      // world athlete. This keeps the player's eye line anatomically consistent
      // with opponents instead of imposing a fixed, mismatched camera height.
      if (me.head) {
        const animatedHead = me.head.getWorldPosition(new THREE.Vector3());
        const standingEye = clamp(animatedHead.y - me.jump + 0.075, 1.68, 1.92);
        cameraEyeHeight += (standingEye - cameraEyeHeight) * 0.16;
      }
      const eye = me.position.clone().addScaledVector(forward, 0.21).addScaledVector(right, lateralSway);
      eye.y = cameraEyeHeight + me.jump + bob;
      camera.position.copy(eye);
      const lookDirection = forward.multiplyScalar(Math.cos(cameraPitch));
      lookDirection.y = Math.sin(cameraPitch);
      camera.lookAt(eye.clone().addScaledVector(lookDirection.normalize(), 14));

      if (blockCameraKick > 0) {
        const strength = blockCameraKick / 0.24;
        camera.position.x += (Math.random() - 0.5) * 0.055 * strength;
        camera.position.y += (Math.random() - 0.5) * 0.045 * strength;
        camera.rotation.z += (Math.random() - 0.5) * 0.045 * strength;
      }
    };

    const resize = () => {
      const width = canvas.clientWidth; const height = canvas.clientHeight;
      renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize); resize(); resetPositions(0);

    runtimeRef.current = {
      reset: resetGame,
      setJersey: (color) => {
        athletes.slice(0, 3).forEach((player) => {
          const teamMaterials = player.group.userData.teamMaterials as Array<THREE.MeshStandardMaterial | THREE.MeshPhongMaterial> | undefined;
          teamMaterials?.forEach((material) => { material.color.set(color); material.needsUpdate = true; });
          const jerseyMesh = player.group.getObjectByName('jersey') as THREE.Mesh | undefined;
          const shortsMesh = player.group.getObjectByName('shorts') as THREE.Mesh | undefined;
          if (jerseyMesh) (jerseyMesh.material as THREE.MeshStandardMaterial).color.set(color);
          if (shortsMesh) (shortsMesh.material as THREE.MeshStandardMaterial).color.set(color).multiplyScalar(0.55);
        });
      },
    };

    let frame = 0;
    const loop = () => {
      const now = performance.now() / 1000;
      const dt = Math.min(0.032, now - last); last = now;
      blockCameraKick = Math.max(0, blockCameraKick - dt);
      if (phaseRef.current === 'playing') {
        gameTime = Math.max(0, gameTime - dt); aiShotCooldown -= dt; dribbleGrace = Math.max(0, dribbleGrace - dt); dashCooldown = Math.max(0, dashCooldown - dt); ankleBreakWindow = Math.max(0, ankleBreakWindow - dt);
        if (delayedDashAt && performance.now() >= delayedDashAt) { delayedDashAt = 0; startDash(); }
        const wasDashing = dashTime > 0;
        dashTime = Math.max(0, dashTime - dt);
        if (wasDashing && dashTime === 0) { dashWithBall = false; spinDirection = 0; dribbleMove = dribbling ? resolveDribbleMove(false) : 'forward'; }
        if (!dribbling && dribbleGrace <= 0 && dashTime <= 0) dribbleMove = 'forward';
        if (gameTime <= 0) { changePhase('over'); document.exitPointerLock?.(); }
        if (resetAt && now >= resetAt) resetPositions(nextPossession);
        if (!resetAt) {
          if (dunking) dunkElapsed += dt;
          updatePlayers(dt, now);
          if (charging) { shotCharge += dt * 1.45; if (shotCharge > 1) shotCharge = 0.18; }
          if (shotPending) {
            shotReleaseDelay -= dt;
            if (ball.owner !== 0) { shotPending = false; shotStyle = 'normal'; }
            else if (shotReleaseDelay <= 0) releaseShot(0, pendingShotPower);
          }
          if (dunkCharging) { dunkPower += dt * 1.12; if (dunkPower > 1) dunkPower = 0.24; }
          updateBall(dt, now);
        }
        uiAt += dt;
        if (uiAt > 0.08) { uiAt = 0; setClock(gameTime); setCharge(charging ? shotCharge : 0); setDunkCharge(dunkCharging ? dunkPower : 0); setStamina(sprint); }
      } else {
        athletes.forEach((player, index) => { player.group.position.y = Math.sin(now * 2 + index) * 0.012; });
        updateBall(0, now);
      }
      updateCamera();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      rigCancelled = true;
      if (blockFeedbackTimer) window.clearTimeout(blockFeedbackTimer);
      cancelAnimationFrame(frame);
      runtimeRef.current = null;
      document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onPointerLock);
      canvas.removeEventListener('mousedown', onMouseDown); canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, [changePhase]);

  const chooseJersey = (color: string) => {
    jerseyRef.current = color; setJersey(color); runtimeRef.current?.setJersey(color);
  };
  const timeText = `${Math.floor(clock / 60)}:${String(Math.ceil(clock % 60)).padStart(2, '0')}`;

  return (
    <main className="game3d">
      <canvas ref={canvasRef} tabIndex={0} aria-label="第一人称 3D 篮球场" />
      <header className="hud3d"><div className="score3d home">{score[0]}</div><i>—</i><div className="score3d away">{score[1]}</div><time>{timeText}</time></header>
      {message && <div className="event3d">{message}</div>}
      {blockImpact && <div className="blockImpact3d" aria-live="assertive"><strong>BLOCK!</strong><span>封盖成功</span></div>}
      {phase === 'playing' && <>
        <div className="room3d"><span>Room code: <b>1844</b></span><span>Region: asia</span><span>Type: local</span><em>⌁ Ping: 18</em></div>
        <div className="chat3d"><button className="exit3d" onClick={()=>changePhase('paused')}>Exit <kbd>P</kbd></button><div><button onClick={()=>setMessage('PASS!')}>PASS <kbd>1</kbd></button><button onClick={()=>setMessage('NICE!')}>NICE <kbd>2</kbd></button><button onClick={()=>setMessage('SORRY!')}>SORRY <kbd>3</kbd></button><span>CHAT</span></div></div>
        <div className="guide3d"><span>Jump / Block <kbd>LMB</kbd></span><span>Steal <kbd>Shift</kbd></span><span>Pass / Call <kbd>F</kbd></span><span>Dash <kbd>Space</kbd></span><span>Dribble + Move <kbd>RMB</kbd></span><span>Burst Combo <kbd>RMB + Space</kbd></span><span>Side-step Shot <kbd>A/D + Space + LMB</kbd></span><span>Fadeaway <kbd>S + Space + LMB</kbd></span><span>Shoot <kbd>LMB</kbd></span><span>Dunk / Putback <kbd>Tab</kbd></span></div>
        <div className="status3d"><i><b style={{height:`${stamina * 100}%`}}/></i>{charge > 0 && <i className="charge3d"><b style={{height:`${charge * 100}%`}}/></i>}{dunkCharge > 0 && <i className="dunk3d"><b style={{height:`${dunkCharge * 100}%`}}/></i>}</div>
      </>}

      {phase === 'menu' && <section className="menu3d">
        <div className="logo3d"><span>UNMATCHED</span><strong>BASKETBALL</strong></div>
        <nav><button>JOIN ROOM <em>⌂</em></button><button>CUSTOMIZE <em>●</em></button><button>ABILITIES <em>◉</em></button></nav>
        <div className="jerseys3d"><span>球衣</span>{COLORS.map(color=><button key={color} onClick={()=>chooseJersey(color)} className={jersey===color?'active':''} style={{background:color}} aria-label={`选择 ${color} 球衣`}/>)}</div>
        <button className="quick3d" onClick={startGame}><span>QUICK PLAY</span><b>▶</b></button>
        <p>第一人称 3V3 · 90 秒快速比赛</p>
      </section>}

      {(phase === 'paused' || phase === 'over') && <section className="pause3d">
        <p>{phase === 'over' ? 'FINAL SCORE' : 'GAME PAUSED'}</p>
        <h2>{phase === 'over' ? (score[0] > score[1] ? '你赢了！' : score[0] === score[1] ? '平局！' : '再战一场？') : '暂停'}</h2>
        {phase === 'over' && <div>{score[0]} <span>:</span> {score[1]}</div>}
        <button onClick={phase === 'over' ? startGame : resume}>{phase === 'over' ? '重新比赛' : '继续比赛'}</button>
        <button className="secondary" onClick={()=>changePhase('menu')}>返回主菜单</button>
      </section>}
    </main>
  );
}
