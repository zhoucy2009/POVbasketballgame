import * as THREE from 'three';

export type CourtTheme = 'rucker' | 'beach' | 'forest' | 'hall';
export const COURT_THEMES: { id: CourtTheme; name: string; caption: string; icon: string }[] = [
  { id: 'rucker', name: '洛克公园', caption: '纽约街球 · 围栏与欢呼', icon: '▦' },
  { id: 'beach', name: '海边球场', caption: '碧海 · 椰林 · 沙滩', icon: '☀' },
  { id: 'forest', name: '森林中心', caption: '林间球赛 · 动物伙伴', icon: '♣' },
  { id: 'hall', name: '名人堂', caption: '职业赛场 · 满座看台', icon: '★' },
];

const material = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
function box(parent: THREE.Object3D, size: [number, number, number], p: [number, number, number], mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); m.position.set(...p); m.receiveShadow = true; parent.add(m); return m;
}
function ellipsoid(parent: THREE.Object3D, scale: [number, number, number], p: [number, number, number], mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat); m.scale.set(...scale); m.position.set(...p); parent.add(m); return m;
}
function branch(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.75, radius, a.distanceTo(b), 7), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); parent.add(m); return m;
}
function sign(parent: THREE.Object3D, text: string, subtitle: string, p: [number, number, number], w: number, h: number, color = '#e6c687') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#101c28'; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 1000, 232);
  ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '900 88px Arial'; ctx.fillText(text, 512, 133);
  ctx.fillStyle = '#f3f0e3'; ctx.font = '600 27px Arial'; ctx.fillText(subtitle, 512, 197);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material('#ffffff', { map: texture, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.18 }));
  m.position.set(...p); parent.add(m); return m;
}

/** Seven instanced batches keep several hundred animated fans affordable. */
function crowd(parent: THREE.Group, seats: THREE.Vector3[], animals: boolean) {
  const count = seats.length, body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.38, 3, 8), material('#ffffff'), count);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), material('#ffffff'), count);
  const limbs = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.055, 0.38, 2, 6), material('#ffffff'), count * 4);
  const ears = animals ? new THREE.InstancedMesh(new THREE.ConeGeometry(0.08, 0.25, 7), material('#ffffff'), count * 2) : null;
  const muzzles = animals ? new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), material('#edddbf'), count) : null;
  const eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 4), material('#151616'), count * 2);
  const obj = new THREE.Object3D(), colors = ['#ef745a', '#4ea6c0', '#efc555', '#eee5d5', '#8e83ce'];
  const skins = animals ? ['#b37946', '#df984e', '#8596a1', '#f0e3ce'] : ['#bd8d66', '#82583f', '#dba985', '#a87453'];
  [body, heads, limbs, ears, muzzles, eyes].forEach(m => { if (m) { m.frustumCulled = false; parent.add(m); } });
  const rotations = seats.map(p => p.z < 0 ? 0 : Math.PI);
  for (let i = 0; i < count; i++) {
    obj.position.copy(seats[i]).add(new THREE.Vector3(0, 0.92, 0)); obj.rotation.set(0, rotations[i], 0); obj.updateMatrix(); body.setMatrixAt(i, obj.matrix); body.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    obj.position.y += 0.51; obj.updateMatrix(); heads.setMatrixAt(i, obj.matrix); heads.setColorAt(i, new THREE.Color(skins[i % skins.length]));
    for (const side of [-1, 1]) {
      const j = i * 2 + (side > 0 ? 1 : 0);
      if (ears) {
        obj.position.copy(seats[i]).add(new THREE.Vector3(side * 0.105, 1.62, 0)); obj.scale.set(1, i % 4 === 3 ? 1.75 : 1, 1); obj.updateMatrix(); ears.setMatrixAt(j, obj.matrix); ears.setColorAt(j, new THREE.Color(skins[i % skins.length])); obj.scale.setScalar(1);
      }
      if (eyes) { obj.position.copy(seats[i]).add(new THREE.Vector3(side * 0.064, 1.46, Math.cos(rotations[i]) * 0.142)); obj.updateMatrix(); eyes.setMatrixAt(j, obj.matrix); }
      if (muzzles) { obj.position.copy(seats[i]).add(new THREE.Vector3(0, 1.36, Math.cos(rotations[i]) * 0.155)); obj.updateMatrix(); muzzles.setMatrixAt(i, obj.matrix); }
      obj.position.copy(seats[i]).add(new THREE.Vector3(side * 0.13, 0.4, 0.13)); obj.rotation.set(-0.2, rotations[i], 0); obj.updateMatrix(); limbs.setMatrixAt(i * 4 + (side > 0 ? 1 : 0), obj.matrix);
      limbs.setColorAt(i * 4 + (side > 0 ? 1 : 0), new THREE.Color('#253548'));
      limbs.setColorAt(i * 4 + 2 + (side > 0 ? 1 : 0), new THREE.Color(skins[i % skins.length]));
    }
  }
  return (time: number, cheering: number) => {
    for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
      const wave = Math.sin(time * 3 + i * 1.7) * 0.22;
      const raised = cheering > 0.1 || i % 7 === 0;
      obj.position.copy(seats[i]).add(new THREE.Vector3(side * (raised ? 0.26 : 0.25), raised ? 1.32 : 0.85, 0));
      obj.rotation.set(0, rotations[i], side * (raised ? 0.32 + wave : -0.25 + wave * 0.2)); obj.updateMatrix(); limbs.setMatrixAt(i * 4 + 2 + (side > 0 ? 1 : 0), obj.matrix);
    }
    limbs.instanceMatrix.needsUpdate = true;
  };
}

