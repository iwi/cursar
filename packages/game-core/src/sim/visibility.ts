import type { GameConfig } from '../config';
import { type GameMap, TERRAIN, tileAt } from '../map/types';

/**
 * How far the player can see in a direction `angle` away from where they face.
 * An egg shape: `ahead` in front, `side` at 90 degrees, `back` behind.
 */
export function visionRange(vision: GameConfig['vision'], angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = c >= 0 ? vision.ahead : vision.back;
  return 1 / Math.sqrt((c / along) ** 2 + (s / vision.side) ** 2);
}

/** Whether the straight line between two points is clear of walls (used for vision and by enemies). */
export function lineOfSight(map: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  return !sightBlocked(map, x0, y0, x1, y1);
}

function sightBlocked(map: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(dist / 0.2);
  const endX = Math.floor(x1);
  const endY = Math.floor(y1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.floor(x0 + (x1 - x0) * t);
    const ty = Math.floor(y0 + (y1 - y0) * t);
    if (tx === endX && ty === endY) return false;
    if (TERRAIN[tileAt(map, tx, ty)]!.blocksSight) return true;
  }
  return false;
}

/**
 * Fills `out` (one byte per tile) with 1 for tiles the player can currently
 * see. Open tiles need a clear line of sight inside the vision shape; a wall
 * is seen when an open tile next to it is seen, so corridor walls look solid.
 *
 * This lives in the core, not the renderer, so a server can use the same
 * function to decide what each player is allowed to know.
 */
export function computeVisibility(
  map: GameMap,
  x: number,
  y: number,
  facing: number,
  vision: GameConfig['vision'],
  out: Uint8Array,
): void {
  out.fill(0);
  const reach = Math.ceil(Math.max(vision.ahead, vision.side, vision.back)) + 1;
  const x0 = Math.max(0, Math.floor(x) - reach);
  const x1 = Math.min(map.width - 1, Math.floor(x) + reach);
  const y0 = Math.max(0, Math.floor(y) - reach);
  const y1 = Math.min(map.height - 1, Math.floor(y) + reach);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (TERRAIN[tileAt(map, tx, ty)]!.blocksSight) continue;
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      const dist = Math.hypot(cx - x, cy - y);
      if (dist > 0.75) {
        if (dist > visionRange(vision, Math.atan2(cy - y, cx - x) - facing)) continue;
        if (sightBlocked(map, x, y, cx, cy)) continue;
      }
      out[ty * map.width + tx] = 1;
    }
  }

  // Second pass: walls bordering a visible open tile.
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!TERRAIN[tileAt(map, tx, ty)]!.blocksSight) continue;
      let seen = false;
      for (let oy = -1; oy <= 1 && !seen; oy++) {
        for (let ox = -1; ox <= 1 && !seen; ox++) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          if (out[ny * map.width + nx] === 1 && !TERRAIN[tileAt(map, nx, ny)]!.blocksSight) seen = true;
        }
      }
      if (seen) out[ty * map.width + tx] = 2;
    }
  }
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (out[ty * map.width + tx] === 2) out[ty * map.width + tx] = 1;
    }
  }
}
