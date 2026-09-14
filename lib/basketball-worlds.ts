import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type CourtTheme = 'rucker' | 'beach' | 'forest' | 'hall';
export const COURT_THEMES: { id: CourtTheme; name: string; caption: string; icon: string }[] = [
  { id: 'rucker', name: '洛克公园', caption: '哈林街头 · 涂鸦与铁网', icon: '▦' },
  { id: 'beach', name: '海边球场', caption: '蓝调时刻 · 紫橙落日', icon: '☀' },
  { id: 'forest', name: '森林中心', caption: '巨树穹顶 · 林间精灵', icon: '♣' },
  { id: 'hall', name: '名人堂', caption: '黑金殿堂 · 冠军之夜', icon: '★' },
];

const material = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
function box(parent: THREE.Object3D, size: [number, number, number], p: [number, number, number], mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); m.position.set(...p); m.receiveShadow = true; parent.add(m); return m;
}
function ellipsoid(parent: THREE.Object3D, scale: [number, number, number], p: [number, number, number], mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat); m.scale.set(...scale); m.position.set(...p); parent.add(m); return m;
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

/** Shared batches give each fan a face, clothes and footwear without a draw call per part. */
function crowd(parent: THREE.Group, seats: THREE.Vector3[], theme: CourtTheme) {
  const animals = theme === 'forest', count = seats.length;
  const batch = (geometry: THREE.BufferGeometry, n: number, color = '#ffffff') => {
    const mesh = new THREE.InstancedMesh(geometry, material(color), n);
    mesh.frustumCulled = false; parent.add(mesh); return mesh;
  };
  const body = batch(new THREE.CapsuleGeometry(0.19, 0.34, 5, 12), count);
  const heads = batch(new THREE.SphereGeometry(0.17, 16, 12), count);
  const limbs = batch(new THREE.CapsuleGeometry(0.055, 0.32, 4, 8), count * 4);
  const shoes = batch(new THREE.SphereGeometry(1, 12, 8), count * 2);
  const eyes = batch(new THREE.SphereGeometry(0.022, 8, 6), count * 2, '#1e1923');
  const glints = batch(new THREE.SphereGeometry(0.008, 6, 4), count * 2, '#fff7ea');
  const noses = batch(new THREE.SphereGeometry(1, 10, 8), count);
  const hair = animals ? null : batch(new THREE.SphereGeometry(1, 14, 10), count);
  const hats = !animals ? batch(new THREE.SphereGeometry(1, 12, 8), count) : null;
  const ears = animals ? batch(new THREE.SphereGeometry(1, 12, 8), count * 2) : null;
  const innerEars = animals ? batch(new THREE.SphereGeometry(1, 10, 8), count * 2, '#dea59c') : null;
  const muzzles = animals ? batch(new THREE.SphereGeometry(1, 12, 8), count, '#f2dfbd') : null;
  const collars = batch(new THREE.TorusGeometry(0.1, 0.021, 6, 16), count, '#f7e9d1');
  const colors = theme === 'hall' ? ['#dfb756', '#8973b4', '#f2e9d5', '#283650']
    : theme === 'forest' ? ['#af704d', '#71926a', '#deb76c', '#568a8a']
    : theme === 'beach' ? ['#ec9c85', '#96cece', '#c3a1db', '#eed3a2']
    : ['#df6651', '#487f99', '#d3a447', '#ded9c7', '#514d7e'];
  const skins = animals ? ['#aa7246', '#d48a46', '#9ca8ad', '#e5d6bc'] : ['#bd8d66', '#82583f', '#dba985', '#a87453'];
  const obj = new THREE.Object3D(), yAxis = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  const rotations = seats.map(p => p.z < 0 ? 0 : Math.PI);
  const put = (mesh: THREE.InstancedMesh, j: number, i: number, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1], tilt = 0) => {
    obj.position.set(x, y, z).applyAxisAngle(yAxis, rotations[i]).add(seats[i]);
    obj.rotation.set(0, rotations[i], tilt); obj.scale.set(...scale); obj.updateMatrix(); mesh.setMatrixAt(j, obj.matrix);
  };
  for (let i = 0; i < count; i++) {
    put(body, i, i, 0, 0.89, 0, [1, 0.94 + i % 3 * 0.04, 0.9]); body.setColorAt(i, tint.set(colors[i % colors.length]));
    put(heads, i, i, 0, 1.4, 0, [1, 1.1, 0.94]); heads.setColorAt(i, tint.set(skins[i % skins.length]));
    put(collars, i, i, 0, 1.15, 0.09, [1, 0.45, 1]);
    put(noses, i, i, 0, animals ? 1.36 : 1.4, animals ? 0.24 : 0.167, animals ? [0.034, 0.024, 0.023] : [0.023, 0.035, 0.03]);
    noses.setColorAt(i, tint.set(animals ? '#302729' : skins[i % skins.length]));
    if (muzzles) put(muzzles, i, i, 0, 1.33, 0.16, [0.10, 0.065, 0.075]);
    if (hair) { put(hair, i, i, 0, 1.51, -0.018, [0.176, 0.115 + i % 3 * 0.014, 0.156]); hair.setColorAt(i, tint.set(['#2b201c', '#5b3b27', '#252734', '#a27843'][i % 4])); }
    if (hats) {
      const cap = i % 3 === 0 || theme === 'beach';
      put(hats, i, i, 0, 1.56, 0.035, cap ? [theme === 'beach' ? 0.27 : 0.19, 0.035, 0.23] : [0, 0, 0]);
      hats.setColorAt(i, tint.set(theme === 'beach' ? '#e5c28b' : colors[i % colors.length]));
    }
    for (const side of [-1, 1]) {
      const j = i * 2 + (side > 0 ? 1 : 0);
      put(eyes, j, i, side * 0.063, 1.44, 0.151);
      put(glints, j, i, side * 0.063 - 0.006, 1.448, 0.17);
      if (ears && innerEars) {
        const height = i % 4 === 3 ? 0.2 : i % 4 === 1 ? 0.12 : 0.075;
        put(ears, j, i, side * 0.125, 1.57 + height * 0.45, 0, [0.065, height, 0.06], -side * 0.14);
        ears.setColorAt(j, tint.set(skins[i % skins.length]));
        put(innerEars, j, i, side * 0.125, 1.58 + height * 0.45, 0.049, [0.031, height * 0.68, 0.015], -side * 0.14);
      }
      put(limbs, i * 4 + (side > 0 ? 1 : 0), i, side * 0.115, 0.36, 0.11);
      limbs.setColorAt(i * 4 + (side > 0 ? 1 : 0), tint.set(theme === 'beach' ? skins[i % skins.length] : '#2a3344'));
      limbs.setColorAt(i * 4 + 2 + (side > 0 ? 1 : 0), tint.set(skins[i % skins.length]));
      put(shoes, j, i, side * 0.12, 0.1, 0.17, [0.085, 0.065, 0.15]); shoes.setColorAt(j, tint.set(theme === 'forest' ? skins[i % skins.length] : i % 2 ? '#ece4d5' : '#32344a'));
    }
  }
  return (time: number, cheering: number) => {
    for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
      const wave = Math.sin(time * 3 + i * 1.7) * 0.22, raised = cheering > 0.1 || i % 7 === 0;
      put(limbs, i * 4 + 2 + (side > 0 ? 1 : 0), i, side * 0.26, raised ? 1.3 : 0.87, 0.015, [1, 1, 1], side * (raised ? 0.32 + wave : -0.25 + wave * 0.2));
    }
    limbs.instanceMatrix.needsUpdate = true;
  };
}

