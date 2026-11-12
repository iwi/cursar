import type { GameConfig } from '../config';
import { type GameMap, TERRAIN, isSolid, tileAt } from '../map/types';
import { effectSpeedMul } from './effects';
import type { PlayerInput, PlayerState } from './types';

const TWO_PI = Math.PI * 2;

export function wrapAngle(a: number): number {
  a %= TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  return a;
}

/** Normalised movement vector: diagonals are no faster than straight lines. */
export function inputVector(input: PlayerInput): { mx: number; my: number; active: boolean } {
  let mx = Math.max(-1, Math.min(1, input.mx));
  let my = Math.max(-1, Math.min(1, input.my));
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  return { mx, my, active: len > 0.01 };
}

/**
 * Advances one player's velocity, position and facing by `dt`.
 * Returns the speed of the hardest wall impact this tick (0 if none).
 */
export function movePlayer(
  map: GameMap,
  config: GameConfig,
  p: PlayerState,
  input: PlayerInput,
  dt: number,
  /** Extra solid tiles, such as closed gates. */
  blocked: ((tx: number, ty: number) => boolean) | null = null,
): number {
  const { mx, my, active } = inputVector(input);
  const terrain = TERRAIN[tileAt(map, Math.floor(p.x), Math.floor(p.y))]!;
  const top =
    config.player.maxSpeed * terrain.speedMul * (p.sprinting ? config.sprint.speedMul : 1) * effectSpeedMul(config, p);

  // Steer the velocity toward the wanted velocity. On normal ground this is
  // near-instant; on low-grip terrain it becomes momentum and sliding.
  const wantX = mx * top;
  const wantY = my * top;
  const rate = (active ? config.player.accel : config.player.decel) * terrain.grip * dt;
  const dvx = wantX - p.vx;
  const dvy = wantY - p.vy;
  const gap = Math.hypot(dvx, dvy);
  if (gap <= rate || gap === 0) {
    p.vx = wantX;
    p.vy = wantY;
  } else {
    p.vx += (dvx / gap) * rate;
    p.vy += (dvy / gap) * rate;
  }

  const prevX = p.x;
  const prevY = p.y;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  const impact = resolveWalls(map, p, config.player.radius, prevX, prevY, blocked);

  // Facing follows the input direction, smoothed so the view never snaps.
  if (active) {
    const diff = wrapAngle(Math.atan2(my, mx) - p.facing);
    const maxTurn = config.player.turnRate * dt;
    p.facing = wrapAngle(p.facing + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }
  return impact;
}

/**
 * Pushes a circle out of solid tiles. Because the push is along the line from
 * the nearest point of the tile, the character slides round wall corners
 * instead of snagging on them.
 */
export function resolveWalls(
  map: GameMap,
  p: { x: number; y: number; vx: number; vy: number },
  radius: number,
  prevX: number,
  prevY: number,
  blocked: ((tx: number, ty: number) => boolean) | null = null,
): number {
  let impact = 0;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const x0 = Math.floor(p.x - radius);
    const x1 = Math.floor(p.x + radius);
    const y0 = Math.floor(p.y - radius);
    const y1 = Math.floor(p.y + radius);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isSolid(map, tx, ty) && !blocked?.(tx, ty)) continue;
        const nearX = Math.max(tx, Math.min(p.x, tx + 1));
        const nearY = Math.max(ty, Math.min(p.y, ty + 1));
        const dx = p.x - nearX;
        const dy = p.y - nearY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        if (d2 < 1e-12) {
          // Centre ended up inside a wall (should not happen at sane speeds): step back.
          p.x = prevX;
          p.y = prevY;
          p.vx = 0;
          p.vy = 0;
          return impact;
        }
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        p.x += nx * (radius - d);
        p.y += ny * (radius - d);
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) {
          impact = Math.max(impact, -vn);
          p.vx -= vn * nx;
          p.vy -= vn * ny;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return impact;
}
