import * as THREE from 'three';

/** Close locomotion loops over a short tail so the last pose meets the first. */
export function closeMotionLoop(clip: THREE.AnimationClip, blendDuration = 0.16) {
  const window = Math.min(blendDuration, clip.duration * 0.15);
  if (window <= 0) return clip;
  for (const track of clip.tracks) {
    const stride = track.getValueSize();
    if (track.times.length < 2 || !/\.(quaternion|position|scale)$/.test(track.name)) continue;
    const target = Array.from(track.values.slice(0, stride));
    for (let frame = 0; frame < track.times.length; frame++) {
      const amount = THREE.MathUtils.clamp((track.times[frame] - (clip.duration - window)) / window, 0, 1);
      if (amount === 0) continue;
      const weight = amount * amount * (3 - 2 * amount);
      const offset = frame * stride;
      if (track.name.endsWith('.quaternion')) {
        const pose = new THREE.Quaternion().fromArray(track.values, offset);
        pose.slerp(new THREE.Quaternion().fromArray(target), weight).normalize().toArray(track.values, offset);
      } else {
        for (let axis = 0; axis < stride; axis++) track.values[offset + axis] += (target[axis] - track.values[offset + axis]) * weight;
      }
    }
  }
  return clip;
}

/** Size the evaluated skin, since imported bind-pose bounds can include stale geometry. */
export function fitAnimatedRig(model: THREE.Group, idleClip: THREE.AnimationClip, height: number) {
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(idleClip).play();
  mixer.update(0.1);
  model.updateMatrixWorld(true);
  model.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.computeBoundingBox(); });
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = height / Math.max(0.01, bounds.max.y - bounds.min.y);
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  model.updateMatrixWorld(true);
  return mixer;
}