function foliageMaterial(color: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#a0b39c'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 620; i++) {
    ctx.fillStyle = ['#cad3ba', '#8ea388', '#dae0cc', '#697f68'][i % 4];
    ctx.beginPath(); ctx.ellipse(i * 137 % 256, i * 71 % 256, 3 + i % 5, 1.5 + i % 3, i * 1.7, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2, 1); texture.anisotropy = 4;
  return material(color, { map: texture, bumpMap: texture, bumpScale: 0.12 });
}
function canopy(parent: THREE.Object3D, scale: [number, number, number], position: [number, number, number], mat: THREE.Material) {
  const geometry = new THREE.SphereGeometry(1, 24, 16), positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const noise = 1 + Math.sin(x * 14 + z * 5) * Math.cos(y * 13 - z * 11) * 0.1 + Math.sin(x * 7 - y * 8 + z * 9) * 0.07;
    positions.setXYZ(i, x * noise, y * noise, z * noise);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); parent.add(mesh); return mesh;
}
function palmFrond(parent: THREE.Object3D, x: number, z: number, angle: number, mat: THREE.Material) {
  const vertices: number[] = [], uvs: number[] = [];
  const center = (t: number) => new THREE.Vector3(0, 0.5 * Math.sin(t * Math.PI) - t * t * 1.2, t * 3.7);
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => { vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray()); uvs.push(0, 0, 1, 0, 0.5, 1); };
  for (let i = 0; i < 13; i++) {
    const t = i / 14, a = center(t), b = center(t + 0.08), width = Math.sin((t * 0.86 + 0.08) * Math.PI) * 0.65;
    for (const side of [-1, 1]) {
      const tip = center(t + 0.19); tip.x = side * width; tip.y -= 0.18;
      triangle(a, tip, b);
      const raised = a.clone(); raised.x = side * width * 0.38; raised.y += 0.03; triangle(a, raised, tip);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, 5.65, z); mesh.rotation.y = angle; mesh.castShadow = true; parent.add(mesh);
}

