import { BLOCK, BLOCKS, COLORS, MAP_TEXTURE, ROAD, SIDEWALK, WORLD } from './config';
import {
  SpatialGrid,
  clamp,
  intOf,
  makeRng,
  pick,
  rangeOf,
  type Rect,
  type Rng,
  type Vec,
} from './math';
import type { Collider, Landmark, RoadNode, World, Zone } from './types';

const BUILDING_FILLS = [
  '#454b56',
  '#4e5461',
  '#3d434d',
  '#565d69',
  '#494f5b',
  '#5b6371',
  '#414751',
] as const;

const ROOF_TINTS = ['#6a7280', '#737b8a', '#5f6674', '#7c8493'] as const;

const CONTACT_NAMES = [
  'Rico "Mango"',
  'Dana Sorrentino',
  'Il Contabile',
  'Vera Lombardi',
  'Zio Nunzio',
  'Marlene K.',
] as const;

function blockInterior(gx: number, gy: number): Rect {
  return {
    x: gx * BLOCK + ROAD / 2,
    y: gy * BLOCK + ROAD / 2,
    w: BLOCK - ROAD,
    h: BLOCK - ROAD,
  };
}

function buildable(gx: number, gy: number): Rect {
  const r = blockInterior(gx, gy);
  return {
    x: r.x + SIDEWALK,
    y: r.y + SIDEWALK,
    w: r.w - SIDEWALK * 2,
    h: r.h - SIDEWALK * 2,
  };
}

function makeBuilding(rng: Rng, rect: Rect): Collider {
  const fill = pick(rng, BUILDING_FILLS);
  return {
    ...rect,
    kind: 'building',
    height: rangeOf(rng, 14, 52),
    fill,
    roof: pick(rng, ROOF_TINTS),
  };
}

function fillBlockWithBuildings(rng: Rng, area: Rect, out: Collider[]): void {
  const cols = intOf(rng, 1, 3);
  const rows = intOf(rng, 1, 3);
  const alley = 16;
  const cw = (area.w - alley * (cols - 1)) / cols;
  const ch = (area.h - alley * (rows - 1)) / rows;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      // Occasional empty lot / courtyard.
      if (cols * rows > 1 && rng() < 0.12) continue;
      const inset = rangeOf(rng, 0, 10);
      const rect: Rect = {
        x: area.x + c * (cw + alley) + inset,
        y: area.y + r * (ch + alley) + inset,
        w: cw - inset * 2,
        h: ch - inset * 2,
      };
      if (rect.w < 34 || rect.h < 34) continue;
      out.push(makeBuilding(rng, rect));
    }
  }
}

function addTrees(rng: Rng, area: Rect, count: number, out: Collider[]): void {
  for (let i = 0; i < count; i++) {
    const size = rangeOf(rng, 22, 34);
    const x = rangeOf(rng, area.x + 10, area.x + area.w - size - 10);
    const y = rangeOf(rng, area.y + 10, area.y + area.h - size - 10);
    out.push({
      x,
      y,
      w: size,
      h: size,
      kind: 'prop',
      height: 20,
      fill: rng() < 0.5 ? '#2c5b39' : '#31653f',
      roof: '#3d7a4b',
      round: true,
    });
  }
}

export function districtName(p: Vec): string {
  const half = WORLD / 2;
  const north = p.y < half;
  const west = p.x < half;
  const core = Math.abs(p.x - half) < BLOCK * 2 && Math.abs(p.y - half) < BLOCK * 2;
  if (core) return 'Centro Aurora';
  if (north && west) return 'Porto Vecchio';
  if (north && !west) return 'Colle Miranda';
  if (!north && west) return 'Baia Salina';
  return 'Distretto Ferro';
}

