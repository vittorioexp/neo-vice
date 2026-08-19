import { HEAT_MAX, HEAT_PER_STAR } from './config';
import { clamp, rangeOf, type Rng, type Vec } from './math';
import type {
  Bullet,
  Message,
  MissionRuntime,
  Particle,
  Ped,
  Pickup,
  Player,
  Vehicle,
  World,
} from './types';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  shake: number;
}

export interface GameState {
  world: World;
  rng: Rng;
  camera: Camera;
  player: Player;
  vehicles: Vehicle[];
  peds: Ped[];
  bullets: Bullet[];
  pickups: Pickup[];
  particles: Particle[];
  messages: Message[];

  money: number;
  heat: number;
  /** seconds since the last crime, drives heat decay */
  sinceCrime: number;
  /** in-game clock in seconds, 24h cycle */
  clock: number;
  elapsed: number;

  mission: MissionRuntime | null;
  completed: string[];

  /** last loud event, used by ped panic */
  alarm: { pos: Vec; strength: number } | null;

  paused: boolean;
  mapOpen: boolean;
  hint: string | null;
  streamTimer: number;
  copSpawnTimer: number;
  kills: number;
  crashes: number;
}

export function wantedLevel(state: GameState): number {
  return clamp(Math.ceil(state.heat / HEAT_PER_STAR), 0, 5);
}

export function addHeat(state: GameState, amount: number): void {
  state.heat = clamp(state.heat + amount, 0, HEAT_MAX);
  state.sinceCrime = 0;
}

export function addMessage(state: GameState, text: string, tone: Message['tone'] = 'info'): void {
  state.messages.push({ text, life: 4.2, tone });
  if (state.messages.length > 5) state.messages.shift();
}

export function findVehicle(state: GameState, id: number | null): Vehicle | null {
  if (id === null) return null;
  return state.vehicles.find((v) => v.id === id) ?? null;
}

export function findPed(state: GameState, id: number): Ped | null {
  return state.peds.find((p) => p.id === id) ?? null;
}

export function playerVehicle(state: GameState): Vehicle | null {
  return findVehicle(state, state.player.vehicleId);
}

export function playerPos(state: GameState): Vec {
  const v = playerVehicle(state);
  return v ? v.pos : state.player.pos;
}

export function spawnParticles(
  state: GameState,
  kind: Particle['kind'],
  pos: Vec,
  count: number,
  opts: { color?: string; speed?: number; life?: number; size?: number; text?: string } = {},
): void {
  const speed = opts.speed ?? 120;
  const life = opts.life ?? 0.5;
  for (let i = 0; i < count; i++) {
    const angle = rangeOf(state.rng, -Math.PI, Math.PI);
    const s = rangeOf(state.rng, speed * 0.2, speed);
    state.particles.push({
      kind,
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(angle) * s, y: Math.sin(angle) * s },
      life,
      maxLife: life,
      size: opts.size ?? rangeOf(state.rng, 1.5, 3.5),
      color: opts.color ?? '#ffd479',
      text: opts.text,
    });
    if (state.particles.length > 900) state.particles.shift();
  }
}

export function floatingText(state: GameState, pos: Vec, text: string, color = '#f7d156'): void {
  state.particles.push({
    kind: 'text',
    pos: { x: pos.x, y: pos.y - 12 },
    vel: { x: 0, y: -34 },
    life: 1.5,
    maxLife: 1.5,
    size: 14,
    color,
    text,
  });
}

export function shake(state: GameState, amount: number): void {
  state.camera.shake = Math.min(26, state.camera.shake + amount);
}