function plants(parent: THREE.Group, forest: boolean, count: number) {
  const bark = material('#66523a'), greens = ['#2c6045', '#3a7750', '#508957', '#6d9d5c'].map(c => material(c));
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996, x = Math.cos(a) * (26 + i % 4 * 2.3), z = Math.sin(a) * (16 + i % 3 * 2.5);
    const height = forest ? 7 + i % 5 : 4 + i % 3;
    branch(parent, new THREE.Vector3(x, -0.1, z), new THREE.Vector3(x + 0.35, height, z), 0.22, bark).castShadow = true;
    for (let j = 0; j < 3; j++) {
      const crown = ellipsoid(parent, [2.1, 2.1 + j * 0.2, 1.8], [x + Math.sin(j * 2) * 1.2, height - 0.6 + j * 0.7, z + Math.cos(j * 2)], greens[(i + j) % 4]); crown.castShadow = i % 3 === 0;
    }
    for (let leaf = 0; leaf < 5; leaf++) {
      const fern = ellipsoid(parent, [0.12, 0.68, 0.25], [x + Math.cos(leaf) * 0.4, 0.4, z + Math.sin(leaf) * 0.4], greens[(i + leaf) % 4]); fern.rotation.set(0.5, leaf, 0.65);
    }
    if (forest && i % 3 === 0) { const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), material('#788574')); rock.position.set(x + 1.4, 0.25, z); rock.scale.y = 0.6; parent.add(rock); }
  }
}

