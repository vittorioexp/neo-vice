import { isFree } from './city';
import { angleDelta, circleRectPush, clamp, dist, pick, rangeOf, type Rng, type Vec } from './math';
import type { Collider, Ped, World } from './types';

let nextPedId = 1;

export function resetPedIds(): void {
  nextPedId = 1;
}

const SKINS = ['#d8a984', '#b3805c', '#8a5a3b', '#e6c3a2', '#6b4429'] as const;
const SHIRTS = [
  '#d9534f',
  '#4a90d9',
  '#f0ad4e',
  '#5cb85c',
  '#b07cc6',
  '#eeeeee',
  '#333a44',
  '#2fa4a0',
] as const;

export const COP_SHIRT = '#26456f';

export function createPed(pos: Vec, rng: Rng, opts: { isCop?: boolean; missionTag?: string } = {}): Ped {
  const isCop = opts.isCop ?? false;
  return {
    id: nextPedId++,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    angle: rangeOf(rng, -Math.PI, Math.PI),
    radius: 11,
    health: isCop ? 70 : 45,
    maxHealth: isCop ? 70 : 45,
    speed: isCop ? 150 : rangeOf(rng, 62, 96),
    state: 'wander',
    target: { x: pos.x, y: pos.y },
    isCop,
    missionTag: opts.missionTag ?? null,
    skin: pick(rng, SKINS),
    shirt: isCop ? COP_SHIRT : pick(rng, SHIRTS),
    shootTimer: 0,
    panicTimer: 0,
    repathTimer: 0,
    deadTimer: 0,
    aim: 0,
  };
}

export interface PedContext {
  world: World;
  dt: number;
  rng: Rng;
  playerPos: Vec;
  playerInVehicle: boolean;
  playerDead: boolean;
  wanted: number;
  /** loud events (gunshots, crashes) that make civilians panic */
  alarm: { pos: Vec; strength: number } | null;
  fire: (from: Vec, angle: number, damage: number) => void;
  scratch: Collider[];
}

function pickWanderTarget(ped: Ped, ctx: PedContext): void {
  for (let attempt = 0; attempt < 6; attempt++) {
    const angle = rangeOf(ctx.rng, -Math.PI, Math.PI);
    const radius = rangeOf(ctx.rng, 120, 420);
    const p = {
      x: clamp(ped.pos.x + Math.cos(angle) * radius, 40, ctx.world.size - 40),
      y: clamp(ped.pos.y + Math.sin(angle) * radius, 40, ctx.world.size - 40),
    };
    if (isFree(ctx.world, p, ped.radius + 6, ctx.scratch)) {
      ped.target = p;
      return;
    }
  }
  ped.target = { x: ped.pos.x, y: ped.pos.y };
}

export function scarePed(ped: Ped, from: Vec, seconds = 6): void {
  if (ped.state === 'dead' || ped.isCop) return;
  ped.state = 'flee';
  ped.panicTimer = Math.max(ped.panicTimer, seconds);
  const dx = ped.pos.x - from.x;
  const dy = ped.pos.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  ped.target = { x: ped.pos.x + (dx / l) * 500, y: ped.pos.y + (dy / l) * 500 };
}

