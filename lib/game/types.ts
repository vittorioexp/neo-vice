import type { Rect, Vec } from './math';
import type { VehicleKind, WeaponId } from './config';

// ---------------------------------------------------------------------------
// Static world
// ---------------------------------------------------------------------------

export type ColliderKind = 'building' | 'prop';

export interface Collider extends Rect {
  kind: ColliderKind;
  /** fake height used by the renderer for the pseudo-3D offset */
  height: number;
  fill: string;
  roof: string;
  round?: boolean;
}

export type ZoneKind = 'park' | 'plaza' | 'water';

export interface Zone extends Rect {
  kind: ZoneKind;
}

export interface RoadNode {
  id: number;
  gx: number;
  gy: number;
  pos: Vec;
  neighbors: number[];
}

export type LandmarkKind = 'hospital' | 'garage' | 'shop' | 'contact';

export interface Landmark {
  id: string;
  kind: LandmarkKind;
  name: string;
  pos: Vec;
}

export interface World {
  seed: number;
  size: number;
  colliders: Collider[];
  zones: Zone[];
  nodes: RoadNode[];
  /** node lookup by "gx,gy" */
  nodeAt: Map<string, number>;
  landmarks: Landmark[];
  grid: import('./math').SpatialGrid<Collider>;
  mapTexture: HTMLCanvasElement | null;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  pos: Vec;
  vel: Vec;
  angle: number;
  color: string;
  w: number;
  h: number;
  radius: number;
  health: number;
  maxHealth: number;
  /** control inputs, -1..1 / 0..1 */
  throttle: number;
  brakeInput: number;
  steer: number;
  handbrake: boolean;
  driver: 'none' | 'player' | 'civil' | 'cop';
  siren: boolean;
  burning: number;
  destroyed: boolean;
  smokeTimer: number;
  locked: boolean;
  missionTag: string | null;
  ai: VehicleAi | null;
}

export interface VehicleAi {
  node: number;
  next: number;
  /** cop cars pursue the player instead of cruising */
  pursue: boolean;
  repathTimer: number;
  stuckTimer: number;
  reverseTimer: number;
  shootTimer: number;
  /** cop cars only: foot officers already dropped off */
  deployed?: boolean;
}

export type PedState = 'wander' | 'flee' | 'attack' | 'dead';

export interface Ped {
  id: number;
  pos: Vec;
  vel: Vec;
  angle: number;
  radius: number;
  health: number;
  maxHealth: number;
  speed: number;
  state: PedState;
  target: Vec;
  /** cops attack the player when wanted */
  isCop: boolean;
  missionTag: string | null;
  skin: string;
  shirt: string;
  shootTimer: number;
  panicTimer: number;
  repathTimer: number;
  deadTimer: number;
  aim: number;
}

export type BulletOwner = 'player' | 'cop' | 'ped';

export interface Bullet {
  pos: Vec;
  vel: Vec;
  life: number;
  damage: number;
  owner: BulletOwner;
  trail: number;
}

export type PickupKind = 'health' | 'armor' | 'pistol' | 'smg' | 'shotgun' | 'cash';

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec;
  amount: number;
  respawn: number;
  cooldown: number;
  bob: number;
}

export type ParticleKind = 'spark' | 'blood' | 'smoke' | 'fire' | 'debris' | 'text';

export interface Particle {
  kind: ParticleKind;
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  text?: string;
}

export interface Player {
  pos: Vec;
  vel: Vec;
  angle: number;
  aim: number;
  health: number;
  armor: number;
  radius: number;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  shootTimer: number;
  meleeSwing: number;
  vehicleId: number | null;
  enterCooldown: number;
  dead: boolean;
  deadTimer: number;
  running: boolean;
  flash: number;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type MissionKind = 'delivery' | 'hit' | 'rampage' | 'getaway' | 'chase';

export interface MissionDef {
  id: string;
  kind: MissionKind;
  title: string;
  brief: string;
  reward: number;
  /** seconds, 0 = no limit */
  timeLimit: number;
  requires?: string;
}

export interface MissionRuntime {
  def: MissionDef;
  objective: string;
  timer: number;
  target: Vec | null;
  targetRadius: number;
  needed: number;
  done: number;
  vehicleId: number | null;
  pedIds: number[];
  state: 'active' | 'passed' | 'failed';
  outcome: string;
}

// ---------------------------------------------------------------------------
// HUD snapshot handed to React
// ---------------------------------------------------------------------------

export interface HudBlip {
  x: number;
  y: number;
  kind: string;
}

export interface HudState {
  health: number;
  armor: number;
  money: number;
  wanted: number;
  weapon: string;
  ammo: number;
  melee: boolean;
  speedKmh: number;
  vehicleName: string | null;
  vehicleHealth: number;
  mission: {
    title: string;
    objective: string;
    timer: number;
    progress: string;
  } | null;
  messages: { text: string; life: number; tone: string }[];
  clock: string;
  district: string;
  dead: boolean;
  paused: boolean;
  mapOpen: boolean;
  missionsDone: number;
  missionsTotal: number;
  hintNearby: string | null;
}

export interface Message {
  text: string;
  life: number;
  tone: 'info' | 'good' | 'bad';
}
