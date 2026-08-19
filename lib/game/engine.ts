import { GameAudio } from './audio';
import { districtName, generateCity, isFree } from './city';
import {
  BLOCK,
  CRIME_HEAT,
  DESPAWN_RADIUS,
  FIXED_DT,
  HEAT_DECAY,
  HEAT_DECAY_DELAY,
  MAX_FRAME,
  PED_TARGET,
  PLAYER_MAX_ARMOR,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  PLAYER_RUN,
  PLAYER_WALK,
  ROAD,
  STREAM_RADIUS,
  TRAFFIC_KINDS,
  TRAFFIC_TARGET,
  VEHICLE_DEFS,
  WEAPON_DEFS,
  WEAPON_ORDER,
  type VehicleKind,
  type WeaponId,
} from './config';
import { consumePress, createInput, type InputState } from './input';
import {
  angleDelta,
  circleRectPush,
  clamp,
  dist,
  intOf,
  makeRng,
  pick,
  rangeOf,
  type Rng,
  type Vec,
} from './math';
import {
  MISSIONS,
  failMission,
  notifyKill,
  nextMission,
  startMission,
  updateMission,
  type MissionApi,
} from './missions';
import { COP_SHIRT, createPed, killPed, resetPedIds, scarePed, updatePed, type PedContext } from './peds';
import {
  cameraTarget,
  clockLabel,
  drawFullMap,
  drawMinimap,
  nightAmount,
  renderWorld,
  type Viewport,
} from './render';
import {
  addHeat,
  addMessage,
  floatingText,
  playerPos,
  playerVehicle,
  shake,
  spawnParticles,
  wantedLevel,
  type GameState,
} from './state';
import type { Bullet, Collider, HudState, Ped, Pickup, Player, Vehicle } from './types';
import {
  collideVehiclePair,
  collideVehicleWorld,
  createVehicle,
  forwardSpeed,
  kmh,
  pointInVehicle,
  resetVehicleIds,
  speedOf,
  steerToward,
  updateVehiclePhysics,
  vehicleDef,
} from './vehicle';

const SAVE_KEY = 'neo-vice.save.v1';
const MAX_COP_CARS = 5;
const MAX_COP_PEDS = 8;

interface SaveData {
  money: number;
  completed: string[];
}

export interface GameOptions {
  seed?: number;
  onHud?: (hud: HudState) => void;
}

export class Game {
  readonly state: GameState;
  readonly audio = new GameAudio();

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: InputState;
  private readonly disposeInput: () => void;
  private readonly onHud?: (hud: HudState) => void;
  private readonly scratch: Collider[] = [];
  private readonly pedScratch: Collider[] = [];

  private raf = 0;
  private lastTs = 0;
  private accumulator = 0;
  private hudTimer = 0;
  private nextPickupId = 1;
  private running = false;
  private view: Viewport = { w: 800, h: 600 };
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, options: GameOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D non disponibile');
    this.ctx = ctx;
    this.onHud = options.onHud;

    resetVehicleIds();
    resetPedIds();

    const seed = options.seed ?? 20260819;
    const world = generateCity(seed);
    const rng = makeRng(seed ^ 0x9e3779b9);

    const spawn = this.findSpawn(world, rng);
    const player: Player = {
      pos: { x: spawn.x, y: spawn.y },
      vel: { x: 0, y: 0 },
      angle: 0,
      aim: 0,
      health: PLAYER_MAX_HEALTH,
      armor: 0,
      radius: PLAYER_RADIUS,
      weapon: 'pistol',
      ammo: { fists: 0, pistol: 60, smg: 0, shotgun: 0 },
      shootTimer: 0,
      meleeSwing: 0,
      vehicleId: null,
      enterCooldown: 0,
      dead: false,
      deadTimer: 0,
      running: false,
      flash: 0,
    };

    this.state = {
      world,
      rng,
      camera: { x: spawn.x, y: spawn.y, zoom: 1.1, shake: 0 },
      player,
      vehicles: [],
      peds: [],
      bullets: [],
      pickups: [],
      particles: [],
      messages: [],
      money: 500,
      heat: 0,
      sinceCrime: 999,
      clock: 9 * 3600,
      elapsed: 0,
      mission: null,
      completed: [],
      alarm: null,
      paused: false,
      mapOpen: false,
      hint: null,
      streamTimer: 0,
      copSpawnTimer: 0,
      kills: 0,
      crashes: 0,
    };

    this.loadSave();
    this.seedPickups();
    this.seedParkedCars();
    this.streamWorld(true);

    const io = createInput(canvas);
    this.input = io.state;
    this.disposeInput = io.dispose;

    addMessage(this.state, 'Benvenuto a Neo Vice. Cerca un contatto $ sulla mappa.', 'info');
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      if (!this.running) return;
      this.frame(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.disposeInput();
    this.audio.dispose();
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
    if (paused) {
      this.audio.engine(false, 0);
      this.audio.siren(false, 0, 0);
    }
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view = { w: Math.max(320, rect.width), h: Math.max(240, rect.height) };
    this.canvas.width = Math.floor(this.view.w * this.dpr);
    this.canvas.height = Math.floor(this.view.h * this.dpr);
  }

  private frame(ts: number): void {
    const raw = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    const frameTime = Math.min(MAX_FRAME, Math.max(0, raw));

    if (!this.state.paused) {
      this.accumulator += frameTime;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 6) {
        this.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === 6) this.accumulator = 0;
    } else {
      // Still consume edge presses so the menu keys work while paused.
      this.handleGlobalKeys();
    }

    this.render();