function plants(parent: THREE.Group, forest: boolean, count: number) {
  const bark = material('#66523a'), greens = ['#39634b', '#4b7654', '#527e57', '#6c8d60'].map(c => foliageMaterial(c));
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996, x = Math.cos(a) * (26 + i % 4 * 2.3), z = Math.sin(a) * (16 + i % 3 * 2.5);
    const height = forest ? 7 + i % 5 : 4 + i % 3;
    branch(parent, new THREE.Vector3(x, -0.1, z), new THREE.Vector3(x + 0.35, height, z), 0.22, bark).castShadow = true;
    for (let j = 0; j < 3; j++) {
      const crown = canopy(parent, [2.1, 1.7 + j * 0.2, 1.8], [x + Math.sin(j * 2) * 1.2, height - 0.6 + j * 0.7, z + Math.cos(j * 2)], greens[(i + j) % 4]); crown.castShadow = i % 3 === 0;
    }
    for (let leaf = 0; leaf < 5; leaf++) {
      const fern = ellipsoid(parent, [0.12, 0.68, 0.25], [x + Math.cos(leaf) * 0.4, 0.4, z + Math.sin(leaf) * 0.4], greens[(i + leaf) % 4]); fern.rotation.set(0.5, leaf, 0.65);
    }
    if (forest && i % 3 === 0) { const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), material('#788574')); rock.position.set(x + 1.4, 0.25, z); rock.scale.y = 0.6; parent.add(rock); }
  }
}

/** A directional sky keeps the blue hour gradient visible from every court angle. */
function skyTexture(theme: CourtTheme) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!, gradient = ctx.createLinearGradient(0, 0, 0, 512);
  const stops: [number, string][] = theme === 'beach'
    ? [[0, '#171c4c'], [0.25, '#443773'], [0.41, '#875787'], [0.48, '#d68a99'], [0.505, '#f5ad79'], [0.55, '#896d9e'], [1, '#283b65']]
    : theme === 'forest' ? [[0, '#102f31'], [0.45, '#386255'], [0.55, '#5b7b67'], [1, '#223e32']]
    : [[0, '#366b9d'], [0.45, '#adcbd8'], [0.55, '#d3c6ad'], [1, '#7b8993']];
  stops.forEach(([stop, color]) => gradient.addColorStop(stop, color));
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 512);
  if (theme === 'beach') {
    for (let i = 0; i < 28; i++) {
      const x = i * 157 % 1024, y = 165 + i * 23 % 73;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, 95);
      cloud.addColorStop(0, i % 2 ? '#efb0ac24' : '#463d7028'); cloud.addColorStop(1, '#463d7000');
      ctx.save(); ctx.translate(0, y); ctx.scale(1, 0.13); ctx.translate(0, -y); ctx.fillStyle = cloud; ctx.fillRect(x - 100, y - 100, 200, 200); ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping; return texture;
}

