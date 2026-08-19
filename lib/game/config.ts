// ---------------------------------------------------------------------------
// World layout
// ---------------------------------------------------------------------------

/** Distance between two road centre lines. */
export const BLOCK = 440;
/** Total width of a road (both lanes). */
export const ROAD = 108;
/** Blocks per side. The city is BLOCKS x BLOCKS. */
export const BLOCKS = 13;
/** World is a square starting at 0,0. */
export const WORLD = BLOCK * BLOCKS;

export const SIDEWALK = 26;
export const MAP_TEXTURE = 1300;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export const FIXED_DT = 1 / 60;
export const MAX_FRAME = 0.1;

export const STREAM_RADIUS = 1900;
export const DESPAWN_RADIUS = 2700;
export const TRAFFIC_TARGET = 22;
export const PED_TARGET = 26;

export const PLAYER_RADIUS = 12;
export const PLAYER_WALK = 132;
export const PLAYER_RUN = 232;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_ARMOR = 100;

/** Heat points; 20 per wanted star. */
export const HEAT_PER_STAR = 20;
export const HEAT_MAX = 100;
export const HEAT_DECAY = 2.4;
export const HEAT_DECAY_DELAY = 8;

export const CRIME_HEAT = {
  pedKill: 22,
  copKill: 34,
  carTheft: 9,
  shotFired: 4,
  runOver: 18,
  explosion: 26,
} as const;

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type VehicleKind = 'sedan' | 'sport' | 'suv' | 'pickup' | 'taxi' | 'police' | 'ambulance' | 'bus';

export interface VehicleDef {
  kind: VehicleKind;
  name: string;
  w: number;
  h: number;
  mass: number;
  maxSpeed: number;
  accel: number;
  brake: number;
  /** rad/s at ideal speed */
  turnRate: number;
  /** lateral velocity damping; lower = more drift */
  grip: number;
  gripHandbrake: number;
  drag: number;
  rollResist: number;
  health: number;
  colors: readonly string[];
  /** relative spawn weight in normal traffic */
  weight: number;
}

const CIVIL_COLORS = [
  '#c9ced6',
  '#7f8a99',
  '#2f3742',
  '#b23a48',
  '#2e6f9e',
  '#3f7d58',
  '#d4a531',
  '#8f5fa8',
  '#e0e5ea',
] as const;

