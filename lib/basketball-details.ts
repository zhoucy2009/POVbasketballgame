import * as THREE from 'three';

function labelTexture(draw: (context: CanvasRenderingContext2D) => void, width = 1024, height = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Small shared meshes and painted surfaces keep the court detailed without remote assets. */
export function addCourtDetails(scene: THREE.Scene, fabric: THREE.Texture) {
  const steel = new THREE.MeshStandardMaterial({ color: '#263e4c', metalness: 0.72, roughness: 0.38 });
  const wood = new THREE.MeshStandardMaterial({ color: '#855334', roughness: 0.8 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#bac1b6', roughness: 0.96 });
  const box = (size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    return mesh;
  };
  const rod = (start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material) => {
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true; scene.add(mesh);
  };

  const muralTexture = labelTexture(ctx => {
    ctx.fillStyle = '#203f4a'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#2b6874'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(710, 0); ctx.lineTo(350, 512); ctx.lineTo(0, 512); ctx.fill();
    ctx.strokeStyle = '#49919a'; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.arc(130, 320, 80 + i * 38, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#ffbf75'; ctx.font = '900 126px Arial'; ctx.fillText('OWN THE', 320, 200);
    ctx.fillStyle = '#fff3d8'; ctx.fillText('COURT.', 320, 337);
    ctx.font = '600 23px Arial'; ctx.fillText('UNMATCHED  /  EVERY SHOT IS YOURS', 329, 408);
    // Fine weathering is deterministic and stays in one texture/draw call.
    ctx.fillStyle = '#ffffff0b';
    for (let i = 0; i < 1600; i++) ctx.fillRect((i * 137) % 1024, (i * 71) % 512, 2, 1);
  });
  const muralMaterial = new THREE.MeshStandardMaterial({ map: muralTexture, roughness: 0.96 });
  for (const sign of [-1, 1]) {
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 4.8), muralMaterial);
    mural.position.set(sign * 22.84, 3.05, 0); mural.rotation.y = -sign * Math.PI / 2; scene.add(mural);
    box([0.12, 0.16, 16], [sign * 22.76, 0.57, 0], steel);
    box([0.12, 0.16, 16], [sign * 22.76, 5.53, 0], steel);

    // Backboard perimeter, support struts, rim bracket, and base fasteners.
    for (const y of [2.92, 4.18]) box([0.15, 0.045, 2.15], [sign * 19.2, y, 0], steel);
    for (const z of [-1.065, 1.065]) box([0.15, 1.28, 0.045], [sign * 19.2, 3.55, z], steel);
    rod(new THREE.Vector3(sign * 20.3, 2.75, 0), new THREE.Vector3(sign * 19.3, 3.8, 0), 0.045, steel);
    box([0.25, 0.08, 0.2], [sign * 19.08, 3.05, 0], steel);
    box([0.8, 0.09, 0.8], [sign * 20.3, 0.055, 0], steel);
    for (const dx of [-0.28, 0.28]) for (const z of [-0.28, 0.28]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 6), concrete);
      bolt.position.set(sign * 20.3 + dx, 0.12, z); scene.add(bolt);
    }
    // Light fixtures sit outside playable boundaries.
    for (const z of [-11.8, 11.8]) {
      rod(new THREE.Vector3(sign * 21.9, 0, z), new THREE.Vector3(sign * 21.9, 8.4, z), 0.075, steel);
      box([0.7, 0.18, 0.45], [sign * 21.9, 8.4, z], steel);
      const lamp = new THREE.MeshStandardMaterial({ color: '#fff0c6', emissive: '#ffe1a1', emissiveIntensity: 0.7 });
      box([0.6, 0.03, 0.36], [sign * 21.9, 8.29, z], lamp);
    }
  }

  const signMap = labelTexture(ctx => {
    ctx.fillStyle = '#163441'; ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = '#ffcc83'; ctx.lineWidth = 12; ctx.strokeRect(20, 20, 984, 472);
    ctx.fillStyle = '#ffcc83'; ctx.font = '700 48px Arial'; ctx.textAlign = 'center'; ctx.fillText('NEIGHBORHOOD COURT', 512, 130);
    ctx.fillStyle = '#fff6df'; ctx.font = '900 145px Arial'; ctx.fillText('PLAY DAILY', 512, 302);
    ctx.font = '500 32px Arial'; ctx.fillText('RESPECT THE GAME   /   EST. 2026', 512, 403);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshStandardMaterial({ map: signMap, roughness: 0.82 }));
  sign.position.set(5.9, 3.35, -13.65); scene.add(sign);

  // Diamond wire and horizontal rails, all wire segments in one geometry.
  const wirePoints: THREE.Vector3[] = [];
  for (let x = -23.5; x < 23.5; x += 0.42) for (let y = 5.5; y < 7.8; y += 0.6) {
    wirePoints.push(new THREE.Vector3(x, y, -13.58), new THREE.Vector3(x + 0.21, y + 0.3, -13.58),
      new THREE.Vector3(x + 0.21, y + 0.3, -13.58), new THREE.Vector3(x, y + 0.6, -13.58));
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePoints), new THREE.LineBasicMaterial({ color: '#324f5b', transparent: true, opacity: 0.48 })));
  for (const y of [5.5, 7.9]) rod(new THREE.Vector3(-23.5, y, -13.58), new THREE.Vector3(23.5, y, -13.58), 0.035, steel);

  // Court furniture: slatted seating, backrests, equipment and individual bottles.
  for (const x of [-8, -2]) {
    for (const dx of [-1, 1]) {
      box([0.12, 0.54, 0.64], [x + dx, 0.27, 12.4], steel);
      box([0.1, 1.15, 0.12], [x + dx, 0.59, 12.7], steel);
    }
    for (let slat = 0; slat < 4; slat++) box([2.8, 0.07, 0.14], [x, 0.56, 12.13 + slat * 0.17], wood);
    for (let slat = 0; slat < 3; slat++) box([2.8, 0.14, 0.07], [x, 0.8 + slat * 0.18, 12.7], wood);
  }
  for (const x of [-7.4, -2.2, -1.8]) {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.3, 12), new THREE.MeshStandardMaterial({ color: '#4ca4aa', roughness: 0.25, metalness: 0.15 }));
    bottle.position.set(x, 0.75, 12.3); scene.add(bottle);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.05, 10), concrete);
    cap.position.set(x, 0.925, 12.3); scene.add(cap);
  }
  box([0.64, 0.3, 0.34], [-8.6, 0.76, 12.4], new THREE.MeshStandardMaterial({ color: '#e8c79f', roughness: 0.95, bumpMap: fabric, bumpScale: 0.004 }));

  const leaves = new THREE.MeshStandardMaterial({ color: '#62855f', roughness: 1 });
  for (const x of [-18, -12, 5, 12, 19]) {
    box([1.4, 0.55, 1.35], [x, 0.23, 13.1], concrete);
    rod(new THREE.Vector3(x, 0.4, 13.1), new THREE.Vector3(x + 0.13, 4.5, 13.1), 0.13, wood);
    for (let i = 0; i < 5; i++) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), leaves);
      crown.position.set(x + Math.cos(i * 2.4) * 0.6, 4.1 + i * 0.35, 13.1 + Math.sin(i * 2.4) * 0.5);
      crown.scale.set(1, 1.2, 0.9); crown.castShadow = true; scene.add(crown);
    }
  }

  // Instancing adds skyline windows with a single draw call.
  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.53, 0.88, 0.04), new THREE.MeshStandardMaterial({ color: '#bddbe0', metalness: 0.25, roughness: 0.4 }), 7 * 4 * 5);
  const matrix = new THREE.Matrix4(); let instance = 0;
  for (let x = -18; x <= 18; x += 6) for (let column = 0; column < 4; column++) for (let row = 0; row < 5; row++) {
    matrix.makeTranslation(x - 1.5 + column, 3 + row * 1.45, -18.46 - Math.abs(x) * 0.08);
    windows.setMatrixAt(instance++, matrix);
  }
  scene.add(windows);
}

