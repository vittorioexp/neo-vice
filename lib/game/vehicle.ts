import { VEHICLE_DEFS, type VehicleKind } from './config';
import { angleDelta, circleRectPush, clamp, pick, type Rng, type Vec } from './math';
import type { Collider, Vehicle, World } from './types';

let nextVehicleId = 1;

export function resetVehicleIds(): void {
  nextVehicleId = 1;
}

export function createVehicle(
  kind: VehicleKind,
  pos: Vec,
  angle: number,
  rng: Rng,
  opts: { driver?: Vehicle['driver']; color?: string; locked?: boolean } = {},
): Vehicle {
  const def = VEHICLE_DEFS[kind];
  return {
    id: nextVehicleId++,
    kind,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    angle,
    color: opts.color ?? pick(rng, def.colors),
    w: def.w,
    h: def.h,
    radius: def.h * 0.5 + 3,
    health: def.health,
    maxHealth: def.health,
    throttle: 0,
    brakeInput: 0,
    steer: 0,
    handbrake: false,
    driver: opts.driver ?? 'none',
    siren: false,
    burning: 0,
    destroyed: false,
    smokeTimer: 0,
    locked: opts.locked ?? false,
    missionTag: null,
    ai: null,
  };
}

export function vehicleDef(v: Vehicle) {
  return VEHICLE_DEFS[v.kind];
}

export function speedOf(v: Vehicle): number {
  return Math.hypot(v.vel.x, v.vel.y);
}

export function forwardSpeed(v: Vehicle): number {
  return v.vel.x * Math.cos(v.angle) + v.vel.y * Math.sin(v.angle);
}

export function kmh(v: Vehicle): number {
  return Math.round(speedOf(v) * 0.42);
}

/**
 * Arcade top-down model: velocity is split into the car's forward/lateral axes,
 * the lateral part is bled off by grip (handbrake lowers it => drift), and the
 * body is re-oriented before the velocity is rebuilt with the *old* basis, so
 * slip appears naturally.
 */
export function updateVehiclePhysics(v: Vehicle, dt: number): void {
  const def = vehicleDef(v);
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  const fx = cos;
  const fy = sin;
  const rx = -sin;
  const ry = cos;

  let vf = v.vel.x * fx + v.vel.y * fy;
  let vr = v.vel.x * rx + v.vel.y * ry;

  const powerLoss = v.destroyed ? 0 : v.burning > 0 ? 0.55 : 1;
  vf += v.throttle * def.accel * powerLoss * dt;

  if (v.brakeInput > 0) {
    const brake = def.brake * v.brakeInput * dt;
    if (Math.abs(vf) <= brake) vf = 0;
    else vf -= Math.sign(vf) * brake;
  }

  // Aero drag + rolling resistance.
  vf -= vf * def.drag * dt;
  const roll = def.rollResist * dt;
  if (Math.abs(vf) <= roll) vf = 0;
  else vf -= Math.sign(vf) * roll;

  vf = clamp(vf, -def.maxSpeed * 0.42, def.maxSpeed);

  const grip = v.handbrake ? def.gripHandbrake : def.grip;
  vr *= Math.exp(-grip * dt);
  if (v.handbrake) vf *= Math.exp(-1.1 * dt);

  // Steering authority peaks at a third of top speed and fades when crawling.
  const ratio = Math.abs(vf) / def.maxSpeed;
  const authority = clamp(ratio * 3.4, 0, 1) * (1 - clamp(ratio - 0.55, 0, 1) * 0.45);
  const dir = vf >= 0 ? 1 : -1;
  v.angle += v.steer * def.turnRate * authority * dir * dt;

  v.vel.x = fx * vf + rx * vr;
  v.vel.y = fy * vf + ry * vr;
  v.pos.x += v.vel.x * dt;
  v.pos.y += v.vel.y * dt;
}

