import { distanceField } from './distance';
import { planRoute } from './route';
import { type GameMap, TERRAIN, isSolid } from './types';

export interface MapValidation {
  ok: boolean;
  errors: string[];
  /** Shortest walk from the first start position through every checkpoint to the finish, in tiles. */
  routeLength: number;
}

export function validateMap(map: GameMap): MapValidation {
  const errors: string[] = [];
  let routeLength = -1;

  if (map.schema !== 1) errors.push(`Unsupported map schema: ${String(map.schema)}`);
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 5 || map.height < 5) {
    errors.push('Map dimensions must be whole numbers of at least 5 tiles.');
  }
  if (map.tiles.length !== map.width * map.height) {
    errors.push(`Expected ${map.width * map.height} tiles, found ${map.tiles.length}.`);
    return { ok: false, errors, routeLength };
  }
  if (map.tiles.some((t) => TERRAIN[t] === undefined)) errors.push('Map contains unknown terrain codes.');
  if (map.startPositions.length === 0) errors.push('Map has no start positions.');
  if (map.finish.w <= 0 || map.finish.h <= 0) errors.push('Finish zone is empty.');
  if (errors.length > 0) return { ok: false, errors, routeLength };

  const dist = distanceField(map, map.finish);
  if (!dist.includes(0)) errors.push('Finish zone is entirely inside walls.');

  map.startPositions.forEach((p, i) => {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (isSolid(map, tx, ty)) errors.push(`Start position ${i + 1} is inside a wall.`);
    else if (dist[ty * map.width + tx]! < 0) errors.push(`Start position ${i + 1} cannot reach the finish.`);
  });
  map.checkpoints.forEach((c, i) => {
    let reachable = false;
    for (let y = Math.floor(c.y); y < c.y + c.h; y++) {
      for (let x = Math.floor(c.x); x < c.x + c.w; x++) {
        if (!isSolid(map, x, y) && dist[y * map.width + x]! >= 0) reachable = true;
      }
    }
    if (!reachable) errors.push(`Checkpoint ${i + 1} cannot be reached.`);
  });
  if (errors.length === 0) routeLength = planRoute(map).length;

  return { ok: errors.length === 0, errors, routeLength };
}
