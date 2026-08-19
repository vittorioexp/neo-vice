export const TAU = Math.PI * 2;

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a: Vec, b: Vec): number {
  return Math.sqrt(dist2(a, b));
}

export function len(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

export function norm(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-6 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

/** Wraps an angle into [-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= TAU;
  while (r < -Math.PI) r += TAU;
  return r;
}

/** Shortest signed delta from `a` to `b`. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function approach(current: number, target: number, rate: number): number {
  if (current < target) return Math.min(current + rate, target);
  return Math.max(current - rate, target);
}

/** Deterministic PRNG (mulberry32) so a seed always builds the same city. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function rangeOf(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function intOf(rng: Rng, min: number, max: number): number {
  return Math.floor(rangeOf(rng, min, max + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * Push vector that separates a circle from an axis-aligned rect,
 * or null when they are not touching.
 */
export function circleRectPush(p: Vec, radius: number, r: Rect): Vec | null {
  const cx = clamp(p.x, r.x, r.x + r.w);
  const cy = clamp(p.y, r.y, r.y + r.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;

  if (d2 > radius * radius) return null;

  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    const push = radius - d;
    return { x: (dx / d) * push, y: (dy / d) * push };
  }

  // Center is inside the rect: eject along the closest face.
  const left = p.x - r.x;
  const right = r.x + r.w - p.x;
  const top = p.y - r.y;
  const bottom = r.y + r.h - p.y;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return { x: -(left + radius), y: 0 };
  if (min === right) return { x: right + radius, y: 0 };
  if (min === top) return { x: 0, y: -(top + radius) };
  return { x: 0, y: bottom + radius };
}

/** Uniform-grid broadphase for the static city geometry. */
export class SpatialGrid<T extends Rect> {
  private readonly cell: number;
  private readonly buckets = new Map<number, T[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 100003 + (cy + 4096);
  }

  insert(item: T): void {
    const x0 = Math.floor(item.x / this.cell);
    const y0 = Math.floor(item.y / this.cell);
    const x1 = Math.floor((item.x + item.w) / this.cell);
    const y1 = Math.floor((item.y + item.h) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this.key(cx, cy);
        const bucket = this.buckets.get(k);
        if (bucket) bucket.push(item);
        else this.buckets.set(k, [item]);
      }
    }
  }

  query(area: Rect, out: T[] = []): T[] {
    out.length = 0;
    const x0 = Math.floor(area.x / this.cell);
    const y0 = Math.floor(area.y / this.cell);
    const x1 = Math.floor((area.x + area.w) / this.cell);
    const y1 = Math.floor((area.y + area.h) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.buckets.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) {
          if (out.indexOf(item) === -1 && rectsOverlap(area, item)) out.push(item);
        }
      }
    }
    return out;
  }

  queryPoint(p: Vec): T | null {
    const bucket = this.buckets.get(this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell)));
    if (!bucket) return null;
    for (const item of bucket) if (pointInRect(p, item)) return item;
    return null;
  }
}