export function generateCity(seed: number): World {
  const rng = makeRng(seed);
  const colliders: Collider[] = [];
  const zones: Zone[] = [];
  const landmarks: Landmark[] = [];

  const mid = Math.floor(BLOCKS / 2);
  const reserved = new Map<string, string>();
  reserved.set(`${mid},${mid}`, 'plaza');

  // Landmark blocks: hospital, two garages, three shops.
  const landmarkPlan: { kind: Landmark['kind']; name: string; gx: number; gy: number }[] = [
    { kind: 'hospital', name: 'Ospedale Santa Cruz', gx: 2, gy: 3 },
    { kind: 'hospital', name: 'Clinica Delle Palme', gx: BLOCKS - 3, gy: BLOCKS - 4 },
    { kind: 'garage', name: 'Garage Ruggine', gx: BLOCKS - 3, gy: 2 },
    { kind: 'garage', name: 'Deposito Molo 9', gx: 3, gy: BLOCKS - 3 },
    { kind: 'shop', name: 'Ammo & Co.', gx: mid - 3, gy: mid + 2 },
    { kind: 'shop', name: 'Farmacia Notturna', gx: mid + 3, gy: mid - 2 },
    { kind: 'shop', name: 'Kevlar Bros', gx: 5, gy: 8 },
  ];

  for (const plan of landmarkPlan) {
    reserved.set(`${plan.gx},${plan.gy}`, 'landmark');
  }

  for (let gx = 0; gx < BLOCKS; gx++) {
    for (let gy = 0; gy < BLOCKS; gy++) {
      const key = `${gx},${gy}`;
      const reservedKind = reserved.get(key);
      const interior = blockInterior(gx, gy);
      const area = buildable(gx, gy);

      if (reservedKind === 'plaza') {
        zones.push({ ...interior, kind: 'plaza' });
        // Central fountain.
        const size = 96;
        colliders.push({
          x: interior.x + interior.w / 2 - size / 2,
          y: interior.y + interior.h / 2 - size / 2,
          w: size,
          h: size,
          kind: 'prop',
          height: 10,
          fill: '#3f6f86',
          roof: '#5793ad',
          round: true,
        });
        addTrees(rng, interior, 6, colliders);
        continue;
      }

      const roll = rng();
      if (reservedKind !== 'landmark' && roll < 0.1) {
        zones.push({ ...interior, kind: 'park' });
        addTrees(rng, area, intOf(rng, 6, 12), colliders);
        continue;
      }
      if (reservedKind !== 'landmark' && roll < 0.14) {
        zones.push({ ...interior, kind: 'plaza' });
        addTrees(rng, area, intOf(rng, 2, 5), colliders);
        continue;
      }

      if (reservedKind === 'landmark') {
        // One big block-filling structure with a forecourt.
        const rect: Rect = {
          x: area.x,
          y: area.y + area.h * 0.34,
          w: area.w,
          h: area.h * 0.66,
        };
        const building = makeBuilding(rng, rect);
        building.fill = '#4a5364';
        building.roof = '#7e8a9c';
        building.height = 30;
        colliders.push(building);
        continue;
      }

      fillBlockWithBuildings(rng, area, colliders);
    }
  }

  for (const plan of landmarkPlan) {
    const area = buildable(plan.gx, plan.gy);
    landmarks.push({
      id: `${plan.kind}-${plan.gx}-${plan.gy}`,
      kind: plan.kind,
      name: plan.name,
      pos: { x: area.x + area.w / 2, y: area.y + area.h * 0.14 },
    });
  }

  // Mission contacts sit on sidewalk corners spread over the map.
  const contactSpots: Vec[] = [
    { x: BLOCK * 1 + ROAD, y: BLOCK * 1 + ROAD },
    { x: BLOCK * (BLOCKS - 1) - ROAD, y: BLOCK * 2 + ROAD },
    { x: BLOCK * 2 + ROAD, y: BLOCK * (BLOCKS - 1) - ROAD },
    { x: BLOCK * (BLOCKS - 2) - ROAD, y: BLOCK * (BLOCKS - 2) - ROAD },
    { x: BLOCK * mid + ROAD, y: BLOCK * (mid - 3) + ROAD },
    { x: BLOCK * (mid - 4) + ROAD, y: BLOCK * mid + ROAD },
  ];
  contactSpots.forEach((pos, i) => {
    landmarks.push({
      id: `contact-${i}`,
      kind: 'contact',
      name: CONTACT_NAMES[i % CONTACT_NAMES.length],
      pos,
    });
  });

  // Road graph.
  const nodes: RoadNode[] = [];
  const nodeAt = new Map<string, number>();
  for (let gx = 0; gx <= BLOCKS; gx++) {
    for (let gy = 0; gy <= BLOCKS; gy++) {
      const id = nodes.length;
      nodeAt.set(`${gx},${gy}`, id);
      nodes.push({ id, gx, gy, pos: { x: gx * BLOCK, y: gy * BLOCK }, neighbors: [] });
    }
  }
  for (const node of nodes) {
    const deltas = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of deltas) {
      const other = nodeAt.get(`${node.gx + dx},${node.gy + dy}`);
      if (other !== undefined) node.neighbors.push(other);
    }
  }

  const grid = new SpatialGrid<Collider>(BLOCK / 2);
  for (const c of colliders) grid.insert(c);

  const world: World = {
    seed,
    size: WORLD,
    colliders,
    zones,
    nodes,
    nodeAt,
    landmarks,
    grid,
    mapTexture: null,
  };

  if (typeof document !== 'undefined') {
    world.mapTexture = renderMapTexture(world);
  }

  return world;
}

