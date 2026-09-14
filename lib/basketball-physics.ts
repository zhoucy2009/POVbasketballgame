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

export type JumpShotStyle = 'normal' | 'step-left' | 'step-right' | 'fade';
export const PLAYER_GRAVITY = 15.5;
export const shotTiming = (style: JumpShotStyle) => ({
  delay: style === 'fade' ? 0.35 : style === 'normal' ? 0.32 : 0.33,
  jumpSpeed: style === 'fade' ? 5.85 : style === 'normal' ? 5.15 : 5.45,
  airDistance: style === 'fade' ? 1.28 : style === 'normal' ? 0 : 0.92,
  airDuration: style === 'fade' ? 0.62 : 0.54,
});

/** A world-space release pocket, evaluated at take-off + release delay, never at current jump height. */
export function projectedShotOrigin(ground: THREE.Vector3, yaw: number, style: JumpShotStyle, stepDirection = new THREE.Vector3()) {
  const timing = shotTiming(style);
  const releaseHeight = 2.05 + timing.jumpSpeed * timing.delay - 0.5 * PLAYER_GRAVITY * timing.delay ** 2;
  const progress = 1 - (1 - timing.delay / timing.airDuration) ** 3;
  return ground.clone().setY(releaseHeight)
    .addScaledVector(stepDirection, timing.airDistance * progress)
    .add(new THREE.Vector3(Math.sin(yaw) * 0.56 + Math.cos(yaw) * 0.12, 0, -Math.cos(yaw) * 0.56 + Math.sin(yaw) * 0.12));
}

/** Shared swept-sphere backboard contact for live play and bank-shot previews. */
export function backboardContact(position: THREE.Vector3, velocity: THREE.Vector3, spin: THREE.Vector3, previous: THREE.Vector3, radius = 0.125) {
  for (const sign of [-1, 1]) {
    const planeX = sign * 19.2;
    const travel = position.x - previous.x;
    const side = Math.sign(previous.x - planeX) || -Math.sign(travel) || -sign;
    const surface = planeX + side * (radius + 0.061);
    const amount = Math.abs(travel) > 1e-8 ? (surface - previous.x) / travel : -1;
    if (amount >= 0 && amount <= 1 && travel * side < 0) {
      const y = THREE.MathUtils.lerp(previous.y, position.y, amount);
      const z = THREE.MathUtils.lerp(previous.z, position.z, amount);
      if (y >= 2.925 - radius && y <= 4.175 + radius && Math.abs(z) <= 1.05 + radius) {
        position.set(surface, y, z);
        contactImpulse(velocity, spin, new THREE.Vector3(side, 0, 0), radius, 0.72);
        return true;
      }
    }
    if (Math.abs(position.x - planeX) < radius + 0.061 && position.y >= 2.925 - radius && position.y <= 4.175 + radius && Math.abs(position.z) <= 1.05 + radius) {
      const normal = new THREE.Vector3(Math.sign(position.x - planeX) || side, 0, 0);
      position.x = planeX + normal.x * (radius + 0.061);
      contactImpulse(velocity, spin, normal, radius, 0.72);
      return true;
    }
  }
  return false;
}

export function rimContact(position: THREE.Vector3, velocity: THREE.Vector3, spin: THREE.Vector3, previous: THREE.Vector3, radius = 0.125) {
  if (Math.abs(position.y - 3.05) > 0.5 || Math.abs(Math.abs(position.x) - 18.7) > 1.1 || Math.abs(position.z) > 1.1) return false;
  for (const rimX of [-18.7, 18.7]) for (let sample = 1; sample <= 5; sample++) {
    const candidate = previous.clone().lerp(position, sample / 5);
    const radial = new THREE.Vector3(candidate.x - rimX, 0, candidate.z);
    if (radial.lengthSq() < 1e-6) radial.set(0, 0, 1); else radial.normalize();
    const nearest = new THREE.Vector3(rimX, 3.05, 0).addScaledVector(radial, 0.48);
    const separation = candidate.sub(nearest);
    const distance = separation.length();
    if (distance >= radius + 0.055) continue;
    const normal = distance > 0.001 ? separation.divideScalar(distance) : new THREE.Vector3(0, 1, 0);
    position.copy(nearest).addScaledVector(normal, radius + 0.055);
    contactImpulse(velocity, spin, normal, radius, 0.68);
    return true;
  }
  return false;
}

