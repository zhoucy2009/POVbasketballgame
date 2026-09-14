import * as THREE from 'three';

export const GRAVITY = 9.8;
export const FIXED_STEP = 1 / 120;

/** The reticle is the launch direction; neither hoop position nor luck enters this calculation. */
export function aimedShotVelocity(yaw: number, pitch: number, power: number) {
  const speed = 4.5 + THREE.MathUtils.clamp(power, 0, 1) * 14;
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(speed);
}

export function flightPoint(origin: THREE.Vector3, velocity: THREE.Vector3, time: number, result = new THREE.Vector3()) {
  result.copy(origin).addScaledVector(velocity, time);
  result.y -= 0.5 * GRAVITY * time * time;
  return result;
}

export function flightTimeToFloor(height: number, verticalSpeed: number, radius: number) {
  return (verticalSpeed + Math.sqrt(verticalSpeed * verticalSpeed + 2 * GRAVITY * Math.max(0, height - radius))) / GRAVITY;
}

/** Exact constant-acceleration flight: independent of rendering frequency. */
export function advanceFlight(position: THREE.Vector3, velocity: THREE.Vector3, dt: number) {
  position.addScaledVector(velocity, dt);
  position.y -= 0.5 * GRAVITY * dt * dt;
  velocity.y -= GRAVITY * dt;
}

/** Solid sphere contact impulse, including tangential grip and angular momentum. */
export function contactImpulse(velocity: THREE.Vector3, spin: THREE.Vector3, normal: THREE.Vector3, radius: number, restitution: number, friction = 0.22) {
  const incoming = velocity.dot(normal);
  if (incoming >= 0) return;
  const normalImpulse = -(1 + restitution) * incoming;
  velocity.addScaledVector(normal, normalImpulse);
  const arm = normal.clone().multiplyScalar(-radius);
  const slip = spin.clone().cross(arm).add(velocity);
  slip.addScaledVector(normal, -slip.dot(normal));
  const speed = slip.length();
  if (speed < 1e-8) return;
  const impulse = slip.multiplyScalar(-Math.min(speed / 3.5, friction * normalImpulse) / speed);
  velocity.add(impulse);
  spin.add(arm.cross(impulse).multiplyScalar(2.5 / (radius * radius)));
}

export function resolveFloor(position: THREE.Vector3, velocity: THREE.Vector3, spin: THREE.Vector3, radius: number, dt: number) {
  if (position.y > radius) return false;
  position.y = radius;
  contactImpulse(velocity, spin, new THREE.Vector3(0, 1, 0), radius, Math.abs(velocity.y) < 0.65 ? 0 : 0.76, 0.38);
  if (Math.abs(velocity.y) < 0.16) velocity.y = 0;
  if (velocity.y === 0) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const factor = speed > 0 ? Math.max(0, speed - 0.34 * dt) / speed : 0;
    velocity.x *= factor; velocity.z *= factor;
    spin.set(velocity.z / radius, spin.y * Math.exp(-2 * dt), -velocity.x / radius);
  }
  return true;
}

export function acceleratePlanar(velocity: THREE.Vector3, target: THREE.Vector3, dt: number, acceleration = 24) {
  const delta = target.clone().sub(velocity).setY(0);
  const distance = delta.length();
  if (distance > 0) velocity.addScaledVector(delta, Math.min(1, acceleration * dt / distance));
}