export const VEHICLE_DEFS: Record<VehicleKind, VehicleDef> = {
  sedan: {
    kind: 'sedan',
    name: 'Vulcan Sedano',
    w: 74,
    h: 38,
    mass: 1.0,
    maxSpeed: 430,
    accel: 300,
    brake: 460,
    turnRate: 2.5,
    grip: 6.5,
    gripHandbrake: 1.4,
    drag: 0.55,
    rollResist: 26,
    health: 100,
    colors: CIVIL_COLORS,
    weight: 34,
  },
  sport: {
    kind: 'sport',
    name: 'Kestrel GT',
    w: 78,
    h: 36,
    mass: 0.85,
    maxSpeed: 610,
    accel: 430,
    brake: 520,
    turnRate: 2.9,
    grip: 5.6,
    gripHandbrake: 1.0,
    drag: 0.5,
    rollResist: 22,
    health: 85,
    colors: ['#e2483d', '#f2c53d', '#1c1f26', '#2fa4a0', '#f5f7fa'],
    weight: 10,
  },
  suv: {
    kind: 'suv',
    name: 'Ridge Baron',
    w: 82,
    h: 44,
    mass: 1.35,
    maxSpeed: 400,
    accel: 270,
    brake: 430,
    turnRate: 2.2,
    grip: 7.2,
    gripHandbrake: 2.0,
    drag: 0.6,
    rollResist: 30,
    health: 145,
    colors: CIVIL_COLORS,
    weight: 18,
  },
  pickup: {
    kind: 'pickup',
    name: 'Halcón Bruto',
    w: 86,
    h: 42,
    mass: 1.3,
    maxSpeed: 390,
    accel: 265,
    brake: 410,
    turnRate: 2.15,
    grip: 6.8,
    gripHandbrake: 1.6,
    drag: 0.62,
    rollResist: 30,
    health: 135,
    colors: ['#3f7d58', '#8a6b46', '#5a6472', '#b23a48', '#d8dde3'],
    weight: 12,
  },
  taxi: {
    kind: 'taxi',
    name: 'Cabbie 400',
    w: 76,
    h: 39,
    mass: 1.05,
    maxSpeed: 415,
    accel: 290,
    brake: 450,
    turnRate: 2.45,
    grip: 6.6,
    gripHandbrake: 1.5,
    drag: 0.56,
    rollResist: 27,
    health: 105,
    colors: ['#f2b134'],
    weight: 10,
  },
  police: {
    kind: 'police',
    name: 'Enforcer',
    w: 80,
    h: 40,
    mass: 1.15,
    maxSpeed: 520,
    accel: 380,
    brake: 500,
    turnRate: 2.65,
    grip: 6.9,
    gripHandbrake: 1.5,
    drag: 0.52,
    rollResist: 24,
    health: 150,
    colors: ['#1b2b46'],
    weight: 0,
  },
  ambulance: {
    kind: 'ambulance',
    name: 'Vitalis',
    w: 92,
    h: 46,
    mass: 1.5,
    maxSpeed: 380,
    accel: 250,
    brake: 400,
    turnRate: 2.0,
    grip: 7.4,
    gripHandbrake: 2.2,
    drag: 0.62,
    rollResist: 32,
    health: 180,
    colors: ['#f4f6f8'],
    weight: 3,
  },
  bus: {
    kind: 'bus',
    name: 'Transito',
    w: 132,
    h: 48,
    mass: 2.4,
    maxSpeed: 320,
    accel: 190,
    brake: 340,
    turnRate: 1.5,
    grip: 8.0,
    gripHandbrake: 3.0,
    drag: 0.7,
    rollResist: 36,
    health: 260,
    colors: ['#3d6f8e', '#8d9aa8'],
    weight: 3,
  },
};

export const TRAFFIC_KINDS: readonly VehicleKind[] = ['sedan', 'sport', 'suv', 'pickup', 'taxi', 'ambulance', 'bus'];

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  melee: boolean;
  damage: number;
  /** seconds between shots */
  rate: number;
  spread: number;
  pellets: number;
  bulletSpeed: number;
  range: number;
  ammoMax: number;
  recoil: number;
  noise: number;
}

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  fists: {
    id: 'fists',
    name: 'Pugni',
    melee: true,
    damage: 16,
    rate: 0.38,
    spread: 0,
    pellets: 1,
    bulletSpeed: 0,
    range: 40,
    ammoMax: 0,
    recoil: 0,
    noise: 0,
  },
  pistol: {
    id: 'pistol',
    name: 'Pistola',
    melee: false,
    damage: 26,
    rate: 0.3,
    spread: 0.035,
    pellets: 1,
    bulletSpeed: 980,
    range: 760,
    ammoMax: 240,
    recoil: 0.05,
    noise: 0.5,
  },
  smg: {
    id: 'smg',
    name: 'Mitraglietta',
    melee: false,
    damage: 15,
    rate: 0.085,
    spread: 0.09,
    pellets: 1,
    bulletSpeed: 1050,
    range: 720,
    ammoMax: 600,
    recoil: 0.1,
    noise: 0.4,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Fucile',
    melee: false,
    damage: 13,
    rate: 0.85,
    spread: 0.2,
    pellets: 7,
    bulletSpeed: 880,
    range: 420,
    ammoMax: 90,
    recoil: 0.22,
    noise: 0.9,
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = ['fists', 'pistol', 'smg', 'shotgun'];

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const COLORS = {
  asphalt: '#22262c',
  asphaltLine: '#40464f',
  sidewalk: '#4c525b',
  ground: '#2c3138',
  park: '#2f5c3c',
  parkDark: '#274d32',
  water: '#1c3c56',
  plaza: '#575d67',
  buildingRoof: '#585f6b',
  blip: '#f7d156',
} as const;