export type ShotForecast = { points: THREE.Vector3[]; banked: boolean; made: boolean; miss: number };
/** Predict the full arc including board/rim rebounds, using the live game's timestep and impulses. */
export function forecastShot(origin: THREE.Vector3, yaw: number, pitch: number, power: number, rimX = 18.7, collect = true): ShotForecast {
  const position = origin.clone(), velocity = aimedShotVelocity(yaw, pitch, power);
  const spin = new THREE.Vector3(velocity.z, 0, -velocity.x).normalize().multiplyScalar(12);
  const previous = new THREE.Vector3();
  const result: ShotForecast = { points: collect ? [origin.clone()] : [], banked: false, made: false, miss: Infinity };
  for (let step = 0; step < 600; step++) {
    previous.copy(position); advanceFlight(position, velocity, FIXED_STEP);
    const bank = backboardContact(position, velocity, spin, previous);
    result.banked ||= bank;
    if (previous.y >= 3.05 && position.y < 3.05) {
      const t = (previous.y - 3.05) / (previous.y - position.y);
      result.miss = Math.min(result.miss, Math.hypot(THREE.MathUtils.lerp(previous.x, position.x, t) - rimX, THREE.MathUtils.lerp(previous.z, position.z, t)));
      if (result.miss <= 0.34) {
        result.made = true;
        if (collect) result.points.push(previous.clone().lerp(position, t).setY(3.05 - 0.125 * 0.7));
        break;
      }
    }
    const rim = rimContact(position, velocity, spin, previous);
    if (collect && (step % 4 === 0 || bank || rim)) result.points.push(position.clone());
    if (position.y <= 0.125 || Math.abs(position.x) >= 20.875 || Math.abs(position.z) >= 11.375) {
      if (collect) result.points.push(position.clone().setY(Math.max(0.07, position.y)));
      break;
    }
  }
  return result;
}

export type GreenWindow = { low: number; high: number; banked: boolean };
export function findGreenWindow(origin: THREE.Vector3, yaw: number, pitch: number, rimX = 18.7): GreenWindow | null {
  let best: GreenWindow | null = null, current: GreenWindow | null = null;
  for (let i = 5; i <= 100; i++) {
    const result = forecastShot(origin, yaw, pitch, i / 100, rimX, false);
    if (result.made) {
      if (!current) current = { low: i / 100, high: i / 100, banked: result.banked };
      current.high = i / 100;
      if (!best || current.high - current.low > best.high - best.low) best = { ...current };
    } else current = null;
  }
  if (best) {
    // Refine both edges so a single successful sample still yields a usable timing window.
    let outside = Math.max(0, best.low - 0.01), inside = best.low;
    for (let i = 0; i < 6; i++) {
      const middle = (outside + inside) / 2;
      if (forecastShot(origin, yaw, pitch, middle, rimX, false).made) inside = middle; else outside = middle;
    }
    best.low = inside;
    outside = Math.min(1, best.high + 0.01); inside = best.high;
    for (let i = 0; i < 6; i++) {
      const middle = (outside + inside) / 2;
      if (forecastShot(origin, yaw, pitch, middle, rimX, false).made) inside = middle; else outside = middle;
    }
    best.high = inside;
  }
  return best;
}


export type AssistedGreenWindow = GreenWindow & { targetLow: number; targetHigh: number; pressure: number };
/** Broaden timing tolerance; pressure removes the extra help without changing aim. */
export function widenGreenWindow(base: GreenWindow | null, pressure = 0): AssistedGreenWindow | null {
  if (!base) return null;
  const contest = THREE.MathUtils.clamp(pressure, 0, 1);
  const naturalWidth = base.high - base.low;
  const openWidth = Math.max(0.18, naturalWidth * 3);
  const width = naturalWidth + (openWidth - naturalWidth) * (1 - contest) ** 1.3;
  const center = (base.low + base.high) / 2;
  return { ...base, low: Math.max(0, center - width / 2), high: Math.min(1, center + width / 2),
    targetLow: base.low, targetHigh: base.high, pressure: contest };
}

/** Continuous, monotonic timing assistance, shared by the preview and actual release. */
export function assistedShotPower(power: number, window: AssistedGreenWindow | null) {
  const input = THREE.MathUtils.clamp(power, 0, 1);
  if (!window) return input;
  const { low, high, targetLow, targetHigh } = window;
  if (input < low) return targetLow * input / low;
  if (input > high) return targetHigh + (1 - targetHigh) * (input - high) / (1 - high);
  return THREE.MathUtils.lerp(targetLow, targetHigh, (input - low) / Math.max(1e-8, high - low));
}


export const BACKCOURT_MAKE_CAP = 0.08;
export function isBackcourtShot(shooterX: number, rimX: number) {
  return shooterX * Math.sign(rimX) <= 0;
}
/** A failed heave loses launch energy, rather than curving toward or denying a real basket. */
export function applyShotRangeLimit(velocity: THREE.Vector3, shooterX: number, rimX: number, roll: number) {
  if (isBackcourtShot(shooterX, rimX) && roll >= BACKCOURT_MAKE_CAP) velocity.clampLength(0, 9);
  return velocity;
}