/** Attach accessories to the animated bones so details bend and travel with the athlete. */
export function addAthleteDetails(group: THREE.Group, skeleton: THREE.Skeleton, color: string, number: number, fabric: THREE.Texture, firstPerson: boolean) {
  if (firstPerson) return;
  const ivory = new THREE.MeshStandardMaterial({ color: '#eee9dc', roughness: 0.86, bumpMap: fabric, bumpScale: 0.002 });
  const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.38), roughness: 0.86, bumpMap: fabric, bumpScale: 0.003 });
  const attach = (mesh: THREE.Mesh, bone: THREE.Bone | undefined) => {
    if (!bone) { mesh.geometry.dispose(); return; }
    group.add(mesh); group.updateMatrixWorld(true); bone.attach(mesh);
    mesh.castShadow = true; mesh.receiveShadow = true;
  };
  for (const side of ['L', 'R']) {
    const hand = skeleton.getBoneByName(`Hand${side}`);
    if (hand?.parent) {
      const wrist = group.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
      const elbow = group.worldToLocal(hand.parent.getWorldPosition(new THREE.Vector3()));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.075, 16), number % 2 ? ivory : trim);
      band.position.copy(wrist).lerp(elbow, 0.16);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), elbow.sub(wrist).normalize());
      attach(band, hand);
    }
    const foot = skeleton.getBoneByName(`Foot${side}`);
    if (foot) {
      const p = group.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.16, 14), ivory);
      sock.position.copy(p).add(new THREE.Vector3(0, 0.085, 0)); attach(sock, foot);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.27), ivory);
      sole.position.copy(p).add(new THREE.Vector3(0, -0.025, 0.055)); attach(sole, foot);
      for (let lace = 0; lace < 3; lace++) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.012, 0.012), ivory);
        mesh.position.copy(p).add(new THREE.Vector3(0, 0.04, 0.025 + lace * 0.028)); attach(mesh, foot);
      }
    }
  }
  const chest = skeleton.getBoneByName('Chest') ?? skeleton.getBoneByName('Spine2') ?? skeleton.getBoneByName('Spine');
  if (chest) {
    const texture = labelTexture(ctx => {
      ctx.fillStyle = '#fff4dd'; ctx.textAlign = 'center'; ctx.font = '900 43px Arial'; ctx.fillText('UNMATCHED', 256, 94);
      ctx.font = '900 152px Arial'; ctx.fillText(String(number), 256, 265);
      ctx.fillStyle = '#ffda9d'; ctx.fillRect(130, 295, 252, 8);
    }, 512, 384);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.26), new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    const p = group.worldToLocal(chest.getWorldPosition(new THREE.Vector3()));
    front.position.set(p.x, p.y - 0.06, p.z + 0.15); attach(front, chest);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.3), front.material);
    back.position.set(p.x, p.y - 0.06, p.z - 0.13); back.rotation.y = Math.PI; attach(back, chest);
  }
}
