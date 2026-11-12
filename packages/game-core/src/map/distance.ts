import { type GameMap, type Rect, isSolid } from './types';

/**
 * Walking distance (in tiles, 4-directional) from every tile to the nearest
 * tile of `target`. Unreachable tiles and walls are -1. Used for validation,
 * and later for race position and enemy pathfinding.
 */
export function distanceField(map: GameMap, target: Rect): Int32Array {
  const dist = new Int32Array(map.width * map.height).fill(-1);
  const queue: number[] = [];
  for (let y = Math.floor(target.y); y < target.y + target.h; y++) {
    for (let x = Math.floor(target.x); x < target.x + target.w; x++) {
      if (!isSolid(map, x, y)) {
        dist[y * map.width + x] = 0;
        queue.push(y * map.width + x);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const d = dist[i]! + 1;
    const visit = (nx: number, ny: number) => {
      if (isSolid(map, nx, ny)) return;
      const ni = ny * map.width + nx;
      if (dist[ni] !== -1) return;
      dist[ni] = d;
      queue.push(ni);
    };
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  return dist;
}