function curvedBranch(parent: THREE.Object3D, points: number[][], radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p as [number, number, number])));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 8, false), mat);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function giantForest(group: THREE.Group) {
  const barkCanvas = document.createElement('canvas'); barkCanvas.width = 128; barkCanvas.height = 256;
  const barkContext = barkCanvas.getContext('2d')!; barkContext.fillStyle = '#b3a38c'; barkContext.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 160; i++) {
    barkContext.strokeStyle = i % 3 ? '#695b454f' : '#e5ceb96b'; barkContext.lineWidth = 1 + i % 3;
    const x = i * 37 % 128, y = i * 71 % 256;
    barkContext.beginPath(); barkContext.moveTo(x, y); barkContext.bezierCurveTo(x + 3, y + 8, x - 2, y + 27, x + 1, y + 54); barkContext.stroke();
  }
  const barkTexture = new THREE.CanvasTexture(barkCanvas); barkTexture.colorSpace = THREE.SRGBColorSpace; barkTexture.wrapS = barkTexture.wrapT = THREE.RepeatWrapping; barkTexture.repeat.set(3, 4); barkTexture.anisotropy = 4;
  const bark = material('#625943', { map: barkTexture, bumpMap: barkTexture, bumpScale: 0.17 }), ridges = material('#665943'), moss = material('#537344');
  const greens = ['#2b5844', '#386b4f', '#487853', '#58865a'].map(c => foliageMaterial(c));
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI * 2 / 16, x = Math.cos(angle) * (32 + i % 3 * 3), z = Math.sin(angle) * (23 + i % 2 * 3);
    const h = 22 + i % 4 * 3, radius = 1.3 + i % 3 * 0.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius, h, 14, 5), bark);
    trunk.position.set(x, h / 2 - 0.2, z); trunk.castShadow = true; trunk.receiveShadow = true; group.add(trunk);
    for (let j = 0; j < 7; j++) {
      const a = j * Math.PI * 2 / 7;
      curvedBranch(group, [[x + Math.cos(a) * radius * 0.55, 11 + j % 3, z + Math.sin(a) * radius * 0.55], [x + Math.cos(a) * radius, 2, z + Math.sin(a) * radius], [x + Math.cos(a) * (radius + 2), 0.55, z + Math.sin(a) * (radius + 2)], [x + Math.cos(a) * (radius + 4), 0.02, z + Math.sin(a) * (radius + 4)]], 0.22 + j % 2 * 0.1, j % 2 ? ridges : bark);
    }
    const inward = new THREE.Vector3(-x, 0, -z).normalize();
    for (let j = 0; j < 4; j++) {
      const a = angle + j * 1.55;
      const endX = x + Math.cos(a) * 8 + inward.x * 4, endZ = z + Math.sin(a) * 7 + inward.z * 4;
      curvedBranch(group, [[x, h * 0.56, z], [x + (endX - x) * 0.5, h * 0.74, z + (endZ - z) * 0.5], [endX, h * 0.82, endZ]], 0.32 + (3 - j) * 0.09, bark);
      for (let k = 0; k < 3; k++) {
        const crown = canopy(group, [5.3 + k, 2.1 + k * 0.4, 4.8], [endX + Math.cos(k * 2.4) * 2, h * 0.84 + k, endZ + Math.sin(k * 2.4) * 2], greens[(i + j + k) % 4]); crown.castShadow = i % 3 === 0;
      }
      if (j % 2 === 0) {
        curvedBranch(group, [[endX, h * 0.78, endZ], [endX + 0.4, h * 0.52, endZ + 0.5], [endX - 0.2, h * 0.36, endZ]], 0.038, moss);
      }
    }
    for (let j = 0; j < 3; j++) ellipsoid(group, [1.7, 0.22, 1], [x + Math.cos(j * 2) * 1.2, 0.12, z + Math.sin(j * 2) * 1.4], moss);
  }
  const stem = material('#d8bd8c'), cap = material('#c78962');
  for (let i = 0; i < 50; i++) {
    const a = i * 2.399, x = Math.cos(a) * (25 + i % 5), z = Math.sin(a) * (16 + i % 4);
    if (Math.abs(x) < 23 && Math.abs(z) < 14) continue;
    const h = 0.2 + i % 3 * 0.08;
    branch(group, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z), 0.055, stem);
    ellipsoid(group, [h * 0.7, h * 0.28, h * 0.7], [x, h, z], cap);
    for (let j = 0; j < 5; j++) {
      const frond = ellipsoid(group, [0.09, 0.7, 0.22], [x + Math.cos(j * 1.3) * 0.45, 0.45, z + Math.sin(j * 1.3) * 0.45], greens[(i + j) % 4]); frond.rotation.set(0.5, j * 1.3, 0.7);
    }
  }
  const positions = new Float32Array(100 * 3);
  for (let i = 0; i < 100; i++) { const a = i * 2.4; positions.set([Math.cos(a) * (23 + i % 8), 0.5 + i % 13 * 0.27, Math.sin(a) * (14 + i % 8)], i * 3); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const motes = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#e1eaae', size: 0.075, transparent: true, opacity: 0.75, depthWrite: false })); group.add(motes);
  return (time: number) => { motes.position.y = Math.sin(time * 0.5) * 0.17; (motes.material as THREE.PointsMaterial).opacity = 0.5 + Math.sin(time * 1.3) * 0.2; };
}