export function updatePed(ped: Ped, ctx: PedContext): void {
  const { dt } = ctx;

  if (ped.state === 'dead') {
    ped.deadTimer += dt;
    ped.vel.x *= Math.exp(-6 * dt);
    ped.vel.y *= Math.exp(-6 * dt);
    ped.pos.x += ped.vel.x * dt;
    ped.pos.y += ped.vel.y * dt;
    return;
  }

  ped.shootTimer = Math.max(0, ped.shootTimer - dt);
  ped.repathTimer -= dt;
  const toPlayer = dist(ped.pos, ctx.playerPos);

  if (ctx.alarm && !ped.isCop) {
    const d = dist(ped.pos, ctx.alarm.pos);
    if (d < 420 * ctx.alarm.strength) scarePed(ped, ctx.alarm.pos);
  }

  if (ped.isCop && !ctx.playerDead && (ctx.wanted > 0 || ped.state === 'attack')) {
    ped.state = 'attack';
  }

  let speed = ped.speed;

  switch (ped.state) {
    case 'wander': {
      if (ped.repathTimer <= 0 || dist(ped.pos, ped.target) < 24) {
        pickWanderTarget(ped, ctx);
        ped.repathTimer = rangeOf(ctx.rng, 2.5, 6);
      }
      break;
    }
    case 'flee': {
      speed = ped.speed * 1.85;
      ped.panicTimer -= dt;
      if (ped.panicTimer <= 0) {
        ped.state = 'wander';
        ped.repathTimer = 0;
      } else if (dist(ped.pos, ped.target) < 40 || ped.repathTimer <= 0) {
        const dx = ped.pos.x - ctx.playerPos.x;
        const dy = ped.pos.y - ctx.playerPos.y;
        const l = Math.hypot(dx, dy) || 1;
        ped.target = {
          x: clamp(ped.pos.x + (dx / l) * 420 + rangeOf(ctx.rng, -120, 120), 40, ctx.world.size - 40),
          y: clamp(ped.pos.y + (dy / l) * 420 + rangeOf(ctx.rng, -120, 120), 40, ctx.world.size - 40),
        };
        ped.repathTimer = 1.4;
      }
      break;
    }
    case 'attack': {
      ped.aim = Math.atan2(ctx.playerPos.y - ped.pos.y, ctx.playerPos.x - ped.pos.x);
      const ideal = ctx.playerInVehicle ? 130 : 190;
      if (toPlayer > ideal + 40) {
        ped.target = ctx.playerPos;
      } else if (toPlayer < ideal - 60) {
        ped.target = {
          x: ped.pos.x - Math.cos(ped.aim) * 160,
          y: ped.pos.y - Math.sin(ped.aim) * 160,
        };
      } else {
        // Strafe a little so cops are not static targets.
        ped.target = {
          x: ped.pos.x - Math.sin(ped.aim) * 90,
          y: ped.pos.y + Math.cos(ped.aim) * 90,
        };
      }
      if (toPlayer < 460 && ped.shootTimer <= 0 && !ctx.playerDead) {
        ctx.fire(ped.pos, ped.aim + rangeOf(ctx.rng, -0.09, 0.09), 12);
        ped.shootTimer = rangeOf(ctx.rng, 0.45, 0.95);
      }
      speed = ped.speed;
      break;
    }
  }

  // Steer/move.
  const dx = ped.target.x - ped.pos.x;
  const dy = ped.target.y - ped.pos.y;
  const d = Math.hypot(dx, dy);
  if (d > 6) {
    const desired = Math.atan2(dy, dx);
    ped.angle += clamp(angleDelta(ped.angle, desired), -7 * dt, 7 * dt);
    const move = Math.min(speed, d / dt);
    ped.vel.x = Math.cos(ped.angle) * move;
    ped.vel.y = Math.sin(ped.angle) * move;
  } else {
    ped.vel.x *= Math.exp(-8 * dt);
    ped.vel.y *= Math.exp(-8 * dt);
  }

  ped.pos.x += ped.vel.x * dt;
  ped.pos.y += ped.vel.y * dt;

  // Static collision.
  const hits = ctx.world.grid.query(
    { x: ped.pos.x - ped.radius, y: ped.pos.y - ped.radius, w: ped.radius * 2, h: ped.radius * 2 },
    ctx.scratch,
  );
  let bumped = false;
  for (const collider of hits) {
    const push = circleRectPush(ped.pos, ped.radius, collider);
    if (!push) continue;
    ped.pos.x += push.x;
    ped.pos.y += push.y;
    bumped = true;
  }
  if (bumped && ped.repathTimer > 0.4) ped.repathTimer = 0.15;

  ped.pos.x = clamp(ped.pos.x, 12, ctx.world.size - 12);
  ped.pos.y = clamp(ped.pos.y, 12, ctx.world.size - 12);
}

export function killPed(ped: Ped, impulse: Vec): void {
  ped.state = 'dead';
  ped.health = 0;
  ped.deadTimer = 0;
  ped.vel.x = impulse.x;
  ped.vel.y = impulse.y;
}
