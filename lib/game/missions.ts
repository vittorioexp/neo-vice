import { nearestNode } from './city';
import { BLOCK, VEHICLE_DEFS, type VehicleKind } from './config';
import { clamp, dist, intOf, pick, rangeOf, type Vec } from './math';
import {
  addMessage,
  floatingText,
  playerPos,
  playerVehicle,
  type GameState,
} from './state';
import type { MissionDef, MissionRuntime, Ped, Vehicle } from './types';

export interface MissionApi {
  spawnPed: (pos: Vec, opts?: { isCop?: boolean; missionTag?: string }) => Ped;
  spawnVehicle: (kind: VehicleKind, pos: Vec, angle: number, opts?: { missionTag?: string; color?: string }) => Vehicle;
  onPass: (reward: number) => void;
  onFail: () => void;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1',
    kind: 'delivery',
    title: 'Consegna Espressa',
    brief: 'Un pacco "delicato" da portare a Colle Miranda. Non farti fermare.',
    reward: 900,
    timeLimit: 110,
  },
  {
    id: 'm2',
    kind: 'getaway',
    title: 'Ferro Caldo',
    brief: 'Ruba la sportiva segnata e portala al garage prima che la cerchino.',
    reward: 1400,
    timeLimit: 150,
    requires: 'm1',
  },
  {
    id: 'm3',
    kind: 'hit',
    title: 'Conti in Sospeso',
    brief: 'Tre informatori parlano troppo. Fermali.',
    reward: 1800,
    timeLimit: 0,
    requires: 'm2',
  },
  {
    id: 'm4',
    kind: 'chase',
    title: 'Inseguimento sul Molo',
    brief: 'Un corriere rivale scappa con la nostra merce: distruggi la sua auto.',
    reward: 2200,
    timeLimit: 130,
    requires: 'm3',
  },
  {
    id: 'm5',
    kind: 'rampage',
    title: 'Messaggio Chiaro',
    brief: 'Dodici bersagli in due minuti. Che la città lo senta.',
    reward: 2600,
    timeLimit: 120,
    requires: 'm4',
  },
  {
    id: 'm6',
    kind: 'delivery',
    title: 'Corsa Cieca',
    brief: 'Attraversa il Distretto Ferro col carico. Il tempo è pochissimo.',
    reward: 3200,
    timeLimit: 85,
    requires: 'm5',
  },
  {
    id: 'm7',
    kind: 'hit',
    title: 'Ultimo Avvertimento',
    brief: 'Quattro sicari rivali in strada. Ripulisci.',
    reward: 4000,
    timeLimit: 0,
    requires: 'm6',
  },
  {
    id: 'm8',
    kind: 'getaway',
    title: 'Il Colpo Grosso',
    brief: 'Il furgone blindato è carico. Prendilo e sparisci al deposito.',
    reward: 6000,
    timeLimit: 170,
    requires: 'm7',
  },
];

export function missionAvailable(state: GameState, def: MissionDef): boolean {
  if (state.completed.includes(def.id)) return false;
  if (def.requires && !state.completed.includes(def.requires)) return false;
  return true;
}

export function nextMission(state: GameState): MissionDef | null {
  return MISSIONS.find((def) => missionAvailable(state, def)) ?? null;
}

function randomRoadPoint(state: GameState, from: Vec, minDist: number, maxDist: number): Vec {
  const nodes = state.world.nodes;
  let best: Vec | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 60; i++) {
    const node = nodes[intOf(state.rng, 0, nodes.length - 1)];
    const d = dist(node.pos, from);
    if (d < minDist || d > maxDist) continue;
    const score = Math.abs(d - (minDist + maxDist) / 2);
    if (score < bestScore) {
      bestScore = score;
      best = node.pos;
    }
  }
  if (best) return { x: best.x, y: best.y };
  const fallback = nearestNode(state.world, {
    x: clamp(from.x + BLOCK * 3, 0, state.world.size),
    y: clamp(from.y + BLOCK * 2, 0, state.world.size),
  });
  return { x: fallback.pos.x, y: fallback.pos.y };
}