function beachDetails(group: THREE.Group) {
  const wood = material('#66516a'), cream = material('#f1d2b2'), coral = material('#cd888d'), teal = material('#789cac');
  // Raised timber deck and a little surf clubhouse frame the open sea.
  box(group, [15, 0.2, 4.5], [-5, 0.05, -18], wood);
  for (let i = 0; i < 32; i++) box(group, [0.025, 0.015, 4.5], [-12.3 + i * 0.47, 0.16, -18], cream);
  box(group, [4.8, 2.5, 2.5], [-19, 1.2, -19], teal);
  box(group, [5.4, 0.15, 3.3], [-19, 2.52, -19], coral);
  box(group, [3.8, 1.05, 0.03], [-19, 1.5, -17.73], wood);
  box(group, [4.4, 0.12, 0.6], [-19, 0.93, -17.5], cream);
  for (let i = 0; i < 3; i++) {
    const board = ellipsoid(group, [0.33, 1.6, 0.09], [-22.3 + i * 0.63, 1.5, -17.7], i % 2 ? coral : cream); board.rotation.z = -0.15 + i * 0.13;
    box(group, [0.06, 2.35, 0.025], [-22.3 + i * 0.63, 1.5, -17.59], teal).rotation.z = board.rotation.z;
  }
  const bulb = new THREE.MeshStandardMaterial({ color: '#ffe0a2', emissive: '#ffba6d', emissiveIntensity: 2.4 });
  for (const z of [-14.5, 14.5]) {
    for (const x of [-20, 0, 20]) branch(group, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 5.8, z), 0.055, wood);
    for (const x of [-20, 0]) {
      curvedBranch(group, [[x, 5.75, z], [x + 10, 4.5, z], [x + 20, 5.75, z]], 0.018, wood);
      for (let j = 0; j <= 10; j++) {
        const y = 4.5 + 1.25 * ((j - 5) / 5) ** 2;
        branch(group, new THREE.Vector3(x + j * 2, y, z), new THREE.Vector3(x + j * 2, y - 0.18, z), 0.015, wood);
        ellipsoid(group, [0.085, 0.12, 0.085], [x + j * 2, y - 0.25, z], bulb);
      }
    }
    const light = new THREE.PointLight('#ffc18e', 24, 20, 2); light.position.set(0, 4, z); group.add(light);
  }
  const sun = new THREE.Mesh(new THREE.CircleGeometry(3.1, 64), new THREE.MeshBasicMaterial({ color: '#ffd2a0', fog: false }));
  sun.position.set(86, 5, -20); sun.lookAt(0, 3, 0); group.add(sun);
  // Broken streaks catch the last sunlight instead of a flat cyan water slab.
  const shimmer = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#efafae', transparent: true, opacity: 0.38, depthWrite: false }), 150);
  const obj = new THREE.Object3D();
  for (let i = 0; i < 150; i++) {
    const x = 28 + (i * 7.31) % 70;
    obj.position.set(x, -0.135, -20 * x / 86 + Math.sin(i * 13.7) * (1 + (95 - x) * 0.045));
    obj.rotation.set(-Math.PI / 2, 0, 0); obj.scale.set(0.05 + i % 4 * 0.08, 0.45 + i % 7 * 0.21, 1); obj.updateMatrix(); shimmer.setMatrixAt(i, obj.matrix);
  }
  group.add(shimmer);
  return (time: number) => { (shimmer.material as THREE.MeshBasicMaterial).opacity = 0.27 + Math.sin(time * 0.8) * 0.08; shimmer.position.z = Math.sin(time * 0.45) * 0.16; };
}