    this.hudTimer += frameTime;
    if (this.hudTimer > 0.08) {
      this.hudTimer = 0;
      this.onHud?.(this.buildHud());
    }
  }

  // -------------------------------------------------------------------------
  // Setup helpers
  // -------------------------------------------------------------------------

  private findSpawn(world: GameState['world'], rng: Rng): Vec {
    const mid = Math.floor(world.size / (2 * BLOCK)) * BLOCK;
    for (let i = 0; i < 200; i++) {
      const candidate = {
        x: mid + rangeOf(rng, -BLOCK, BLOCK),
        y: mid + ROAD * 0.3 + rangeOf(rng, -BLOCK, BLOCK),
      };
      const snapped = { x: candidate.x, y: Math.round(candidate.y / BLOCK) * BLOCK + 26 };
      if (isFree(world, snapped, 20, this.scratch)) return snapped;
    }
    return { x: mid, y: mid + 26 };
  }

  private addPickup(kind: Pickup['kind'], pos: Vec, amount: number, respawn: number): void {
    this.state.pickups.push({
      id: this.nextPickupId++,
      kind,
      pos: { x: pos.x, y: pos.y },
      amount,
      respawn,
      cooldown: 0,
      bob: this.state.rng() * 6,
    });
  }

  private seedPickups(): void {
    const state = this.state;
    for (const lm of state.world.landmarks) {
      if (lm.kind === 'hospital') {
        this.addPickup('health', { x: lm.pos.x - 26, y: lm.pos.y - 30 }, 40, 30);
        this.addPickup('health', { x: lm.pos.x + 26, y: lm.pos.y - 30 }, 40, 30);
      } else if (lm.kind === 'shop') {
        if (lm.name.includes('Ammo')) {
          this.addPickup('smg', { x: lm.pos.x - 24, y: lm.pos.y - 26 }, 90, 45);
          this.addPickup('pistol', { x: lm.pos.x + 24, y: lm.pos.y - 26 }, 40, 30);
        } else if (lm.name.includes('Kevlar')) {
          this.addPickup('armor', { x: lm.pos.x, y: lm.pos.y - 26 }, 60, 40);
          this.addPickup('shotgun', { x: lm.pos.x + 34, y: lm.pos.y - 26 }, 16, 55);
        } else {
          this.addPickup('health', { x: lm.pos.x, y: lm.pos.y - 26 }, 35, 26);
          this.addPickup('armor', { x: lm.pos.x + 34, y: lm.pos.y - 26 }, 40, 40);
        }
      }
    }

    // Scattered loot in alleys and parks.
    const kinds: Pickup['kind'][] = ['cash', 'cash', 'cash', 'pistol', 'health', 'armor', 'smg', 'shotgun'];
    let placed = 0;
    for (let attempt = 0; attempt < 900 && placed < 46; attempt++) {
      const p = {
        x: rangeOf(this.state.rng, 60, state.world.size - 60),
        y: rangeOf(this.state.rng, 60, state.world.size - 60),
      };
      if (!isFree(state.world, p, 26, this.scratch)) continue;
      const kind = pick(this.state.rng, kinds);
      const amount = kind === 'cash' ? intOf(this.state.rng, 40, 260) : kind === 'shotgun' ? 12 : 40;
      this.addPickup(kind, p, amount, kind === 'cash' ? 90 : 45);
      placed++;
    }
  }

  private seedParkedCars(): void {
    const state = this.state;
    const nodes = state.world.nodes;
    let placed = 0;
    for (let attempt = 0; attempt < 1400 && placed < 90; attempt++) {
      const node = nodes[intOf(state.rng, 0, nodes.length - 1)];
      const horizontal = state.rng() < 0.5;
      const along = rangeOf(state.rng, 90, BLOCK - 90) * (state.rng() < 0.5 ? 1 : -1);
      const side = (ROAD / 2 - 16) * (state.rng() < 0.5 ? 1 : -1);
      const pos = horizontal
        ? { x: node.pos.x + along, y: node.pos.y + side }
        : { x: node.pos.x + side, y: node.pos.y + along };
      if (pos.x < 60 || pos.y < 60 || pos.x > state.world.size - 60 || pos.y > state.world.size - 60) continue;
      if (!isFree(state.world, pos, 34, this.scratch)) continue;
      if (state.vehicles.some((v) => dist(v.pos, pos) < 110)) continue;
      const kind = this.randomTrafficKind();
      const angle = horizontal ? (along > 0 ? 0 : Math.PI) : along > 0 ? Math.PI / 2 : -Math.PI / 2;
      state.vehicles.push(createVehicle(kind, pos, angle, state.rng));
      placed++;
    }
  }

  private randomTrafficKind(): VehicleKind {
    const state = this.state;
    const total = TRAFFIC_KINDS.reduce((sum, k) => sum + VEHICLE_DEFS[k].weight, 0);
    let roll = state.rng() * total;
    for (const k of TRAFFIC_KINDS) {
      roll -= VEHICLE_DEFS[k].weight;
      if (roll <= 0) return k;
    }
    return 'sedan';
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  private loadSave(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as SaveData;
      if (typeof data.money === 'number') this.state.money = data.money;
      if (Array.isArray(data.completed)) {
        this.state.completed = data.completed.filter((id) => MISSIONS.some((m) => m.id === id));
      }
    } catch {
      // Corrupt save: start fresh.
    }
  }

  save(): void {
    try {
      const data: SaveData = { money: this.state.money, completed: this.state.completed };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable; the run is simply not persisted.
    }
  }

  resetSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
    this.state.completed = [];
    this.state.money = 500;
    this.state.mission = null;
    addMessage(this.state, 'Progressi azzerati.', 'info');
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  private step(dt: number): void {
    const state = this.state;
    state.elapsed += dt;
    state.clock = (state.clock + dt * 60) % (24 * 3600);
    state.camera.shake = Math.max(0, state.camera.shake - dt * 34);
    state.sinceCrime += dt;
    if (state.sinceCrime > HEAT_DECAY_DELAY) state.heat = Math.max(0, state.heat - HEAT_DECAY * dt);

    for (const m of state.messages) m.life -= dt;
    state.messages = state.messages.filter((m) => m.life > 0);

    // Cleared up front so noise raised late in the step (bullet hits, blasts)
    // is still there for the pedestrians to react to on the next step.
    state.alarm = null;

    this.handleGlobalKeys();
    this.updatePlayer(dt);
    this.updateVehicles(dt);
    this.updatePeds(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updatePickups(dt);
    this.updateCops(dt);
    this.updateMissionFlow(dt);
    this.updateCamera(dt);
    this.updateAudio(dt);

    state.streamTimer -= dt;
    if (state.streamTimer <= 0) {
      state.streamTimer = 0.6;
      this.streamWorld(false);
    }
  }

  private handleGlobalKeys(): void {
    const state = this.state;
    if (consumePress(this.input, 'Tab') || consumePress(this.input, 'KeyM')) {
      state.mapOpen = !state.mapOpen;
    }
    if (consumePress(this.input, 'Escape')) {
      this.setPaused(!state.paused);
    }
    if (consumePress(this.input, 'KeyP')) {
      this.audio.setMuted(!this.audio.muted);
      addMessage(state, this.audio.muted ? 'Audio disattivato' : 'Audio attivato', 'info');
    }
  }

  private screenToWorld(sx: number, sy: number): Vec {
    const cam = this.state.camera;
    return {
      x: cam.x + (sx - this.view.w / 2) / cam.zoom,
      y: cam.y + (sy - this.view.h / 2) / cam.zoom,
    };
  }

  private updatePlayer(dt: number): void {
    const state = this.state;
    const p = state.player;
    const input = this.input;

    state.hint = null;
    p.flash = Math.max(0, p.flash - dt * 4);
    p.meleeSwing = Math.max(0, p.meleeSwing - dt);
    p.shootTimer = Math.max(0, p.shootTimer - dt);
    p.enterCooldown = Math.max(0, p.enterCooldown - dt);

    if (p.dead) {
      p.deadTimer += dt;
      if (p.deadTimer > 2.6) this.respawn();
      return;
    }

    const aimWorld = this.screenToWorld(input.mouse.x, input.mouse.y);
    const anchor = playerPos(state);
    p.aim = Math.atan2(aimWorld.y - anchor.y, aimWorld.x - anchor.x);

    // Weapon selection.
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (consumePress(input, `Digit${i + 1}`)) this.selectWeapon(WEAPON_ORDER[i]);
    }
    if (input.wheel !== 0) {
      const dir = input.wheel > 0 ? 1 : -1;
      input.wheel = 0;
      const idx = WEAPON_ORDER.indexOf(p.weapon);
      for (let i = 1; i <= WEAPON_ORDER.length; i++) {
        const candidate = WEAPON_ORDER[(idx + dir * i + WEAPON_ORDER.length * 4) % WEAPON_ORDER.length];
        if (candidate === 'fists' || p.ammo[candidate] > 0) {
          this.selectWeapon(candidate);
          break;
        }
      }
    }

    const vehicle = playerVehicle(state);
    if (consumePress(input, 'KeyF') || consumePress(input, 'Enter')) {
      if (vehicle) this.exitVehicle(vehicle);
      else this.tryEnterVehicle();
    }

    if (vehicle) {
      this.driveByInput(vehicle, dt);
      if (input.fire && p.shootTimer <= 0) this.fireWeapon(vehicle.pos, p.aim, 26);
      if (input.horn) this.audio.horn();
      return;
    }

    // On foot movement.
    const dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dirY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const l = Math.hypot(dirX, dirY);
    p.running = input.run && l > 0;
    const speed = p.running ? PLAYER_RUN : PLAYER_WALK;
    const targetVx = l > 0 ? (dirX / l) * speed : 0;
    const targetVy = l > 0 ? (dirY / l) * speed : 0;
    const smooth = 1 - Math.exp(-14 * dt);
    p.vel.x += (targetVx - p.vel.x) * smooth;
    p.vel.y += (targetVy - p.vel.y) * smooth;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    if (l > 0) p.angle = Math.atan2(p.vel.y, p.vel.x);

    // Static collision.
    const hits = state.world.grid.query(
      { x: p.pos.x - p.radius, y: p.pos.y - p.radius, w: p.radius * 2, h: p.radius * 2 },
      this.scratch,
    );
    for (const collider of hits) {
      const push = circleRectPush(p.pos, p.radius, collider);
      if (!push) continue;
      p.pos.x += push.x;
      p.pos.y += push.y;
    }
    p.pos.x = clamp(p.pos.x, 10, state.world.size - 10);
    p.pos.y = clamp(p.pos.y, 10, state.world.size - 10);

    // Cars shove / run over the player.
    for (const v of state.vehicles) {
      if (dist(v.pos, p.pos) > v.w) continue;
      if (!pointInVehicle(v, p.pos, p.radius * 0.6)) continue;
      const vs = speedOf(v);
      const nx = p.pos.x - v.pos.x;
      const ny = p.pos.y - v.pos.y;
      const nl = Math.hypot(nx, ny) || 1;
      p.pos.x += (nx / nl) * 6;
      p.pos.y += (ny / nl) * 6;
      if (vs > 90) {
        this.damagePlayer(vs * 0.12, v.pos);
        p.vel.x = (nx / nl) * vs * 0.6;
        p.vel.y = (ny / nl) * vs * 0.6;
        spawnParticles(state, 'blood', p.pos, 6, { color: '#a3212b', speed: 140, life: 0.5 });
        shake(state, 8);
      }
    }

    // Firing.
    if (input.fire && p.shootTimer <= 0) {
      const def = WEAPON_DEFS[p.weapon];
      const muzzle = { x: p.pos.x + Math.cos(p.aim) * 16, y: p.pos.y + Math.sin(p.aim) * 16 };
      if (def.melee) this.melee();
      else this.fireWeapon(muzzle, p.aim, 0);
    }

    // Mission contact interaction.
    this.updateContactHint();
  }

  private selectWeapon(id: WeaponId): void {
    const p = this.state.player;
    if (id !== 'fists' && p.ammo[id] <= 0) {
      addMessage(this.state, `Nessuna munizione per ${WEAPON_DEFS[id].name}`, 'bad');
      return;
    }
    p.weapon = id;
  }

  private updateContactHint(): void {
    const state = this.state;
    if (state.mission && state.mission.state === 'active') return;
    const p = state.player.pos;
    for (const lm of state.world.landmarks) {
      if (lm.kind !== 'contact') continue;
      if (dist(lm.pos, p) > 46) continue;
      const def = nextMission(state);
      if (!def) {
        state.hint = 'Nessun lavoro disponibile per ora';
        return;
      }
      state.hint = `E — accetta "${def.title}" da ${lm.name}`;
      if (consumePress(this.input, 'KeyE')) {
        state.mission = startMission(state, def, this.missionApi());
        this.audio.pickup();
      }
      return;
    }
  }

  private missionApi(): MissionApi {
    const state = this.state;
    return {
      spawnPed: (pos, opts) => {
        const ped = createPed(pos, state.rng, opts);
        state.peds.push(ped);
        return ped;
      },
      spawnVehicle: (kind, pos, angle, opts) => {
        const v = createVehicle(kind, pos, angle, state.rng, { color: opts?.color });
        v.missionTag = opts?.missionTag ?? null;
        state.vehicles.push(v);
        return v;
      },
      onPass: (reward) => {
        state.money += reward;
        this.audio.missionPass();
        this.save();
      },
      onFail: () => {
        this.audio.missionFail();
      },
    };
  }

  private driveByInput(v: Vehicle, dt: number): void {
    const input = this.input;
    const fwd = forwardSpeed(v);
    const wantForward = input.up;
    const wantBack = input.down;

    if (wantForward && !wantBack) {
      v.throttle = 1;
      v.brakeInput = 0;
    } else if (wantBack && !wantForward) {
      if (fwd > 25) {
        v.throttle = 0;
        v.brakeInput = 1;
      } else {
        v.throttle = -1;
        v.brakeInput = 0;
      }
    } else {
      v.throttle = 0;
      v.brakeInput = 0;
    }
    v.steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    v.handbrake = input.handbrake;
    void dt;
  }

  private tryEnterVehicle(): void {
    const state = this.state;
    const p = state.player;
    if (p.enterCooldown > 0) return;
    let best: Vehicle | null = null;
    let bestD = 78;
    for (const v of state.vehicles) {
      if (v.destroyed) continue;
      const d = dist(v.pos, p.pos) - v.w * 0.4;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;

    // Kick out any AI driver.
    if (best.driver === 'civil' || best.driver === 'cop') {
      const ped = createPed({ x: best.pos.x, y: best.pos.y + 24 }, state.rng, { isCop: best.driver === 'cop' });
      ped.state = best.driver === 'cop' ? 'attack' : 'flee';
      ped.panicTimer = 8;
      state.peds.push(ped);
      addHeat(state, CRIME_HEAT.carTheft);
      addMessage(state, 'Furto d’auto!', 'bad');
    } else if (!state.completed.length && state.heat === 0) {
      addHeat(state, CRIME_HEAT.carTheft * 0.4);
    }

    best.ai = null;
    best.driver = 'player';
    best.siren = false;
    p.vehicleId = best.id;
    p.enterCooldown = 0.4;
    p.vel.x = 0;
    p.vel.y = 0;
    this.audio.resume();
    addMessage(state, VEHICLE_DEFS[best.kind].name, 'info');
  }

  private exitVehicle(v: Vehicle): void {
    const state = this.state;
    const p = state.player;
    const right = { x: -Math.sin(v.angle), y: Math.cos(v.angle) };
    const offset = v.h / 2 + 16;
    const candidates = [
      { x: v.pos.x + right.x * offset, y: v.pos.y + right.y * offset },
      { x: v.pos.x - right.x * offset, y: v.pos.y - right.y * offset },
      { x: v.pos.x, y: v.pos.y },
    ];
    let spot = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (isFree(state.world, c, p.radius + 2, this.scratch)) {
        spot = c;
        break;
      }
    }
    p.pos.x = spot.x;
    p.pos.y = spot.y;
    p.vel.x = v.vel.x * 0.2;
    p.vel.y = v.vel.y * 0.2;
    p.vehicleId = null;
    p.enterCooldown = 0.4;
    v.driver = 'none';
    v.throttle = 0;
    v.brakeInput = 1;
    v.steer = 0;
  }

  // -------------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------------

  private updateVehicles(dt: number): void {
    const state = this.state;
    const target = playerPos(state);

    for (const v of state.vehicles) {
      if (v.ai) this.driveAi(v, dt, target);
      if (v.destroyed) {
        v.throttle = 0;
        v.steer = 0;
        v.brakeInput = 1;
        if (v.burning > 0) {
          v.burning -= dt;
          v.smokeTimer -= dt;
          if (v.smokeTimer <= 0) {
            v.smokeTimer = 0.06;
            spawnParticles(state, 'fire', v.pos, 2, { color: '#ff8f3c', speed: 60, life: 0.5, size: 4 });
            spawnParticles(state, 'smoke', v.pos, 1, { color: '#3a3a3a', speed: 40, life: 1.4, size: 6 });
          }
          if (v.burning <= 0) this.explode(v);
        }
      } else if (v.health < v.maxHealth * 0.35) {
        v.smokeTimer -= dt;
        if (v.smokeTimer <= 0) {
          v.smokeTimer = 0.22;
          spawnParticles(state, 'smoke', v.pos, 1, { color: '#4a4a4a', speed: 30, life: 1.1, size: 5 });
        }
      }

      updateVehiclePhysics(v, dt);
      const impact = collideVehicleWorld(v, state.world, this.scratch);
      if (impact > 120) this.onCrash(v, impact);
    }

    // Car to car.
    for (let i = 0; i < state.vehicles.length; i++) {
      const a = state.vehicles[i];
      for (let j = i + 1; j < state.vehicles.length; j++) {
        const b = state.vehicles[j];
        if (Math.abs(a.pos.x - b.pos.x) > 160 || Math.abs(a.pos.y - b.pos.y) > 160) continue;
        const closing = collideVehiclePair(a, b);
        if (closing > 130) {
          this.onCrash(a, closing * 0.7);
          this.onCrash(b, closing * 0.7);
        }
      }
    }

    // Run over pedestrians.
    for (const v of state.vehicles) {
      const vs = speedOf(v);
      if (vs < 55) continue;
      for (const ped of state.peds) {
        if (ped.state === 'dead') continue;
        if (Math.abs(ped.pos.x - v.pos.x) > v.w || Math.abs(ped.pos.y - v.pos.y) > v.w) continue;
        if (!pointInVehicle(v, ped.pos, ped.radius)) continue;
        const dir = { x: v.vel.x * 0.5, y: v.vel.y * 0.5 };
        killPed(ped, dir);
        spawnParticles(state, 'blood', ped.pos, 12, { color: '#a3212b', speed: 200, life: 0.6 });
        this.audio.hit();
        if (v.driver === 'player') {
          addHeat(state, ped.isCop ? CRIME_HEAT.copKill : CRIME_HEAT.runOver);
          state.kills++;
          notifyKill(state, ped);
          floatingText(state, ped.pos, ped.isCop ? 'AGENTE!' : 'INVESTITO', '#ff7a7a');
          shake(state, 6);
        }
      }
    }
  }

  private onCrash(v: Vehicle, impact: number): void {
    const state = this.state;
    const damage = (impact - 100) * 0.22 * (v.driver === 'player' ? 1 : 0.8);
    if (damage <= 0) return;
    v.health -= damage;
    spawnParticles(state, 'debris', v.pos, 4, { color: '#c9ced6', speed: 130, life: 0.4, size: 2 });
    if (v.driver === 'player') {
      shake(state, Math.min(16, impact * 0.06));
      this.damagePlayer(damage * 0.35, v.pos);
      this.audio.hit();
      state.crashes++;
      state.alarm = { pos: { x: v.pos.x, y: v.pos.y }, strength: 0.6 };
    }
    if (v.health <= 0 && !v.destroyed) this.destroyVehicle(v);
  }

  /** Marks a car as wrecked: it starts burning and will explode shortly after. */
  private destroyVehicle(v: Vehicle): void {
    const state = this.state;
    v.destroyed = true;
    v.health = 0;
    v.burning = rangeOf(state.rng, 1.4, 3);
    v.siren = false;
    if (v.driver === 'player') addMessage(state, 'Il veicolo è in fiamme! Esci!', 'bad');
    if (v.driver === 'civil' || v.driver === 'cop') {
      const ped = createPed({ x: v.pos.x, y: v.pos.y + 20 }, state.rng, { isCop: v.driver === 'cop' });
      ped.state = v.driver === 'cop' ? 'attack' : 'flee';
      ped.panicTimer = 10;
      state.peds.push(ped);
      v.driver = 'none';
    }
    v.ai = null;
  }

  private explode(v: Vehicle): void {
    const state = this.state;
    v.burning = 0;
    spawnParticles(state, 'fire', v.pos, 26, { color: '#ffb03c', speed: 320, life: 0.7, size: 6 });
    spawnParticles(state, 'smoke', v.pos, 18, { color: '#2f2f2f', speed: 180, life: 1.8, size: 9 });
    spawnParticles(state, 'debris', v.pos, 14, { color: '#8b8f96', speed: 300, life: 0.9, size: 2.5 });
    shake(state, 22);
    this.audio.explosion();
    state.alarm = { pos: { x: v.pos.x, y: v.pos.y }, strength: 1.4 };

    const radius = 150;
    for (const ped of state.peds) {
      if (ped.state === 'dead') continue;
      const d = dist(ped.pos, v.pos);
      if (d > radius) continue;
      const dmg = (1 - d / radius) * 90;
      ped.health -= dmg;
      if (ped.health <= 0) {
        killPed(ped, { x: (ped.pos.x - v.pos.x) * 2, y: (ped.pos.y - v.pos.y) * 2 });
        state.kills++;
        addHeat(state, ped.isCop ? CRIME_HEAT.copKill : CRIME_HEAT.pedKill);
        notifyKill(state, ped);
      } else {
        scarePed(ped, v.pos, 9);
      }
    }
    for (const other of state.vehicles) {
      if (other === v) continue;
      const d = dist(other.pos, v.pos);
      if (d > radius) continue;
      other.health -= (1 - d / radius) * 70;
      // Same teardown as any other wreck: the driver bails out and the AI stops.
      if (other.health <= 0 && !other.destroyed) this.destroyVehicle(other);
    }

    const p = state.player;
    const playerCar = playerVehicle(state);
    if (playerCar && playerCar.id === v.id) {
      this.exitVehicle(v);
      this.damagePlayer(65, v.pos);
    } else {
      const d = dist(p.pos, v.pos);
      if (!p.dead && d < radius) this.damagePlayer((1 - d / radius) * 70, v.pos);
    }
    addHeat(state, CRIME_HEAT.explosion * 0.5);
  }

  /** Traffic / police driving. */
  private driveAi(v: Vehicle, dt: number, playerAt: Vec): void {
    const state = this.state;
    const ai = v.ai;
    if (!ai || v.destroyed) return;

    ai.repathTimer -= dt;
    ai.shootTimer -= dt;

    const nodes = state.world.nodes;
    const current = nodes[ai.node];
    const next = nodes[ai.next];
    const toPlayer = dist(v.pos, playerAt);

    let aimPoint: Vec;

    if (ai.pursue) {
      // Cops drive straight at the player, road graph only as a hint.
      const player = playerAt;
      if (toPlayer < 420) {
        aimPoint = player;
      } else {
        const node = this.stepTowards(current, player);
        ai.node = node.id;
        ai.next = node.id;
        aimPoint = node.pos;
      }
      v.siren = true;

      if (toPlayer < 260 && ai.shootTimer <= 0 && !state.player.dead && wantedLevel(state) >= 3) {
        const angle = Math.atan2(playerAt.y - v.pos.y, playerAt.x - v.pos.x) + rangeOf(state.rng, -0.12, 0.12);
        // Muzzle outside the chassis so the shot does not hit the cruiser itself.
        const muzzle = { x: v.pos.x + Math.cos(angle) * (v.w * 0.7), y: v.pos.y + Math.sin(angle) * (v.w * 0.7) };
        this.spawnBullet(muzzle, angle, 11, 900, 'cop', 700);
        this.audio.gunshot('pistol');
        ai.shootTimer = rangeOf(state.rng, 0.7, 1.5);
      }

      // Deploy officers on foot when the player leaves the car.
      if (!ai.deployed && toPlayer < 240 && state.player.vehicleId === null) {
        ai.deployed = true;
        const copCount = state.peds.filter((pd) => pd.isCop && pd.state !== 'dead').length;
        if (copCount < MAX_COP_PEDS) {
          for (let i = 0; i < 2; i++) {
            const ped = createPed(
              { x: v.pos.x + rangeOf(state.rng, -26, 26), y: v.pos.y + rangeOf(state.rng, -26, 26) },
              state.rng,
              { isCop: true },
            );
            ped.state = 'attack';
            ped.shirt = COP_SHIRT;
            state.peds.push(ped);
          }
        }
      }
    } else {
      const fleeing = v.missionTag !== null;
      const laneTarget = this.laneTarget(current, next);
      if (dist(v.pos, laneTarget) < 62 || ai.repathTimer <= 0) {
        ai.repathTimer = 8;
        const chosen = fleeing ? this.stepAway(next, playerAt) : this.chooseNext(current, next);
        ai.node = next.id;
        ai.next = chosen;
        aimPoint = this.laneTarget(nodes[ai.node], nodes[ai.next]);
      } else {
        aimPoint = laneTarget;
      }
    }

    // Mission runaways drive nearly flat out, ordinary traffic cruises.
    steerToward(v, aimPoint, dt, ai.pursue ? 1 : v.missionTag !== null ? 0.95 : 0.55);

    // Rear-end avoidance.
    const ahead = {
      x: v.pos.x + Math.cos(v.angle) * (v.w * 0.9 + 30),
      y: v.pos.y + Math.sin(v.angle) * (v.w * 0.9 + 30),
    };
    for (const other of state.vehicles) {
      if (other === v) continue;
      if (dist(other.pos, ahead) < other.w * 0.5 + 22) {
        v.throttle = 0;
        v.brakeInput = 1;
        break;
      }
    }
    if (!ai.pursue && dist(state.player.pos, ahead) < 34 && state.player.vehicleId === null) {
      v.throttle = 0;
      v.brakeInput = 1;
    }

    // Unstick.
    if (Math.abs(forwardSpeed(v)) < 22 && v.throttle > 0.4) ai.stuckTimer += dt;
    else ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 0.5);

    if (ai.stuckTimer > 1.3) {
      ai.reverseTimer = 0.9;
      ai.stuckTimer = 0;
    }
    if (ai.reverseTimer > 0) {
      ai.reverseTimer -= dt;
      v.throttle = -1;
      v.brakeInput = 0;
      v.steer *= -1;
    }
  }

  private laneTarget(from: { pos: Vec }, to: { pos: Vec }): Vec {
    const dx = to.pos.x - from.pos.x;
    const dy = to.pos.y - from.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    const rx = -dy / l;
    const ry = dx / l;
    const off = ROAD * 0.24;
    return { x: to.pos.x + rx * off, y: to.pos.y + ry * off };
  }

  private chooseNext(from: { id: number; gx: number; gy: number }, at: { id: number; gx: number; gy: number; neighbors: number[] }): number {
    const state = this.state;
    // Keep going straight most of the time, otherwise turn at the junction.
    const straight = state.world.nodeAt.get(`${at.gx * 2 - from.gx},${at.gy * 2 - from.gy}`);
    if (straight !== undefined && state.rng() < 0.62) return straight;
    const options = at.neighbors.filter((id) => id !== from.id);
    if (options.length === 0) return from.id;
    return options[intOf(state.rng, 0, options.length - 1)];
  }

  private stepTowards(from: { neighbors: number[]; id: number }, goal: Vec): { id: number; pos: Vec } {
    const nodes = this.state.world.nodes;
    let best = nodes[from.id];
    let bestD = dist(best.pos, goal);
    for (const id of from.neighbors) {
      const n = nodes[id];
      const d = dist(n.pos, goal);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  private stepAway(from: { neighbors: number[]; id: number }, threat: Vec): number {
    const nodes = this.state.world.nodes;
    let best = from.id;
    let bestD = -Infinity;
    for (const id of from.neighbors) {
      const d = dist(nodes[id].pos, threat);
      if (d > bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Peds
  // -------------------------------------------------------------------------

  private updatePeds(dt: number): void {
    const state = this.state;
    const ctx: PedContext = {
      world: state.world,
      dt,
      rng: state.rng,
      playerPos: playerPos(state),
      playerInVehicle: state.player.vehicleId !== null,
      playerDead: state.player.dead,
      wanted: wantedLevel(state),
      alarm: state.alarm,
      fire: (from, angle, damage) => {
        this.spawnBullet(from, angle, damage, 880, 'cop', 620);
        this.audio.gunshot('pistol');
      },
      scratch: this.pedScratch,
    };

    for (const ped of state.peds) {
      updatePed(ped, ctx);
      if (ped.state !== 'dead' && ped.state !== 'attack' && !ped.isCop) {
        // Civilians scatter when the player drives on the sidewalk near them.
        const car = playerVehicle(state);
        if (car && speedOf(car) > 220 && dist(car.pos, ped.pos) < 130) scarePed(ped, car.pos, 4);
      }
    }

    // Push pedestrians apart so crowds do not stack.
    for (let i = 0; i < state.peds.length; i++) {
      const a = state.peds[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < state.peds.length; j++) {
        const b = state.peds[j];
        if (b.state === 'dead') continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        a.pos.x -= (dx / d) * push;
        a.pos.y -= (dy / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.y += (dy / d) * push;
      }
    }

    state.peds = state.peds.filter((p) => p.state !== 'dead' || p.deadTimer < 30);
  }

  private melee(): void {
    const state = this.state;
    const p = state.player;
    const def = WEAPON_DEFS.fists;
    p.shootTimer = def.rate;
    p.meleeSwing = 0.2;
    this.audio.punch();

    for (const ped of state.peds) {
      if (ped.state === 'dead') continue;
      const d = dist(ped.pos, p.pos);
      if (d > def.range) continue;
      const angle = Math.atan2(ped.pos.y - p.pos.y, ped.pos.x - p.pos.x);
      if (Math.abs(angleDelta(p.aim, angle)) > 0.9) continue;
      this.damagePed(ped, def.damage, p.aim);
    }
  }

  private damagePed(ped: Ped, damage: number, angle: number): void {
    const state = this.state;
    ped.health -= damage;
    spawnParticles(state, 'blood', ped.pos, 5, { color: '#a3212b', speed: 120, life: 0.4 });
    this.audio.hit();
    if (ped.health <= 0) {
      killPed(ped, { x: Math.cos(angle) * 90, y: Math.sin(angle) * 90 });
      state.kills++;
      addHeat(state, ped.isCop ? CRIME_HEAT.copKill : CRIME_HEAT.pedKill);
      notifyKill(state, ped);
      if (!ped.isCop && state.rng() < 0.35) {
        const cash = intOf(state.rng, 20, 120);
        state.money += cash;
        floatingText(state, ped.pos, `+$${cash}`, '#8ce07a');
        this.audio.cash();
      }
    } else if (!ped.isCop) {
      scarePed(ped, state.player.pos, 8);
    } else {
      ped.state = 'attack';
    }
    state.alarm = { pos: { x: ped.pos.x, y: ped.pos.y }, strength: 0.8 };
  }

  // -------------------------------------------------------------------------
  // Bullets & damage
  // -------------------------------------------------------------------------

  private spawnBullet(
    from: Vec,
    angle: number,
    damage: number,
    speed: number,
    owner: Bullet['owner'],
    range: number,
  ): void {
    this.state.bullets.push({
      pos: { x: from.x, y: from.y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: range / speed,
      damage,
      owner,
      trail: 0,
    });
    if (this.state.bullets.length > 400) this.state.bullets.shift();
  }

  private fireWeapon(origin: Vec, angle: number, forwardOffset: number): void {
    const state = this.state;
    const p = state.player;
    const def = WEAPON_DEFS[p.weapon];
    if (def.melee) return;
    if (p.ammo[p.weapon] <= 0) {
      addMessage(state, 'Caricatore vuoto', 'bad');
      this.selectWeapon('fists');
      return;
    }

    p.ammo[p.weapon]--;
    p.shootTimer = def.rate;
    p.flash = 1;

    const from = {
      x: origin.x + Math.cos(angle) * forwardOffset,
      y: origin.y + Math.sin(angle) * forwardOffset,
    };

    for (let i = 0; i < def.pellets; i++) {
      const spread = rangeOf(state.rng, -def.spread, def.spread);
      this.spawnBullet(from, angle + spread, def.damage, def.bulletSpeed, 'player', def.range);
    }
    spawnParticles(state, 'spark', from, 3, { color: '#ffe08a', speed: 90, life: 0.16, size: 2 });
    shake(state, def.recoil * 24);
    this.audio.gunshot(p.weapon === 'fists' ? 'pistol' : (p.weapon as 'pistol' | 'smg' | 'shotgun'));

    state.alarm = { pos: { x: from.x, y: from.y }, strength: def.noise + 0.4 };

    // Firing near witnesses raises heat.
    const witness = state.peds.some((ped) => ped.state !== 'dead' && dist(ped.pos, from) < 520);
    if (witness) addHeat(state, CRIME_HEAT.shotFired);
  }

  private updateBullets(dt: number): void {
    const state = this.state;
    const survivors: Bullet[] = [];

    for (const b of state.bullets) {
      b.life -= dt;
      if (b.life <= 0) continue;

      const steps = 2;
      let consumed = false;
      for (let s = 0; s < steps && !consumed; s++) {
        b.pos.x += (b.vel.x * dt) / steps;
        b.pos.y += (b.vel.y * dt) / steps;

        if (b.pos.x < 0 || b.pos.y < 0 || b.pos.x > state.world.size || b.pos.y > state.world.size) {
          consumed = true;
          break;
        }

        // Static geometry.
        const collider = state.world.grid.queryPoint(b.pos);
        if (collider) {
          spawnParticles(state, 'spark', b.pos, 4, { color: '#d8d3c0', speed: 90, life: 0.22, size: 1.8 });
          this.audio.ricochet();
          consumed = true;
          break;
        }

        // Peds.
        for (const ped of state.peds) {
          if (ped.state === 'dead') continue;
          if (b.owner !== 'player' && ped.isCop) continue;
          if (dist(ped.pos, b.pos) > ped.radius + 2) continue;
          this.damagePed(ped, b.damage, Math.atan2(b.vel.y, b.vel.x));
          consumed = true;
          break;
        }
        if (consumed) break;

        // Vehicles.
        for (const v of state.vehicles) {
          if (Math.abs(v.pos.x - b.pos.x) > v.w || Math.abs(v.pos.y - b.pos.y) > v.w) continue;
          if (!pointInVehicle(v, b.pos)) continue;
          const isPlayerCar = v.id === state.player.vehicleId;
          if (b.owner === 'player' && isPlayerCar) continue;
          v.health -= b.damage * 0.75;
          spawnParticles(state, 'spark', b.pos, 3, { color: '#ffd08a', speed: 110, life: 0.2, size: 1.6 });
          if (isPlayerCar) this.damagePlayer(b.damage * 0.25, b.pos);
          if (v.health <= 0 && !v.destroyed) this.destroyVehicle(v);
          consumed = true;
          break;
        }
        if (consumed) break;

        // Player.
        if (b.owner !== 'player' && !state.player.dead && state.player.vehicleId === null) {
          if (dist(state.player.pos, b.pos) < state.player.radius) {
            this.damagePlayer(b.damage, b.pos);
            consumed = true;
            break;
          }
        }
      }

      if (!consumed) survivors.push(b);
    }

    state.bullets = survivors;
  }

  private damagePlayer(amount: number, from: Vec): void {
    const state = this.state;
    const p = state.player;
    if (p.dead || amount <= 0) return;

    let remaining = amount;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, remaining * 0.7);
      p.armor -= absorbed;
      remaining -= absorbed;
    }
    p.health -= remaining;
    p.flash = Math.max(p.flash, 0.6);
    spawnParticles(state, 'blood', p.pos, 4, { color: '#a3212b', speed: 90, life: 0.35 });
    shake(state, Math.min(10, amount * 0.4));
    void from;

    if (p.health <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    const state = this.state;
    const p = state.player;
    p.health = 0;
    p.dead = true;
    p.deadTimer = 0;
    const car = playerVehicle(state);
    if (car) {
      car.driver = 'none';
      p.vehicleId = null;
      p.pos.x = car.pos.x;
      p.pos.y = car.pos.y;
    }
    spawnParticles(state, 'blood', p.pos, 18, { color: '#8f1d24', speed: 170, life: 0.8 });
    addMessage(state, 'SEI STATO ELIMINATO', 'bad');
    // Go through the normal failure path so the banner sticks and the mission
    // actors get cleaned up like any other failure.
    if (state.mission?.state === 'active') failMission(state, this.missionApi(), 'eliminato');
  }

  private respawn(): void {
    const state = this.state;
    const p = state.player;
    const hospitals = state.world.landmarks.filter((l) => l.kind === 'hospital');
    let spot = { x: state.world.size / 2, y: state.world.size / 2 };
    let bestD = Infinity;
    for (const h of hospitals) {
      const d = dist(h.pos, p.pos);
      if (d < bestD) {
        bestD = d;
        spot = { x: h.pos.x, y: h.pos.y + 60 };
      }
    }

    const fee = Math.min(state.money, Math.round(state.money * 0.12) + 100);
    state.money -= fee;
    p.pos = { x: spot.x, y: spot.y };
    p.vel = { x: 0, y: 0 };
    p.health = PLAYER_MAX_HEALTH;
    p.armor = 0;
    p.dead = false;
    p.deadTimer = 0;
    p.vehicleId = null;
    p.weapon = p.ammo.pistol > 0 ? 'pistol' : 'fists';
    state.heat = 0;
    state.sinceCrime = 999;
    state.camera.x = p.pos.x;
    state.camera.y = p.pos.y;

    // Clear the manhunt.
    state.vehicles = state.vehicles.filter((v) => v.driver !== 'cop');
    state.peds = state.peds.filter((ped) => !ped.isCop);

    addMessage(state, `Ospedale: spese mediche -$${fee}`, 'bad');
    this.save();
  }

  // -------------------------------------------------------------------------
  // Particles, pickups, cops
  // -------------------------------------------------------------------------

  private updateParticles(dt: number): void {
    const state = this.state;
    for (const p of state.particles) {
      p.life -= dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      const drag = p.kind === 'smoke' ? 1.2 : 3.4;
      p.vel.x *= Math.exp(-drag * dt);
      p.vel.y *= Math.exp(-drag * dt);
      if (p.kind === 'smoke' || p.kind === 'fire') p.vel.y -= 12 * dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  private updatePickups(dt: number): void {
    const state = this.state;
    const p = state.player;
    const pos = playerPos(state);

    for (const pk of state.pickups) {
      if (pk.cooldown > 0) {
        pk.cooldown -= dt;
        continue;
      }
      if (dist(pk.pos, pos) > 30) continue;

      let taken = true;
      switch (pk.kind) {
        case 'health': {
          if (p.health >= PLAYER_MAX_HEALTH) taken = false;
          else {
            p.health = Math.min(PLAYER_MAX_HEALTH, p.health + pk.amount);
            floatingText(state, pk.pos, `+${pk.amount} VITA`, '#5ad46e');
          }
          break;
        }
        case 'armor': {
          if (p.armor >= PLAYER_MAX_ARMOR) taken = false;
          else {
            p.armor = Math.min(PLAYER_MAX_ARMOR, p.armor + pk.amount);
            floatingText(state, pk.pos, `+${pk.amount} GIUBBOTTO`, '#5aa8f0');
          }
          break;
        }
        case 'cash': {
          state.money += pk.amount;
          floatingText(state, pk.pos, `+$${pk.amount}`, '#8ce07a');
          this.audio.cash();
          break;
        }
        default: {
          const weapon = pk.kind as WeaponId;
          const def = WEAPON_DEFS[weapon];
          if (p.ammo[weapon] >= def.ammoMax) taken = false;
          else {
            p.ammo[weapon] = Math.min(def.ammoMax, p.ammo[weapon] + pk.amount);
            floatingText(state, pk.pos, `${def.name} +${pk.amount}`, '#e8d26a');
            if (WEAPON_DEFS[p.weapon].melee) p.weapon = weapon;
          }
          break;
        }
      }

      if (taken) {
        if (pk.kind !== 'cash') this.audio.pickup();
        pk.cooldown = pk.respawn;
      }
    }
  }

  private updateCops(dt: number): void {
    const state = this.state;
    const wanted = wantedLevel(state);
    state.copSpawnTimer -= dt;

    const copCars = state.vehicles.filter((v) => v.driver === 'cop' && !v.destroyed);
    if (wanted === 0) {
      for (const v of copCars) {
        v.siren = false;
        if (v.ai) v.ai.pursue = false;
      }
      return;
    }

    const desired = Math.min(MAX_COP_CARS, wanted);
    if (copCars.length < desired && state.copSpawnTimer <= 0) {
      state.copSpawnTimer = Math.max(1.4, 5 - wanted * 0.7);
      this.spawnCopCar();
    }
  }

  private spawnCopCar(): void {
    const state = this.state;
    const anchor = playerPos(state);
    const nodes = state.world.nodes;
    for (let i = 0; i < 80; i++) {
      const node = nodes[intOf(state.rng, 0, nodes.length - 1)];
      const d = dist(node.pos, anchor);
      if (d < 900 || d > 1800) continue;
      const angle = Math.atan2(anchor.y - node.pos.y, anchor.x - node.pos.x);
      const v = createVehicle('police', node.pos, angle, state.rng, { driver: 'cop' });
      v.siren = true;
      v.ai = {
        node: node.id,
        next: node.id,
        pursue: true,
        repathTimer: 0,
        stuckTimer: 0,
        reverseTimer: 0,
        shootTimer: 1.2,
        deployed: false,
      };
      state.vehicles.push(v);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  private streamWorld(initial: boolean): void {
    const state = this.state;
    const anchor = playerPos(state);

    // Despawn.
    state.vehicles = state.vehicles.filter((v) => {
      if (v.id === state.player.vehicleId) return true;
      if (v.missionTag) return true;
      const d = dist(v.pos, anchor);
      if (d < DESPAWN_RADIUS) return true;
      return false;
    });
    state.peds = state.peds.filter((p) => {
      if (p.missionTag) return true;
      return dist(p.pos, anchor) < DESPAWN_RADIUS;
    });

    const traffic = state.vehicles.filter((v) => v.driver === 'civil').length;
    for (let i = traffic; i < TRAFFIC_TARGET; i++) this.spawnTrafficCar(initial);

    const peds = state.peds.filter((p) => !p.isCop && !p.missionTag).length;
    for (let i = peds; i < PED_TARGET; i++) this.spawnPed(initial);
  }

  private spawnTrafficCar(initial: boolean): void {
    const state = this.state;
    const anchor = playerPos(state);
    const nodes = state.world.nodes;

    for (let attempt = 0; attempt < 40; attempt++) {
      const node = nodes[intOf(state.rng, 0, nodes.length - 1)];
      const d = dist(node.pos, anchor);
      const min = initial ? 200 : 700;
      if (d < min || d > STREAM_RADIUS) continue;
      if (node.neighbors.length === 0) continue;
      const nextId = node.neighbors[intOf(state.rng, 0, node.neighbors.length - 1)];
      const next = nodes[nextId];
      const spawnPos = this.laneTarget(node, next);
      if (state.vehicles.some((v) => dist(v.pos, spawnPos) < 130)) continue;
      if (!isFree(state.world, spawnPos, 30, this.scratch)) continue;

      const kind = this.randomTrafficKind();
      const angle = Math.atan2(next.pos.y - node.pos.y, next.pos.x - node.pos.x);
      const v = createVehicle(kind, spawnPos, angle, state.rng, { driver: 'civil' });
      v.ai = {
        node: node.id,
        next: nextId,
        pursue: false,
        repathTimer: 8,
        stuckTimer: 0,
        reverseTimer: 0,
        shootTimer: 0,
      };
      const cruise = VEHICLE_DEFS[kind].maxSpeed * 0.4;
      v.vel.x = Math.cos(angle) * cruise;
      v.vel.y = Math.sin(angle) * cruise;
      state.vehicles.push(v);
      return;
    }
  }

  private spawnPed(initial: boolean): void {
    const state = this.state;
    const anchor = playerPos(state);
    const nodes = state.world.nodes;

    for (let attempt = 0; attempt < 40; attempt++) {
      const node = nodes[intOf(state.rng, 0, nodes.length - 1)];
      const along = rangeOf(state.rng, -BLOCK * 0.45, BLOCK * 0.45);
      const side = (ROAD / 2 + 14) * (state.rng() < 0.5 ? 1 : -1);
      const horizontal = state.rng() < 0.5;
      const pos = horizontal
        ? { x: node.pos.x + along, y: node.pos.y + side }
        : { x: node.pos.x + side, y: node.pos.y + along };
      const d = dist(pos, anchor);
      const min = initial ? 120 : 520;
      if (d < min || d > STREAM_RADIUS) continue;
      if (!isFree(state.world, pos, 16, this.scratch)) continue;
      state.peds.push(createPed(pos, state.rng));
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Mission flow, camera, audio
  // -------------------------------------------------------------------------

  private updateMissionFlow(dt: number): void {
    const state = this.state;
    const mission = state.mission;
    if (!mission) return;

    if (mission.state === 'active') {
      updateMission(state, dt, this.missionApi());
      return;
    }

    // Keep the banner around for a moment, then clean up.
    mission.timer -= dt;
    if (mission.timer <= 0) {
      for (const v of state.vehicles) if (v.missionTag === mission.def.id) v.missionTag = null;
      for (const p of state.peds) if (p.missionTag === mission.def.id) p.missionTag = null;
      state.mission = null;
    }
  }

  private updateCamera(dt: number): void {
    const state = this.state;
    const target = cameraTarget(state);
    const k = 1 - Math.exp(-7 * dt);
    state.camera.x += (target.pos.x - state.camera.x) * k;
    state.camera.y += (target.pos.y - state.camera.y) * k;
    state.camera.zoom += (target.zoom - state.camera.zoom) * (1 - Math.exp(-3 * dt));
  }

  private updateAudio(dt: number): void {
    const state = this.state;
    const car = playerVehicle(state);
    if (car) {
      const load = clamp(speedOf(car) / vehicleDef(car).maxSpeed, 0, 1);
      this.audio.engine(true, load);
    } else {
      this.audio.engine(false, 0);
    }

    const anchor = playerPos(state);
    let nearestCop = Infinity;
    for (const v of state.vehicles) {
      if (v.driver !== 'cop' || v.destroyed) continue;
      nearestCop = Math.min(nearestCop, dist(v.pos, anchor));
    }
    const active = nearestCop < 900;
    this.audio.siren(active, dt, active ? clamp(1 - nearestCop / 900, 0.2, 1) : 0);
  }

  // -------------------------------------------------------------------------
  // Render + HUD
  // -------------------------------------------------------------------------

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    renderWorld(ctx, this.state, this.view, this.scratch);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.state.mapOpen) drawFullMap(ctx, this.state, this.view);
    else drawMinimap(ctx, this.state, this.view);
  }

  private buildHud(): HudState {
    const state = this.state;
    const p = state.player;
    const car = playerVehicle(state);
    const mission = state.mission;

    return {
      health: Math.max(0, Math.round(p.health)),
      armor: Math.round(p.armor),
      money: Math.round(state.money),
      wanted: wantedLevel(state),
      weapon: WEAPON_DEFS[p.weapon].name,
      ammo: p.ammo[p.weapon],
      melee: WEAPON_DEFS[p.weapon].melee,
      speedKmh: car ? Math.abs(kmh(car)) : 0,
      vehicleName: car ? VEHICLE_DEFS[car.kind].name : null,
      vehicleHealth: car ? clamp(car.health / car.maxHealth, 0, 1) : 0,
      mission: mission
        ? {
            title: mission.state === 'active' ? mission.def.title : mission.outcome,
            objective: mission.state === 'active' ? mission.objective : '',
            timer: mission.state === 'active' && mission.def.timeLimit > 0 ? Math.max(0, Math.ceil(mission.timer)) : 0,
            progress: mission.needed > 1 ? `${mission.done}/${mission.needed}` : '',
          }
        : null,
      messages: state.messages.map((m) => ({ text: m.text, life: m.life, tone: m.tone })),
      clock: clockLabel(state),
      district: districtName(playerPos(state)),
      dead: p.dead,
      paused: state.paused,
      mapOpen: state.mapOpen,
      missionsDone: state.completed.length,
      missionsTotal: MISSIONS.length,
      hintNearby: state.hint,
    };
  }

  /** Exposed for the UI: is it night (used to tint the frame)? */
  night(): number {
    return nightAmount(this.state);
  }
}