export function createCourtWorlds(scene: THREE.Scene, street: THREE.Group) {
  const worlds = new Map<CourtTheme, { group: THREE.Group; update: (time: number, cheering: number) => void }>();
  let active: CourtTheme = 'rucker';
  const build = (theme: CourtTheme) => {
    const group = new THREE.Group(); group.name = `court-${theme}`; scene.add(group);
    let water: THREE.Mesh | undefined;
    const seats: THREE.Vector3[] = [];
    const metal = material('#273745', { metalness: 0.55, roughness: 0.4 });
    if (theme === 'rucker') {
      plants(group, false, 13);
      sign(group, 'RUCKER PARK', 'HARLEM  /  NEW YORK STREETBALL', [0, 5.7, -13.48], 9, 2.2, '#f3ac62');
      for (const side of [-1, 1]) for (let row = 0; row < 2; row++) {
        box(group, [29, 0.3, 0.85], [1, row * 0.48 + 0.26, side * (12 + row * 1.05)], metal);
        for (let i = 0; i < 22; i++) seats.push(new THREE.Vector3(-13 + i * 1.3, row * 0.48, side * (12 + row * 1.05)));
      }
    } else if (theme === 'beach') {
      box(group, [230, 0.25, 200], [0, -0.4, 0], material('#e6d3a1'));
      water = new THREE.Mesh(new THREE.PlaneGeometry(150, 240, 1, 1), material('#209cb2', { metalness: 0.35, roughness: 0.24 })); water.rotation.x = -Math.PI / 2; water.position.set(100, -0.19, 0); group.add(water);
      const foam = material('#b4f2de', { transparent: true, opacity: 0.65 });
      for (let i = 0; i < 10; i++) box(group, [0.15 + i * 0.07, 0.025, 180], [26 + i * 3.1, -0.15, 0], foam);
      const bark = material('#937250'), leaf = material('#2f885b');
      for (let i = 0; i < 12; i++) {
        const x = -27 + i * 5, z = i % 2 ? -16 : 16;
        for (let j = 0; j < 7; j++) branch(group, new THREE.Vector3(x + j * j * 0.018, j * 0.8, z), new THREE.Vector3(x + (j + 1) ** 2 * 0.018, (j + 1) * 0.8, z), 0.18, bark);
        for (let j = 0; j < 8; j++) {
          const frond = ellipsoid(group, [0.38, 0.08, 2.6], [x + 0.8 + Math.sin(j * Math.PI / 4) * 1.8, 5.5, z + Math.cos(j * Math.PI / 4) * 1.8], leaf); frond.rotation.set(0.15, j * Math.PI / 4, 0.1);
        }
      }
      for (let i = 0; i < 6; i++) {
        const x = -16 + i * 6;
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.65, 10), material(i % 2 ? '#f38167' : '#f0d369')); canopy.position.set(x, 2.7, -15); group.add(canopy);
        branch(group, new THREE.Vector3(x, 0, -15), new THREE.Vector3(x, 2.8, -15), 0.04, metal);
        box(group, [1.8, 0.18, 0.7], [x, 0.42, -14.6], material('#f6f1dc'));
        for (let j = 0; j < 4; j++) seats.push(new THREE.Vector3(x - 1.3 + j * 0.8, 0, -13.7));
      }
      sign(group, 'COASTAL HOOPS', 'OCEAN AIR  /  OPEN COURT', [0, 3.5, -18], 9, 2.3, '#6ed7d6');
      const boat = box(group, [4, 0.5, 1.2], [49, 0, -16], material('#f5ecdd')); boat.rotation.y = 0.35;
      branch(group, new THREE.Vector3(49, 0, -16), new THREE.Vector3(49, 6, -16), 0.045, metal);
      const sail = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 3), material('#fff3d0')); sail.position.set(49.7, 3.4, -16); sail.scale.z = 0.04; group.add(sail);
    } else if (theme === 'forest') {
      box(group, [180, 0.2, 160], [0, -0.35, 0], material('#426047'));
      plants(group, true, 48);
      sign(group, 'WILDWOOD', 'THE FOREST BASKETBALL CLUB', [0, 4.4, -16], 10, 2.5, '#aad6a0');
      const log = material('#725134');
      for (const side of [-1, 1]) for (let i = 0; i < 24; i++) {
        const x = -19 + i * 1.65;
        seats.push(new THREE.Vector3(x, 0, side * 13));
        if (i % 4 === 0) branch(group, new THREE.Vector3(x - 0.6, 0.35, side * 13), new THREE.Vector3(x + 4.2, 0.35, side * 13), 0.3, log);
      }
      const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 5, 4), material('#e6c172'), 120);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 120; i++) { const a = i * 2.4; matrix.makeTranslation(Math.cos(a) * (22 + i % 5), 0.15 + i % 3 * 0.12, Math.sin(a) * (14 + i % 4)); flowers.setMatrixAt(i, matrix); } group.add(flowers);
    } else {
      box(group, [60, 0.3, 44], [0, -0.4, 0], material('#121a29'));
      for (const z of [-22, 22]) box(group, [58, 17, 0.4], [0, 8, z], material('#192235'));
      for (const x of [-29, 29]) box(group, [0.4, 17, 44], [x, 8, 0], material('#192235'));
      box(group, [58, 0.3, 44], [0, 16, 0], material('#111929'));
      for (const side of [-1, 1]) for (let row = 0; row < 5; row++) {
        const z = side * (12.8 + row * 1.35), y = row * 0.78;
        box(group, [44, 0.5, 1.3], [0, y + 0.1, z], material(row % 2 ? '#30394c' : '#222c40'));
        for (let i = 0; i < 42; i++) seats.push(new THREE.Vector3(-21 + i * 1.02, y, z));
      }
      const led = material('#d4ad59', { emissive: '#d4ad59', emissiveIntensity: 0.75 });
      for (const z of [-11.8, 11.8]) box(group, [44, 0.4, 0.2], [0, 0.4, z], led);
      for (const x of [-25, 25]) {
        const board = sign(group, 'HALL OF FAME', 'LEGENDS LIVE HERE  /  PRO BASKETBALL', [x, 7.3, 0], 16, 4); board.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
        for (let i = 0; i < 5; i++) {
          const banner = sign(group, ['23', '24', '30', '33', '34'][i], 'LEGENDS', [x, 11.6, -12 + i * 6], 2.6, 3.5, i % 2 ? '#bc9afa' : '#f0c25f'); banner.rotation.y = board.rotation.y;
        }
      }
      box(group, [5, 2.6, 3.2], [0, 10, 0], material('#090e17'));
      for (const z of [-1.62, 1.62]) { const screen = sign(group, 'UNMATCHED', 'HALL OF FAME', [0, 10, z], 4.8, 2.4); if (z < 0) screen.rotation.y = Math.PI; }
      for (const x of [-18, -6, 6, 18]) for (const z of [-8, 8]) {
        box(group, [3, 0.08, 0.6], [x, 14.8, z], material('#fff4d9', { emissive: '#fff4d9', emissiveIntensity: 2 }));
        const light = new THREE.PointLight('#e5edff', 65, 27, 2); light.position.set(x, 11, z); group.add(light);
      }
    }
    const updateCrowd = crowd(group, seats, theme === 'forest');
    const world = { group, update: (time: number, cheering: number) => { updateCrowd(time, cheering); if (water) water.position.y = -0.19 + Math.sin(time * 0.65) * 0.035; } };
    worlds.set(theme, world); return world;
  };
  return {
    select(theme: CourtTheme) {
      active = theme; if (!worlds.has(theme)) build(theme);
      street.visible = theme === 'rucker'; worlds.forEach((world, key) => { world.group.visible = key === theme; });
      scene.background = new THREE.Color(theme === 'hall' ? '#101622' : theme === 'forest' ? '#a3bdad' : theme === 'beach' ? '#88d5e9' : '#84bee3');
      scene.fog = new THREE.Fog(theme === 'forest' ? '#789585' : theme === 'hall' ? '#131a29' : '#b9d7e8', theme === 'forest' ? 32 : 55, theme === 'forest' ? 85 : 145);
    },
    update(time: number, cheering: number) { worlds.get(active)?.update(time, cheering); },
  };
}