/** Bakes the whole city into a small canvas used by minimap and full map. */
export function renderMapTexture(world: World): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_TEXTURE;
  canvas.height = MAP_TEXTURE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const s = MAP_TEXTURE / world.size;

  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, MAP_TEXTURE, MAP_TEXTURE);

  for (const zone of world.zones) {
    ctx.fillStyle = zone.kind === 'park' ? COLORS.park : zone.kind === 'water' ? COLORS.water : COLORS.plaza;
    ctx.fillRect(zone.x * s, zone.y * s, zone.w * s, zone.h * s);
  }

  ctx.fillStyle = COLORS.asphalt;
  for (let i = 0; i <= BLOCKS; i++) {
    const p = i * BLOCK * s;
    const w = ROAD * s;
    ctx.fillRect(p - w / 2, 0, w, MAP_TEXTURE);
    ctx.fillRect(0, p - w / 2, MAP_TEXTURE, w);
  }

  for (const c of world.colliders) {
    if (c.kind !== 'building') continue;
    ctx.fillStyle = c.roof;
    ctx.fillRect(c.x * s, c.y * s, Math.max(1, c.w * s), Math.max(1, c.h * s));
  }

  return canvas;
}

export function nodeIdAt(world: World, gx: number, gy: number): number | undefined {
  return world.nodeAt.get(`${gx},${gy}`);
}

export function nearestNode(world: World, p: Vec): RoadNode {
  const gx = clamp(Math.round(p.x / BLOCK), 0, BLOCKS);
  const gy = clamp(Math.round(p.y / BLOCK), 0, BLOCKS);
  const id = world.nodeAt.get(`${gx},${gy}`);
  return world.nodes[id ?? 0];
}

/** True when the point sits inside a solid collider. */
export function isBlocked(world: World, p: Vec): boolean {
  return world.grid.queryPoint(p) !== null;
}

/** True when a circle at `p` overlaps nothing solid and is inside the map. */
export function isFree(world: World, p: Vec, radius: number, scratch: Collider[] = []): boolean {
  if (p.x < radius || p.y < radius || p.x > world.size - radius || p.y > world.size - radius) return false;
  const found = world.grid.query({ x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 }, scratch);
  return found.length === 0;
}

/** Distance from the nearest road centre line, useful for "am I on the street". */
export function roadDistance(p: Vec): number {
  const dx = Math.abs(p.x - Math.round(p.x / BLOCK) * BLOCK);
  const dy = Math.abs(p.y - Math.round(p.y / BLOCK) * BLOCK);
  return Math.min(dx, dy);
}

export function isOnRoad(p: Vec): boolean {
  return roadDistance(p) < ROAD / 2;
}