function garagePoint(state: GameState, from: Vec): Vec {
  const garages = state.world.landmarks.filter((l) => l.kind === 'garage');
  if (garages.length === 0) return randomRoadPoint(state, from, 900, 2200);
  let best = garages[0];
  let bestD = -Infinity;
  for (const g of garages) {
    const d = dist(g.pos, from);
    if (d > bestD) {
      bestD = d;
      best = g;
    }
  }
  return { x: best.pos.x, y: best.pos.y };
}

export function startMission(state: GameState, def: MissionDef, api: MissionApi): MissionRuntime {
  const origin = playerPos(state);
  const runtime: MissionRuntime = {
    def,
    objective: '',
    timer: def.timeLimit,
    target: null,
    targetRadius: 70,
    needed: 1,
    done: 0,
    vehicleId: null,
    pedIds: [],
    state: 'active',
    outcome: '',
  };

  switch (def.kind) {
    case 'delivery': {
      runtime.target = randomRoadPoint(state, origin, 1400, 3400);
      runtime.objective = 'Raggiungi il punto di consegna';
      runtime.targetRadius = 80;
      break;
    }
    case 'getaway': {
      const kind: VehicleKind = def.id === 'm8' ? 'ambulance' : 'sport';
      const spot = randomRoadPoint(state, origin, 500, 1300);
      const vehicle = api.spawnVehicle(kind, spot, rangeOf(state.rng, -Math.PI, Math.PI), {
        missionTag: def.id,
        color: '#e8e2c8',
      });
      runtime.vehicleId = vehicle.id;
      runtime.target = { x: spot.x, y: spot.y };
      runtime.objective = `Ruba la ${VEHICLE_DEFS[kind].name} segnata`;
      break;
    }
    case 'hit': {
      const count = def.id === 'm7' ? 4 : 3;
      const area = randomRoadPoint(state, origin, 700, 2000);
      for (let i = 0; i < count; i++) {
        const pos = {
          x: clamp(area.x + rangeOf(state.rng, -220, 220), 40, state.world.size - 40),
          y: clamp(area.y + rangeOf(state.rng, -220, 220), 40, state.world.size - 40),
        };
        const ped = api.spawnPed(pos, { missionTag: def.id });
        ped.health = 70;
        ped.maxHealth = 70;
        ped.shirt = '#7a1f2b';
        runtime.pedIds.push(ped.id);
      }
      runtime.needed = count;
      runtime.target = area;
      runtime.objective = `Elimina i bersagli (0/${count})`;
      break;
    }
    case 'rampage': {
      runtime.needed = 12;
      runtime.objective = 'Bersagli eliminati (0/12)';
      break;
    }
    case 'chase': {
      const spot = randomRoadPoint(state, origin, 600, 1200);
      const kind: VehicleKind = pick(state.rng, ['sport', 'pickup'] as const);
      const node = nearestNode(state.world, spot);
      // Head for the neighbour that leads away from the player, otherwise the
      // courier sits on a zero-length lane target and never gets moving.
      let escape = node;
      let bestD = -Infinity;
      for (const id of node.neighbors) {
        const n = state.world.nodes[id];
        const d = dist(n.pos, origin);
        if (d > bestD) {
          bestD = d;
          escape = n;
        }
      }
      const heading = Math.atan2(escape.pos.y - node.pos.y, escape.pos.x - node.pos.x);
      const vehicle = api.spawnVehicle(kind, node.pos, heading, {
        missionTag: def.id,
        color: '#1d1f24',
      });
      vehicle.driver = 'civil';
      vehicle.vel.x = Math.cos(heading) * 160;
      vehicle.vel.y = Math.sin(heading) * 160;
      vehicle.ai = {
        node: node.id,
        next: escape.id,
        pursue: false,
        repathTimer: 8,
        stuckTimer: 0,
        reverseTimer: 0,
        shootTimer: 0,
      };
      runtime.vehicleId = vehicle.id;
      runtime.objective = 'Distruggi l’auto del corriere';
      break;
    }
  }

  addMessage(state, `MISSIONE: ${def.title}`, 'info');
  addMessage(state, def.brief, 'info');
  return runtime;
}