function urbanDetails(group: THREE.Group) {
  const brick = material('#855a4b'), mortar = material('#ac8871'), metal = material('#344553', { metalness: 0.6 });
  for (const x of [-19, 19]) {
    box(group, [7, 12, 4], [x, 5.6, -24], brick);
    for (let y = 0; y < 12; y++) box(group, [7, 0.025, 0.02], [x, y, -21.98], mortar);
    for (let row = 0; row < 3; row++) {
      const y = 2 + row * 3;
      box(group, [5.5, 0.12, 1.25], [x, y, -21.25], metal);
      for (let j = 0; j <= 12; j++) branch(group, new THREE.Vector3(x - 2.6 + j * 0.43, y, -20.7), new THREE.Vector3(x - 2.6 + j * 0.43, y + 0.85, -20.7), 0.02, metal);
      branch(group, new THREE.Vector3(x - 2.6, y + 0.85, -20.7), new THREE.Vector3(x + 2.6, y + 0.85, -20.7), 0.035, metal);
      for (let j = 0; j < 7; j++) box(group, [0.75, 0.06, 0.18], [x + 1.7, y + j * 0.42, -21.1 + j * 0.07], metal);
    }
    box(group, [7.6, 0.32, 4.6], [x, 11.65, -24], mortar);
  }
  for (const x of [-17, 17]) {
    const speaker = box(group, [0.75, 1.3, 0.6], [x, 0.8, 12.4], metal);
    for (const y of [0.57, 1.08]) ellipsoid(group, [0.24, 0.24, 0.055], [speaker.position.x, y, 12.06], material('#171f29'));
  }
}

function arenaDetails(group: THREE.Group) {
  const steel = material('#313b4d', { metalness: 0.7, roughness: 0.35 }), gold = material('#b99a57', { metalness: 0.7, roughness: 0.28 });
  const seat = material('#514164'), seatGold = material('#9b7950');
  for (const side of [-1, 1]) {
    for (let row = 0; row < 5; row++) for (let i = 0; i < 42; i++) {
      const x = -21 + i * 1.02, y = row * 0.78, z = side * (12.8 + row * 1.35);
      box(group, [0.68, 0.56, 0.12], [x, y + 0.78, z + side * 0.17], i % 7 ? seat : seatGold);
      box(group, [0.67, 0.12, 0.55], [x, y + 0.51, z], i % 7 ? seat : seatGold);
    }
    for (const x of [-22, 0, 22]) branch(group, new THREE.Vector3(x, 0.6, side * 12.2), new THREE.Vector3(x, 4.1, side * 19.3), 0.045, gold);
    for (const y of [5.5, 8]) box(group, [57, 0.12, 0.15], [0, y, side * 21.7], gold);
    for (let i = 0; i < 9; i++) box(group, [0.07, 0.55, 0.04], [-24 + i * 6, 6.7, side * 21.69], material('#edc780', { emissive: '#edc780', emissiveIntensity: 0.8 }));
  }
  for (const x of [-22, -11, 0, 11, 22]) {
    for (const y of [14, 15]) branch(group, new THREE.Vector3(x, y, -21), new THREE.Vector3(x, y, 21), 0.09, steel);
    for (let z = -21; z < 21; z += 3) branch(group, new THREE.Vector3(x, 14, z), new THREE.Vector3(x, 15, z + 3), 0.05, steel);
  }
  for (const x of [-2, 2]) branch(group, new THREE.Vector3(x, 11.3, 0), new THREE.Vector3(x, 15.8, 0), 0.045, steel);
}

/** Merge static scenery by material; animated water, particles and fan batches stay independent. */
function batchScenery(group: THREE.Group, water?: THREE.Mesh) {
  const batches = new Map<string, THREE.Mesh[]>(); group.updateMatrixWorld(true);
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object === water || Array.isArray(object.material) || object.material.transparent) return;
    const key = `${object.material.uuid}/${object.castShadow}/${object.receiveShadow}/${!!object.geometry.index}`;
    const batch = batches.get(key) ?? []; batch.push(object); batches.set(key, batch);
  });
  const inverse = group.matrixWorld.clone().invert();
  batches.forEach(meshes => {
    if (meshes.length < 2) return;
    const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
    const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
    if (!geometry) return;
    const merged = new THREE.Mesh(geometry, meshes[0].material); merged.castShadow = meshes[0].castShadow; merged.receiveShadow = meshes[0].receiveShadow;
    meshes.forEach(mesh => { mesh.removeFromParent(); mesh.geometry.dispose(); }); group.add(merged);
  });
}

