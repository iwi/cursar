import { type GameMap, type Rect, isSolid, lockedDoors } from './types';
import { distanceField } from './distance';

/** First open tile inside a zone, as a tile index, or -1 if the zone is all wall. */
function anchorTile(map: GameMap, zone: Rect): number {
  for (let y = Math.floor(zone.y); y < zone.y + zone.h; y++) {
    for (let x = Math.floor(zone.x); x < zone.x + zone.w; x++) {
      if (!isSolid(map, x, y)) return y * map.width + x;
    }
  }
  return -1;
}

/** One stop on the route: a checkpoint to touch or a key to pick up, with the distance field that leads there. */
export interface RouteStep {
  kind: 'checkpoint' | 'key';
  index: number;
  field: Int32Array;
}

export interface RoutePlan {
  /** Checkpoint indices in the shortest visiting order. */
  order: number[];
  /** Every stop in order (keys included, when the map has doors). */
  steps: RouteStep[];
  /** The field to the finish once every stop is done. */
  finish: Int32Array;
  /** Walking distance in tiles: start, every stop, finish. -1 if impossible. */
  length: number;
}

/** The tile a key lies on, as a 1x1 zone. */
export function keyZone(map: GameMap, index: number): Rect {
  const k = map.doors![index]!.key;
  return { x: Math.floor(k.x), y: Math.floor(k.y), w: 1, h: 1 };
}

/**
 * Shortest way to touch every checkpoint (in any order) and then reach the
 * finish, starting from the first start position. On a map with doors, every
 * key is a stop too, and a door can only be passed once its key is held.
 */
export function planRoute(map: GameMap): RoutePlan {
  const n = map.checkpoints.length;
  const k = map.doors?.length ?? 0;
  const zones = [...map.checkpoints, ...Array.from({ length: k }, (_, i) => keyZone(map, i))];
  const full = (1 << k) - 1;

  // Distance fields per target and set of keys held, made when first needed.
  const cache = new Map<number, Int32Array>();
  const keysOf = (mask: number) => Array.from({ length: k }, (_, i) => (mask & (1 << i)) !== 0);
  /** `target` is a stop (0..n+k-1) or n+k for the finish. */
  const field = (target: number, mask: number) => {
    const id = target * 64 + mask;
    let f = cache.get(id);
    if (!f) {
      f = distanceField(map, target === n + k ? map.finish : zones[target]!, lockedDoors(map, keysOf(mask)));
      cache.set(id, f);
    }
    return f;
  };

  const start = map.startPositions[0];
  const startTile = start ? Math.floor(start.y) * map.width + Math.floor(start.x) : -1;
  const anchors = zones.map((z) => anchorTile(map, z));
  if (startTile < 0 || anchors.includes(-1)) return { order: [], steps: [], finish: field(n + k, full), length: -1 };

  const stops = n + k;
  const dist = (from: number, to: number, mask: number) => field(to, mask)[from < 0 ? startTile : anchors[from]!]!;
  const pick = (stop: number, mask: number) => (stop >= n ? mask | (1 << (stop - n)) : mask);

  let bestOrder: number[] = [];
  let bestLength = -1;
  const order: number[] = [];
  const used = new Array<boolean>(stops).fill(false);
  const search = (last: number, mask: number, soFar: number) => {
    if (bestLength >= 0 && soFar >= bestLength) return;
    if (order.length === stops) {
      const end = dist(last, n + k, mask);
      if (end >= 0 && (bestLength < 0 || soFar + end < bestLength)) {
        bestLength = soFar + end;
        bestOrder = [...order];
      }
      return;
    }
    for (let i = 0; i < stops; i++) {
      if (used[i]) continue;
      const leg = dist(last, i, mask);
      if (leg < 0) continue;
      used[i] = true;
      order.push(i);
      search(i, pick(i, mask), soFar + leg);
      order.pop();
      used[i] = false;
    }
  };
  // Exhaustive search is fine for the handful of stops a map has.
  if (stops <= 8) {
    search(-1, 0, 0);
  } else {
    let last = -1;
    let mask = 0;
    let total = 0;
    for (let s = 0; s < stops && total >= 0; s++) {
      let next = -1;
      for (let i = 0; i < stops; i++) {
        if (!used[i] && dist(last, i, mask) >= 0 && (next < 0 || dist(last, i, mask) < dist(last, next, mask))) next = i;
      }
      if (next < 0) {
        total = -1;
        break;
      }
      total += dist(last, next, mask);
      used[next] = true;
      order.push(next);
      mask = pick(next, mask);
      last = next;
    }
    const end = total >= 0 ? dist(last, n + k, mask) : -1;
    bestLength = end >= 0 ? total + end : -1;
    bestOrder = bestLength >= 0 ? [...order] : [];
  }

  const steps: RouteStep[] = [];
  let mask = 0;
  for (const stop of bestOrder) {
    steps.push(stop < n ? { kind: 'checkpoint', index: stop, field: field(stop, mask) } : { kind: 'key', index: stop - n, field: field(stop, mask) });
    mask = pick(stop, mask);
  }
  return { order: bestOrder.filter((s) => s < n), steps, finish: field(n + k, full), length: bestLength };
}
