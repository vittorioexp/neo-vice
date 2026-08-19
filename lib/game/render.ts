import { districtName } from './city';
import { BLOCK, BLOCKS, COLORS, ROAD, SIDEWALK, WEAPON_DEFS } from './config';
import { clamp, type Rect, type Vec } from './math';
import { playerPos, playerVehicle, wantedLevel, type GameState } from './state';
import type { Collider, Ped, Pickup, Vehicle } from './types';
import { forwardSpeed, speedOf } from './vehicle';

export interface Viewport {
  w: number;
  h: number;
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function viewRect(state: GameState, view: Viewport): Rect {
  const zoom = state.camera.zoom;
  const w = view.w / zoom;
  const h = view.h / zoom;
  return { x: state.camera.x - w / 2, y: state.camera.y - h / 2, w, h };
}

/** 0 = midday, 1 = deep night. */
export function nightAmount(state: GameState): number {
  const hour = (state.clock / 3600) % 24;
  if (hour >= 8 && hour < 18) return 0;
  if (hour >= 18 && hour < 21) return (hour - 18) / 3;
  if (hour >= 21 || hour < 5) return 1;
  return 1 - (hour - 5) / 3;
}

export function clockLabel(state: GameState): string {
  const total = Math.floor(state.clock / 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

function drawGround(ctx: CanvasRenderingContext2D, state: GameState, vr: Rect): void {
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(vr.x, vr.y, vr.w, vr.h);

  for (const zone of state.world.zones) {
    if (zone.x > vr.x + vr.w || zone.x + zone.w < vr.x || zone.y > vr.y + vr.h || zone.y + zone.h < vr.y) continue;
    if (zone.kind === 'park') {
      ctx.fillStyle = COLORS.park;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
      ctx.fillStyle = COLORS.parkDark;
      for (let i = 0; i < 5; i++) {
        const t = hash2(zone.x + i, zone.y);
        ctx.fillRect(zone.x + t * zone.w * 0.6, zone.y + hash2(zone.y, i) * zone.h * 0.8, zone.w * 0.3, 10);
      }
    } else if (zone.kind === 'plaza') {
      ctx.fillStyle = COLORS.plaza;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    } else {
      ctx.fillStyle = COLORS.water;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    }
  }

  const i0 = clamp(Math.floor(vr.x / BLOCK) - 1, 0, BLOCKS);
  const i1 = clamp(Math.ceil((vr.x + vr.w) / BLOCK) + 1, 0, BLOCKS);
  const j0 = clamp(Math.floor(vr.y / BLOCK) - 1, 0, BLOCKS);
  const j1 = clamp(Math.ceil((vr.y + vr.h) / BLOCK) + 1, 0, BLOCKS);
  const walk = ROAD / 2 + SIDEWALK;

  // Sidewalk bands.
  ctx.fillStyle = COLORS.sidewalk;
  for (let i = i0; i <= i1; i++) {
    const x = i * BLOCK;
    ctx.fillRect(x - walk, vr.y, walk * 2, vr.h);
  }
  for (let j = j0; j <= j1; j++) {
    const y = j * BLOCK;
    ctx.fillRect(vr.x, y - walk, vr.w, walk * 2);
  }

  // Asphalt.
  ctx.fillStyle = COLORS.asphalt;
  for (let i = i0; i <= i1; i++) {
    ctx.fillRect(i * BLOCK - ROAD / 2, vr.y, ROAD, vr.h);
  }
  for (let j = j0; j <= j1; j++) {
    ctx.fillRect(vr.x, j * BLOCK - ROAD / 2, vr.w, ROAD);
  }

  // Lane markings, skipped over intersections.
  ctx.strokeStyle = COLORS.asphaltLine;
  ctx.lineWidth = 3;
  ctx.setLineDash([22, 20]);
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const x = i * BLOCK;
    for (let j = j0; j < j1; j++) {
      ctx.moveTo(x, j * BLOCK + ROAD / 2 + 6);
      ctx.lineTo(x, (j + 1) * BLOCK - ROAD / 2 - 6);
    }
  }
  for (let j = j0; j <= j1; j++) {
    const y = j * BLOCK;
    for (let i = i0; i < i1; i++) {
      ctx.moveTo(i * BLOCK + ROAD / 2 + 6, y);
      ctx.lineTo((i + 1) * BLOCK - ROAD / 2 - 6, y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosswalks, batched into a single path.
  ctx.fillStyle = 'rgba(220,226,232,0.22)';
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const cx = i * BLOCK;
      const cy = j * BLOCK;
      for (let s = -1; s <= 1; s += 2) {
        for (let k = 0; k < 5; k++) {
          const off = -ROAD / 2 + 8 + k * 20;
          ctx.rect(cx + off, cy + s * (ROAD / 2 + 2) - (s > 0 ? 0 : 14), 12, 14);
          ctx.rect(cx + s * (ROAD / 2 + 2) - (s > 0 ? 0 : 14), cy + off, 14, 12);
        }
      }
    }
  }
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function drawColliders(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  vr: Rect,
  night: number,
  scratch: Collider[],
): void {
  const cam = state.camera;
  const items = state.world.grid.query(vr, scratch);

  for (const c of items) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    let dx = cx - cam.x;
    let dy = cy - cam.y;
    const l = Math.hypot(dx, dy) || 1;
    const push = Math.min(0.16, c.height / 320);
    dx = (dx / l) * c.height * push * 3.2;
    dy = (dy / l) * c.height * push * 3.2;

    if (c.round) {
      const r = c.w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx + dx * 0.6, cy + dy * 0.6, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.fill;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.roof;
      ctx.beginPath();
      ctx.arc(cx + dx * 0.5, cy + dy * 0.5, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // Facade quads on the two faces pointing away from the camera.
    const corners: Vec[] = [
      { x: c.x, y: c.y },
      { x: c.x + c.w, y: c.y },
      { x: c.x + c.w, y: c.y + c.h },
      { x: c.x, y: c.y + c.h },
    ];
    const normals: Vec[] = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];

    ctx.fillStyle = c.fill;
    ctx.fillRect(c.x, c.y, c.w, c.h);

    for (let e = 0; e < 4; e++) {
      const n = normals[e];
      if (n.x * dx + n.y * dy <= 0) continue;
      const a = corners[e];
      const b = corners[(e + 1) % 4];
      const shade = n.y > 0 ? 0.0 : n.x !== 0 ? 0.12 : 0.22;
      ctx.fillStyle = c.fill;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + dx, b.y + dy);
      ctx.lineTo(a.x + dx, a.y + dy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fill();
    }

    // Roof.
    ctx.fillStyle = c.roof;
    ctx.fillRect(c.x + dx, c.y + dy, c.w, c.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x + dx, c.y + dy, c.w, c.h);

    // Roof detail + lit windows at night.
    const seed = hash2(c.x, c.y);
    if (c.w > 70 && c.h > 70) {
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(c.x + dx + c.w * 0.2, c.y + dy + c.h * (0.2 + seed * 0.3), c.w * 0.35, c.h * 0.2);
    }
    if (night > 0.25) {
      ctx.fillStyle = `rgba(255,214,138,${0.16 + night * 0.5})`;
      const count = 3 + Math.floor(seed * 4);
      for (let k = 0; k < count; k++) {
        const t = hash2(c.x + k * 7.3, c.y + k * 3.1);
        const u = hash2(c.y + k * 5.7, c.x + k * 9.2);
        if (u > 0.62) continue;
        const wx = c.x + dx + 6 + t * (c.w - 16);
        const wy = c.y + dy + 6 + u * (c.h - 16) * 1.4;
        ctx.fillRect(wx, wy, 7, 5);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function drawVehicle(ctx: CanvasRenderingContext2D, v: Vehicle, night: number, time: number): void {
  ctx.save();
  ctx.translate(v.pos.x, v.pos.y);

  // Shadow.
  ctx.save();
  ctx.rotate(v.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  roundRect(ctx, -v.w / 2 + 5, -v.h / 2 + 6, v.w, v.h, 8);
  ctx.fill();
  ctx.restore();

  ctx.rotate(v.angle);

  // Wheels.
  ctx.fillStyle = '#15171b';
  const wheelW = v.w * 0.16;
  const wheelH = v.h * 0.18;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.fillRect(sx * v.w * 0.3 - wheelW / 2, sy * (v.h / 2 - wheelH * 0.3) - wheelH / 2, wheelW, wheelH);
    }
  }

  // Body.
  const body = v.destroyed ? '#3a3129' : v.color;
  ctx.fillStyle = body;
  roundRect(ctx, -v.w / 2, -v.h / 2, v.w, v.h, 9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cabin / windows.
  ctx.fillStyle = v.destroyed ? '#241f1a' : 'rgba(24,30,40,0.85)';
  roundRect(ctx, -v.w * 0.1, -v.h * 0.38, v.w * 0.34, v.h * 0.76, 4);
  ctx.fill();
  ctx.fillStyle = v.destroyed ? '#241f1a' : 'rgba(150,190,220,0.35)';
  roundRect(ctx, v.w * 0.14, -v.h * 0.34, v.w * 0.1, v.h * 0.68, 3);
  ctx.fill();

  // Roof stripe / taxi sign.
  if (v.kind === 'taxi') {
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(-v.w * 0.02, -v.h * 0.12, 10, v.h * 0.24);
  }
  if (v.kind === 'police') {
    ctx.fillStyle = '#e8ecf1';
    ctx.fillRect(-v.w * 0.5 + 2, -v.h * 0.5 + 2, v.w * 0.22, v.h - 4);
  }
  if (v.kind === 'ambulance') {
    ctx.fillStyle = '#c9342c';
    ctx.fillRect(-v.w * 0.1, -v.h * 0.5 + 3, v.w * 0.5, 5);
  }

  // Headlights at night.
  if (night > 0.3 && !v.destroyed) {
    ctx.fillStyle = `rgba(255,242,200,${0.5 * night})`;
    ctx.beginPath();
    ctx.moveTo(v.w / 2, -v.h * 0.34);
    ctx.lineTo(v.w / 2 + 150, -v.h * 1.5);
    ctx.lineTo(v.w / 2 + 150, v.h * 1.5);
    ctx.lineTo(v.w / 2, v.h * 0.34);
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff4cc';
    ctx.fillRect(v.w / 2 - 4, -v.h * 0.38, 4, 7);
    ctx.fillRect(v.w / 2 - 4, v.h * 0.38 - 7, 4, 7);
  }

  // Brake lights.
  if (v.brakeInput > 0.1 || forwardSpeed(v) < -20) {
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(-v.w / 2, -v.h * 0.4, 4, 8);
    ctx.fillRect(-v.w / 2, v.h * 0.4 - 8, 4, 8);
  }

  ctx.restore();

  // Police lightbar.
  if (v.siren && !v.destroyed) {
    const blink = Math.floor(time * 6) % 2 === 0;
    ctx.save();
    ctx.translate(v.pos.x, v.pos.y);
    ctx.rotate(v.angle);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = blink ? '#3d7dff' : '#ff3d3d';
    ctx.fillRect(-6, -v.h * 0.5 - 2, 12, 5);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, Math.PI * 2);
    ctx.fillStyle = blink ? '#3d7dff' : '#ff3d3d';
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

function drawPed(ctx: CanvasRenderingContext2D, ped: Ped, time: number): void {
  if (ped.state === 'dead') {
    ctx.fillStyle = 'rgba(96,16,20,0.55)';
    ctx.beginPath();
    ctx.ellipse(ped.pos.x, ped.pos.y, 16, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b3b3b';
    ctx.beginPath();
    ctx.ellipse(ped.pos.x, ped.pos.y, 9, 6, ped.angle, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.save();
  ctx.translate(ped.pos.x, ped.pos.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2.5, 3, 9, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(ped.angle);

  // Walk bob.
  const bob = Math.sin(time * 9 + ped.id) * (Math.hypot(ped.vel.x, ped.vel.y) > 12 ? 1.4 : 0);

  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.ellipse(0, bob * 0.3, 9, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(2 + bob * 0.2, 0, 4.6, 0, Math.PI * 2);
  ctx.fill();

  if (ped.isCop || ped.missionTag) {
    ctx.strokeStyle = ped.isCop ? '#0e1b30' : '#3a0e14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, 2);
    ctx.lineTo(13, 3);
    ctx.stroke();
  }
  ctx.restore();

  if (ped.missionTag) {
    ctx.strokeStyle = 'rgba(255,90,90,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ped.pos.x, ped.pos.y, 17 + Math.sin(time * 5) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPlayerOnFoot(ctx: CanvasRenderingContext2D, state: GameState, time: number): void {
  const p = state.player;
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(3, 4, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Contrast ring so the avatar reads against asphalt and sidewalks.
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.stroke();

  ctx.rotate(p.aim);
  const moving = Math.hypot(p.vel.x, p.vel.y) > 20;
  const bob = Math.sin(time * (p.running ? 14 : 9)) * (moving ? 1.6 : 0);

  ctx.fillStyle = '#e8eef5';
  ctx.beginPath();
  ctx.ellipse(0, bob * 0.3, 12.5, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#243043';
  ctx.beginPath();
  ctx.ellipse(0, bob * 0.3, 11, 8.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e3b98f';
  ctx.beginPath();
  ctx.arc(3, 0, 5.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b222e';
  ctx.beginPath();
  ctx.arc(1, 0, 5.6, Math.PI * 0.55, Math.PI * 1.45);
  ctx.fill();

  const weapon = WEAPON_DEFS[p.weapon];
  if (!weapon.melee) {
    ctx.strokeStyle = '#20242c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(5, 3);
    ctx.lineTo(p.weapon === 'shotgun' ? 20 : p.weapon === 'smg' ? 17 : 14, 4);
    ctx.stroke();
  } else if (p.meleeSwing > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 22, -0.7, 0.7);
    ctx.stroke();
  }
  ctx.restore();

  // Aim guide for ranged weapons.
  if (!weapon.melee) {
    ctx.strokeStyle = 'rgba(255,220,140,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(p.pos.x + Math.cos(p.aim) * 22, p.pos.y + Math.sin(p.aim) * 22);
    ctx.lineTo(p.pos.x + Math.cos(p.aim) * 240, p.pos.y + Math.sin(p.aim) * 240);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (p.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${p.flash * 0.5})`;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}

const PICKUP_STYLE: Record<Pickup['kind'], { color: string; label: string }> = {
  health: { color: '#5ad46e', label: '+' },
  armor: { color: '#5aa8f0', label: '▲' },
  pistol: { color: '#e8d26a', label: 'P' },
  smg: { color: '#e8a06a', label: 'S' },
  shotgun: { color: '#e86a6a', label: 'F' },
  cash: { color: '#8ce07a', label: '$' },
};

function drawPickups(ctx: CanvasRenderingContext2D, state: GameState, vr: Rect, time: number): void {
  for (const pk of state.pickups) {
    if (pk.cooldown > 0) continue;
    if (pk.pos.x < vr.x - 60 || pk.pos.x > vr.x + vr.w + 60 || pk.pos.y < vr.y - 60 || pk.pos.y > vr.y + vr.h + 60) continue;
    const style = PICKUP_STYLE[pk.kind];
    const bob = Math.sin(time * 3 + pk.bob) * 3;
    ctx.save();
    ctx.translate(pk.pos.x, pk.pos.y + bob);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.rotate(time * 1.2);
    ctx.fillStyle = style.color;
    roundRect(ctx, -8, -8, 16, 16, 4);
    ctx.fill();
    ctx.rotate(-time * 1.2);
    ctx.fillStyle = '#101317';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.label, 0, 1);
    ctx.restore();
  }
}

function drawMarkers(ctx: CanvasRenderingContext2D, state: GameState, vr: Rect, time: number): void {
  const pulse = 0.6 + Math.sin(time * 3) * 0.25;

  // Mission contacts.
  if (!state.mission || state.mission.state !== 'active') {
    for (const lm of state.world.landmarks) {
      if (lm.kind !== 'contact') continue;
      if (lm.pos.x < vr.x - 80 || lm.pos.x > vr.x + vr.w + 80 || lm.pos.y < vr.y - 80 || lm.pos.y > vr.y + vr.h + 80) continue;
      ctx.save();
      ctx.translate(lm.pos.x, lm.pos.y);
      ctx.globalAlpha = 0.28 * pulse + 0.15;
      ctx.fillStyle = COLORS.blip;
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.blip;
      ctx.font = 'bold 26px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, -1);
      ctx.restore();
    }
  }

  const target = state.mission?.state === 'active' ? state.mission.target : null;
  if (target) {
    const radius = state.mission?.targetRadius ?? 70;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.globalAlpha = 0.2 + pulse * 0.2;
    ctx.fillStyle = '#f2a33c';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ffd28a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    const y = -radius * 0.4 - Math.abs(Math.sin(time * 2.4)) * 18;
    ctx.beginPath();
    ctx.moveTo(0, y + 26);
    ctx.lineTo(-14, y);
    ctx.lineTo(14, y);
    ctx.closePath();
    ctx.fillStyle = '#ffd28a';
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Mission vehicle highlight.
  if (state.mission?.state === 'active') {
    const mv = state.vehicles.find((v) => v.id === state.mission?.vehicleId);
    if (mv) {
      ctx.strokeStyle = 'rgba(255,190,90,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mv.pos.x, mv.pos.y, mv.w * 0.62 + Math.sin(time * 4) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const b of state.bullets) {
    const tx = b.pos.x - b.vel.x * 0.02;
    const ty = b.pos.y - b.vel.y * 0.02;
    ctx.strokeStyle = b.owner === 'player' ? 'rgba(255,236,170,0.95)' : 'rgba(255,150,120,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(b.pos.x, b.pos.y);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  for (const p of state.particles) {
    const t = clamp(p.life / p.maxLife, 0, 1);
    if (p.kind === 'text') {
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.size}px ui-monospace, monospace`;
      ctx.fillText(p.text ?? '', p.pos.x, p.pos.y);
      continue;
    }
    ctx.globalAlpha = p.kind === 'smoke' ? t * 0.45 : t;
    ctx.fillStyle = p.color;
    const size = p.kind === 'smoke' ? p.size * (2 - t) : p.size;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Main pass
// ---------------------------------------------------------------------------

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: Viewport,
  scratch: Collider[],
): void {
  const cam = state.camera;
  const night = nightAmount(state);
  const time = state.elapsed;
  const shakeX = cam.shake > 0 ? (state.rng() - 0.5) * cam.shake : 0;
  const shakeY = cam.shake > 0 ? (state.rng() - 0.5) * cam.shake : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#12151a';
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x + shakeX, -cam.y + shakeY);

  const vr = viewRect(state, view);
  vr.x -= 80;
  vr.y -= 80;
  vr.w += 160;
  vr.h += 160;

  drawGround(ctx, state, vr);
  drawPickups(ctx, state, vr, time);
  drawMarkers(ctx, state, vr, time);

  // Dead peds go under everything alive.
  for (const ped of state.peds) if (ped.state === 'dead') drawPed(ctx, ped, time);

  drawColliders(ctx, state, vr, night, scratch);

  for (const v of state.vehicles) {
    if (v.pos.x < vr.x - 120 || v.pos.x > vr.x + vr.w + 120 || v.pos.y < vr.y - 120 || v.pos.y > vr.y + vr.h + 120) continue;
    drawVehicle(ctx, v, night, time);
  }
  for (const ped of state.peds) {
    if (ped.state === 'dead') continue;
    if (ped.pos.x < vr.x - 60 || ped.pos.x > vr.x + vr.w + 60 || ped.pos.y < vr.y - 60 || ped.pos.y > vr.y + vr.h + 60) continue;
    drawPed(ctx, ped, time);
  }
  if (!state.player.vehicleId && !state.player.dead) drawPlayerOnFoot(ctx, state, time);

  drawEffects(ctx, state);
  ctx.restore();

  // Night grade.
  if (night > 0.02) {
    ctx.fillStyle = `rgba(12,18,38,${night * 0.5})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  // Wanted vignette.
  const wanted = wantedLevel(state);
  if (wanted > 0) {
    const g = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.32, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(120,10,20,${0.1 + wanted * 0.05})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  if (state.player.dead) {
    ctx.fillStyle = 'rgba(60,0,0,0.45)';
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

interface Blip {
  pos: Vec;
  color: string;
  size: number;
  label?: string;
}

function collectBlips(state: GameState): Blip[] {
  const blips: Blip[] = [];
  for (const lm of state.world.landmarks) {
    if (lm.kind === 'contact') {
      if (!state.mission || state.mission.state !== 'active') blips.push({ pos: lm.pos, color: COLORS.blip, size: 4, label: '$' });
    } else if (lm.kind === 'hospital') {
      blips.push({ pos: lm.pos, color: '#5ad46e', size: 3.5, label: 'H' });
    } else if (lm.kind === 'garage') {
      blips.push({ pos: lm.pos, color: '#9db4ff', size: 3.5, label: 'G' });
    } else {
      blips.push({ pos: lm.pos, color: '#e8d26a', size: 3, label: '•' });
    }
  }
  for (const v of state.vehicles) {
    if (v.driver === 'cop' && !v.destroyed) blips.push({ pos: v.pos, color: '#5aa8f0', size: 4 });
  }
  for (const p of state.peds) {
    if (p.isCop && p.state !== 'dead') blips.push({ pos: p.pos, color: '#5aa8f0', size: 3 });
    else if (p.missionTag && p.state !== 'dead') blips.push({ pos: p.pos, color: '#ff5a5a', size: 4 });
  }
  const mission = state.mission;
  if (mission?.state === 'active' && mission.target) {
    blips.push({ pos: mission.target, color: '#ffb23c', size: 5.5 });
  }
  return blips;
}

export function drawMinimap(ctx: CanvasRenderingContext2D, state: GameState, view: Viewport): void {
  const size = Math.round(Math.min(216, Math.max(140, view.w * 0.17)));
  const pad = 18;
  const cx = pad + size / 2;
  const cy = view.h - pad - size / 2;
  const worldSpan = 1500;
  const p = playerPos(state);
  const texture = state.world.mapTexture;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#161a20';
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);

  if (texture) {
    const scale = size / worldSpan;
    const texScale = texture.width / state.world.size;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale / texScale, scale / texScale);
    ctx.drawImage(texture, -p.x * texScale, -p.y * texScale);
    ctx.restore();
  }

  const toMap = (w: Vec): Vec => ({
    x: cx + (w.x - p.x) * (size / worldSpan),
    y: cy + (w.y - p.y) * (size / worldSpan),
  });

  for (const blip of collectBlips(state)) {
    const m = toMap(blip.pos);
    if (Math.hypot(m.x - cx, m.y - cy) > size / 2 - 4) continue;
    ctx.fillStyle = blip.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, blip.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player arrow.
  const vehicle = playerVehicle(state);
  const heading = vehicle ? vehicle.angle : state.player.aim;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading + Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3.5);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // Frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.stroke();

  // Mission waypoint arrow on the rim when off-map.
  const mission = state.mission;
  if (mission?.state === 'active' && mission.target) {
    const dx = mission.target.x - p.x;
    const dy = mission.target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d * (size / worldSpan) > size / 2 - 6) {
      const a = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (size / 2 - 10), cy + Math.sin(a) * (size / 2 - 10));
      ctx.rotate(a);
      ctx.fillStyle = '#ffb23c';
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, -5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(districtName(p).toUpperCase(), cx, cy + size / 2 + 14);
}

export function drawFullMap(ctx: CanvasRenderingContext2D, state: GameState, view: Viewport): void {
  const margin = 60;
  const size = Math.min(view.w, view.h) - margin * 2;
  const x0 = (view.w - size) / 2;
  const y0 = (view.h - size) / 2;
  const s = size / state.world.size;

  ctx.fillStyle = 'rgba(8,10,14,0.86)';
  ctx.fillRect(0, 0, view.w, view.h);

  if (state.world.mapTexture) {
    ctx.drawImage(state.world.mapTexture, x0, y0, size, size);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, size, size);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const blip of collectBlips(state)) {
    const x = x0 + blip.pos.x * s;
    const y = y0 + blip.pos.y * s;
    ctx.fillStyle = blip.color;
    ctx.beginPath();
    ctx.arc(x, y, blip.size + 1.5, 0, Math.PI * 2);
    ctx.fill();
    if (blip.label) {
      ctx.fillStyle = '#0d1014';
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.fillText(blip.label, x, y + 0.5);
    }
  }

  const p = playerPos(state);
  const vehicle = playerVehicle(state);
  ctx.save();
  ctx.translate(x0 + p.x * s, y0 + p.y * s);
  ctx.rotate((vehicle ? vehicle.angle : state.player.aim) + Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px ui-monospace, monospace';
  ctx.fillText('TAB / M per chiudere la mappa', view.w / 2, y0 + size + 26);
}

export function cameraTarget(state: GameState): { pos: Vec; zoom: number } {
  const vehicle = playerVehicle(state);
  if (vehicle) {
    const speed = speedOf(vehicle);
    const lead = 0.28;
    return {
      pos: { x: vehicle.pos.x + vehicle.vel.x * lead, y: vehicle.pos.y + vehicle.vel.y * lead },
      zoom: clamp(1.02 - speed / 2100, 0.62, 1.02),
    };
  }
  const p = state.player;
  return { pos: { x: p.pos.x, y: p.pos.y }, zoom: 1.16 };
}