export function createCourtWorlds(scene: THREE.Scene, street: THREE.Group) {
  const worlds = new Map<CourtTheme, { group: THREE.Group; update: (time: number, cheering: number) => void }>();
  let active: CourtTheme = 'rucker';
  const skies = new Map<CourtTheme, THREE.Texture>();
  const build = (theme: CourtTheme) => {
    const group = new THREE.Group(); group.name = `court-${theme}`; scene.add(group);
    let water: THREE.Mesh | undefined;
    let updateScenery = (_time: number) => {};
    const seats: THREE.Vector3[] = [];
    const metal = material('#273745', { metalness: 0.55, roughness: 0.4 });
    if (theme === 'rucker') {
      plants(group, false, 13);
      urbanDetails(group);
      sign(group, 'RUCKER PARK', 'HARLEM  /  NEW YORK STREETBALL', [0, 5.7, -13.48], 9, 2.2, '#f3ac62');
      for (const side of [-1, 1]) for (let row = 0; row < 2; row++) {
        box(group, [29, 0.3, 0.85], [1, row * 0.48 + 0.26, side * (12 + row * 1.05)], metal);
        for (let i = 0; i < 22; i++) seats.push(new THREE.Vector3(-13 + i * 1.3, row * 0.48, side * (12 + row * 1.05)));
      }
    } else if (theme === 'beach') {
      box(group, [230, 0.25, 200], [0, -0.4, 0], material('#b9a3b0'));
      water = new THREE.Mesh(new THREE.PlaneGeometry(150, 240, 1, 1), material('#354f83', { metalness: 0.48, roughness: 0.27, emissive: '#514f8c', emissiveIntensity: 0.14 })); water.rotation.x = -Math.PI / 2; water.position.set(100, -0.19, 0); group.add(water);
      const foam = material('#c5b8d9', { transparent: true, opacity: 0.3 });
      for (let i = 0; i < 10; i++) box(group, [0.15 + i * 0.07, 0.025, 180], [26 + i * 3.1, -0.15, 0], foam);
      updateScenery = beachDetails(group);
      const bark = material('#6c566b'), leaf = material('#3a5c68', { side: THREE.DoubleSide });
      for (let i = 0; i < 12; i++) {
        const x = -27 + i * 5, z = i % 2 ? -16 : 16;
        for (let j = 0; j < 7; j++) branch(group, new THREE.Vector3(x + j * j * 0.018, j * 0.8, z), new THREE.Vector3(x + (j + 1) ** 2 * 0.018, (j + 1) * 0.8, z), 0.18, bark);
        for (let j = 0; j < 8; j++) {
          palmFrond(group, x + 0.88, z, j * Math.PI / 4 + i * 0.35, leaf);
        }
      }
      for (let i = 0; i < 6; i++) {
        const x = -16 + i * 6;
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.65, 10), material(i % 2 ? '#f38167' : '#f0d369')); canopy.position.set(x, 2.7, -15); group.add(canopy);
        branch(group, new THREE.Vector3(x, 0, -15), new THREE.Vector3(x, 2.8, -15), 0.04, metal);
        box(group, [1.8, 0.18, 0.7], [x, 0.42, -14.6], material('#f6f1dc'));
        for (let j = 0; j < 4; j++) seats.push(new THREE.Vector3(x - 1.3 + j * 0.8, 0, -13.7));
      }
      sign(group, 'BLUE HOUR', 'COASTAL HOOPS  /  AFTER THE SUN', [0, 3.5, -18], 9, 2.3, '#e6b19c');
      const boat = box(group, [4, 0.5, 1.2], [49, 0, -16], material('#f5ecdd')); boat.rotation.y = 0.35;
      branch(group, new THREE.Vector3(49, 0, -16), new THREE.Vector3(49, 6, -16), 0.045, metal);
      const sail = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 3), material('#fff3d0')); sail.position.set(49.7, 3.4, -16); sail.scale.z = 0.04; group.add(sail);
    } else if (theme === 'forest') {
      box(group, [180, 0.2, 160], [0, -0.35, 0], material('#334e3d'));
      plants(group, true, 24);
      updateScenery = giantForest(group);
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
      arenaDetails(group);
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
    batchScenery(group, water);
    const updateCrowd = crowd(group, seats, theme);
    const world = { group, update: (time: number, cheering: number) => { updateCrowd(time, cheering); updateScenery(time); if (water) water.position.y = -0.19 + Math.sin(time * 0.65) * 0.035; } };
    worlds.set(theme, world); return world;
  };
  return {
    select(theme: CourtTheme) {
      active = theme; if (!worlds.has(theme)) build(theme);
      street.visible = theme === 'rucker'; worlds.forEach((world, key) => { world.group.visible = key === theme; });
      if (theme !== 'hall' && !skies.has(theme)) skies.set(theme, skyTexture(theme));
      scene.background = theme === 'hall' ? new THREE.Color('#101622') : skies.get(theme)!;
      scene.fog = new THREE.Fog(theme === 'forest' ? '#3c6355' : theme === 'hall' ? '#131a29' : theme === 'beach' ? '#ab91b0' : '#b9c8cd', theme === 'forest' ? 30 : 55, theme === 'forest' ? 100 : 160);
    },
    update(time: number, cheering: number) { worlds.get(active)?.update(time, cheering); },
    dispose() { skies.forEach(texture => texture.dispose()); skies.clear(); },
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
    ellipsoid(head, [0.048, 0.059, 0.028], [side * 0.098, 0.1, 0.184], cream);
    ellipsoid(head, [0.03, 0.041, 0.024], [side * 0.095, 0.095, 0.208], dark);
    ellipsoid(head, [0.01, 0.013, 0.008], [side * 0.095 - 0.009, 0.112, 0.23], material('#ffffff'));
    ellipsoid(head, [0.083, 0.057, 0.06], [side * 0.15, -0.035, 0.137], cream);
    const brow = ellipsoid(head, [0.051, 0.014, 0.018], [side * 0.101, 0.168, 0.177], fur); brow.rotation.z = side * 0.12;
    ellipsoid(head, [0.041, species === 2 ? 0.18 : 0.052, 0.019], [side * 0.15, species === 2 ? 0.37 : 0.27, 0.063], material('#d69d92'));
    if (species === 1) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.27, 8), fur); ear.position.set(side * 0.155, 0.28, 0); head.add(ear);
    } else ellipsoid(head, [0.08, species === 2 ? 0.26 : 0.09, 0.065], [side * 0.15, species === 2 ? 0.36 : 0.25, 0], fur);
  }
  // Imported head-bone axes vary between mocap clips. Follow its position, but
  // orient in the athlete visual frame so the muzzle always faces the chest's +Z.
  const headBone = rig.getObjectByName('Head');
  head.name = 'animal-head'; group.add(head); parts.push(head);
  const worldPosition = new THREE.Vector3(), parentRotation = new THREE.Quaternion(), visualRotation = new THREE.Quaternion();
  const updateHead = () => {
    if (!headBone) return;
    group.updateWorldMatrix(true, true);
    head.position.copy(group.worldToLocal(headBone.getWorldPosition(worldPosition)));
    head.position.y += 0.08;
    group.getWorldQuaternion(parentRotation);
    (rig.parent ?? group).getWorldQuaternion(visualRotation);
    head.quaternion.copy(parentRotation.invert().multiply(visualRotation));
  };
  updateHead();
  head.traverse(part => { if (part instanceof THREE.Mesh) { part.castShadow = true; part.receiveShadow = true; } });
  const tail = new THREE.Group(); ellipsoid(tail, [0.1, species === 1 ? 0.36 : 0.12, 0.13], [0, -0.07, 0], species === 2 ? cream : fur); tail.rotation.x = -0.65;
  attach(tail, 'Hips', new THREE.Vector3(0, -0.02, -0.22));
  for (const side of ['L', 'R']) { const paw = new THREE.Group(); ellipsoid(paw, [0.065, 0.055, 0.09], [0, 0, 0], fur); attach(paw, `Hand${side}`, new THREE.Vector3()); }
  const humanHead = rig.getObjectByName('Casual_Head');
  const headband = rig.getObjectByName('athlete-headband');
  return { setVisible(on: boolean) { parts.forEach(part => { part.visible = on; }); if (humanHead) humanHead.visible = !on; if (headband) headband.visible = !on; }, update(time: number) { updateHead(); tail.rotation.z = Math.sin(time * 3 + index) * 0.2; } };
}