/** Returns the impact speed when the car hits static geometry. */
export function collideVehicleWorld(v: Vehicle, world: World, scratch: Collider[] = []): number {
  const r = v.radius;
  const area = { x: v.pos.x - v.w * 0.6, y: v.pos.y - v.w * 0.6, w: v.w * 1.2, h: v.w * 1.2 };
  const hits = world.grid.query(area, scratch);
  let impact = 0;

  // Sample the chassis at three points so long cars do not clip corners.
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  const offsets = [-v.w * 0.3, 0, v.w * 0.3];

  for (const collider of hits) {
    for (const off of offsets) {
      const p = { x: v.pos.x + cos * off, y: v.pos.y + sin * off };
      const push = circleRectPush(p, r, collider);
      if (!push) continue;
      v.pos.x += push.x;
      v.pos.y += push.y;
      const nx = push.x;
      const ny = push.y;
      const nl = Math.hypot(nx, ny) || 1;
      const normalSpeed = -(v.vel.x * (nx / nl) + v.vel.y * (ny / nl));
      if (normalSpeed > 0) {
        impact = Math.max(impact, normalSpeed);
        // Absorb most of the normal component, keep some slide.
        v.vel.x += (nx / nl) * normalSpeed * 1.25;
        v.vel.y += (ny / nl) * normalSpeed * 1.25;
        v.vel.x *= 0.72;
        v.vel.y *= 0.72;
      }
    }
  }

  // World bounds.
  const margin = v.radius;
  if (v.pos.x < margin) {
    v.pos.x = margin;
    v.vel.x = Math.abs(v.vel.x) * 0.3;
    impact = Math.max(impact, Math.abs(v.vel.x));
  }
  if (v.pos.y < margin) {
    v.pos.y = margin;
    v.vel.y = Math.abs(v.vel.y) * 0.3;
  }
  if (v.pos.x > world.size - margin) {
    v.pos.x = world.size - margin;
    v.vel.x = -Math.abs(v.vel.x) * 0.3;
  }
  if (v.pos.y > world.size - margin) {
    v.pos.y = world.size - margin;
    v.vel.y = -Math.abs(v.vel.y) * 0.3;
  }

  return impact;
}

/** Elastic-ish separation between two cars. Returns the closing speed. */
export function collideVehiclePair(a: Vehicle, b: Vehicle): number {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const minDist = (a.w + b.w) * 0.34;
  const d2 = dx * dx + dy * dy;
  if (d2 > minDist * minDist || d2 < 1e-6) return 0;

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const overlap = minDist - d;
  const ma = vehicleDef(a).mass;
  const mb = vehicleDef(b).mass;
  const total = ma + mb;

  a.pos.x -= nx * overlap * (mb / total);
  a.pos.y -= ny * overlap * (mb / total);
  b.pos.x += nx * overlap * (ma / total);
  b.pos.y += ny * overlap * (ma / total);

  const rvx = b.vel.x - a.vel.x;
  const rvy = b.vel.y - a.vel.y;
  const closing = -(rvx * nx + rvy * ny);
  if (closing <= 0) return 0;

  const impulse = (closing * 1.35) / total;
  a.vel.x -= nx * impulse * mb;
  a.vel.y -= ny * impulse * mb;
  b.vel.x += nx * impulse * ma;
  b.vel.y += ny * impulse * ma;
  return closing;
}

/** Fills throttle/steer so the car heads for `target`. */
export function steerToward(v: Vehicle, target: Vec, dt: number, maxSpeedFactor = 1): void {
  const desired = Math.atan2(target.y - v.pos.y, target.x - v.pos.x);
  const delta = angleDelta(v.angle, desired);
  const def = vehicleDef(v);
  const speed = forwardSpeed(v);

  v.steer = clamp(delta * 2.2, -1, 1);

  const tooFast = speed > def.maxSpeed * maxSpeedFactor;
  const sharp = Math.abs(delta) > 1.15;

  if (sharp && speed > 130) {
    v.throttle = 0;
    v.brakeInput = 0.7;
  } else if (tooFast) {
    v.throttle = 0;
    v.brakeInput = 0.25;
  } else {
    v.throttle = Math.abs(delta) > 0.7 ? 0.55 : 1;
    v.brakeInput = 0;
  }
  v.handbrake = false;
  void dt;
}

/** Local-space corner points, used by the renderer and by hit tests. */
export function vehicleCorners(v: Vehicle): Vec[] {
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  const hw = v.w / 2;
  const hh = v.h / 2;
  const pts: Vec[] = [];
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    pts.push({
      x: v.pos.x + cos * hw * sx - sin * hh * sy,
      y: v.pos.y + sin * hw * sx + cos * hh * sy,
    });
  }
  return pts;
}

/** Point-in-oriented-box test for bullets and interaction. */
export function pointInVehicle(v: Vehicle, p: Vec, pad = 0): boolean {
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  const dx = p.x - v.pos.x;
  const dy = p.y - v.pos.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= v.w / 2 + pad && Math.abs(ly) <= v.h / 2 + pad;
}