/** Called by the engine whenever the player kills someone. */
export function notifyKill(state: GameState, ped: Ped): void {
  const mission = state.mission;
  if (!mission || mission.state !== 'active') return;

  if (mission.def.kind === 'rampage') {
    mission.done++;
    mission.objective = `Bersagli eliminati (${mission.done}/${mission.needed})`;
    floatingText(state, ped.pos, `${mission.done}/${mission.needed}`, '#ff8f6b');
  } else if (mission.def.kind === 'hit' && ped.missionTag === mission.def.id) {
    mission.done++;
    mission.objective = `Elimina i bersagli (${mission.done}/${mission.needed})`;
    floatingText(state, ped.pos, 'BERSAGLIO', '#ff6b6b');
  }
}

export function updateMission(state: GameState, dt: number, api: MissionApi): void {
  const mission = state.mission;
  if (!mission || mission.state !== 'active') return;

  if (mission.def.timeLimit > 0) {
    mission.timer -= dt;
    if (mission.timer <= 0) {
      failMission(state, api, 'Tempo scaduto');
      return;
    }
  }

  const pos = playerPos(state);
  const vehicle = playerVehicle(state);

  switch (mission.def.kind) {
    case 'delivery': {
      if (mission.target && dist(pos, mission.target) < mission.targetRadius) {
        passMission(state, api);
      }
      break;
    }
    case 'getaway': {
      const target = state.vehicles.find((v) => v.id === mission.vehicleId);
      if (!target || target.destroyed) {
        failMission(state, api, 'Il veicolo è distrutto');
        return;
      }
      const stolen = vehicle !== null && vehicle.id === mission.vehicleId;
      if (!stolen) {
        mission.target = { x: target.pos.x, y: target.pos.y };
        mission.objective = 'Ruba il veicolo segnato';
      } else {
        if (mission.targetRadius !== 100) {
          mission.target = garagePoint(state, target.pos);
          mission.targetRadius = 100;
          mission.objective = 'Porta il veicolo al garage';
          addMessage(state, 'Ottimo. Ora al garage, e non farti seguire.', 'good');
        }
        if (mission.target && dist(target.pos, mission.target) < mission.targetRadius) {
          passMission(state, api);
        }
      }
      break;
    }
    case 'hit': {
      const alive = mission.pedIds
        .map((id) => state.peds.find((p) => p.id === id))
        .filter((p): p is Ped => !!p && p.state !== 'dead');
      if (mission.done >= mission.needed) {
        passMission(state, api);
        return;
      }
      mission.target = alive.length > 0 ? { x: alive[0].pos.x, y: alive[0].pos.y } : mission.target;
      break;
    }
    case 'rampage': {
      if (mission.done >= mission.needed) passMission(state, api);
      break;
    }
    case 'chase': {
      const target = state.vehicles.find((v) => v.id === mission.vehicleId);
      if (!target) {
        failMission(state, api, 'Il corriere è sparito');
        return;
      }
      if (target.destroyed) {
        passMission(state, api);
        return;
      }
      mission.target = { x: target.pos.x, y: target.pos.y };
      if (dist(target.pos, pos) > 2600) {
        failMission(state, api, 'Il corriere ti ha seminato');
      }
      break;
    }
  }
}

export function passMission(state: GameState, api: MissionApi): void {
  const mission = state.mission;
  if (!mission || mission.state !== 'active') return;
  mission.state = 'passed';
  mission.outcome = 'MISSIONE COMPLETATA';
  // Reused as the "keep the banner up" countdown once the mission is over.
  mission.timer = 4;
  state.completed.push(mission.def.id);
  api.onPass(mission.def.reward);
  addMessage(state, `MISSIONE COMPLETATA  +$${mission.def.reward}`, 'good');
}

export function failMission(state: GameState, api: MissionApi, reason: string): void {
  const mission = state.mission;
  if (!mission || mission.state !== 'active') return;
  mission.state = 'failed';
  mission.outcome = `MISSIONE FALLITA — ${reason}`;
  mission.timer = 4;
  api.onFail();
  addMessage(state, `MISSIONE FALLITA: ${reason}`, 'bad');
  // Clean up mission actors so the world does not fill up with markers.
  for (const v of state.vehicles) if (v.missionTag === mission.def.id) v.missionTag = null;
  for (const p of state.peds) if (p.missionTag === mission.def.id) p.missionTag = null;
}