/** Animal heads, paws and tails share the mocap skeleton and gameplay hitboxes. */
export function createAnimalLook(group: THREE.Group, rig: THREE.Group, index: number) {
  const species = index % 3, fur = material(['#ae794f', '#d88943', '#c9c9ba'][species]);
  const cream = material('#f2e1c4'), dark = material('#25272b');
  const parts: THREE.Object3D[] = [];
  const attach = (part: THREE.Object3D, boneName: string, offset: THREE.Vector3) => {
    const bone = rig.getObjectByName(boneName); if (!bone) return;
    group.updateMatrixWorld(true); part.position.copy(group.worldToLocal(bone.getWorldPosition(new THREE.Vector3()))).add(offset);
    group.add(part); group.updateMatrixWorld(true); bone.attach(part); parts.push(part);
  };
  const head = new THREE.Group();
  ellipsoid(head, [0.23, 0.24, 0.21], [0, 0.04, 0], fur);
  ellipsoid(head, [0.135, 0.095, 0.12], [0, -0.02, 0.2], cream);
  ellipsoid(head, [0.045, 0.035, 0.03], [0, 0.01, 0.315], dark);
  for (const side of [-1, 1]) {
    ellipsoid(head, [0.035, 0.045, 0.025], [side * 0.095, 0.095, 0.196], dark);
    if (species === 1) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.27, 8), fur); ear.position.set(side * 0.155, 0.28, 0); head.add(ear);
    } else ellipsoid(head, [0.08, species === 2 ? 0.26 : 0.09, 0.065], [side * 0.15, species === 2 ? 0.36 : 0.25, 0], fur);
  }
  attach(head, 'Head', new THREE.Vector3(0, 0.08, 0));
  const tail = new THREE.Group(); ellipsoid(tail, [0.1, species === 1 ? 0.36 : 0.12, 0.13], [0, -0.07, 0], species === 2 ? cream : fur); tail.rotation.x = -0.65;
  attach(tail, 'Hips', new THREE.Vector3(0, -0.02, -0.22));
  for (const side of ['L', 'R']) { const paw = new THREE.Group(); ellipsoid(paw, [0.065, 0.055, 0.09], [0, 0, 0], fur); attach(paw, `Hand${side}`, new THREE.Vector3()); }
  const humanHead = rig.getObjectByName('Casual_Head');
  return { setVisible(on: boolean) { parts.forEach(part => { part.visible = on; }); if (humanHead) humanHead.visible = !on; }, update(time: number) { tail.rotation.z = Math.sin(time * 3 + index) * 0.2; } };
}
