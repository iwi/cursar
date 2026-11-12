import { type GameMap, type Rect, isSolid } from './types';
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

export interface RoutePlan {
  /** Checkpoint indices in the shortest visiting order. */
  order: number[];
  /** Walking distance in tiles: start, every checkpoint, finish. -1 if impossible. */
  length: number;
  /** Distance-to-zone field for each checkpoint, then the finish last. */
  fields: Int32Array[];
}

/**
 * Shortest way to touch every checkpoint (in any order) and then reach the
 * finish, starting from the first start position.
 */
export function planRoute(map: GameMap): RoutePlan {
  const fields = [...map.checkpoints.map((c) => distanceField(map, c)), distanceField(map, map.finish)];
  const n = map.checkpoints.length;
  const start = map.startPositions[0];
  const startTile = start ? Math.floor(start.y) * map.width + Math.floor(start.x) : -1;
  const anchors = map.checkpoints.map((c) => anchorTile(map, c));
  if (startTile < 0 || anchors.includes(-1)) return { order: [], length: -1, fields };

  // dist(from, to): `from` is -1 for the start or a checkpoint index; `to` is a checkpoint index or n for the finish.
  const dist = (from: number, to: number) => fields[to]![from < 0 ? startTile : anchors[from]!]!;

  let bestOrder: number[] = [];
  let bestLength = -1;
  const order: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const search = (last: number, soFar: number) => {
    if (bestLength >= 0 && soFar >= bestLength) return;
    if (order.length === n) {
      const end = dist(last, n);
      if (end >= 0 && (bestLength < 0 || soFar + end < bestLength)) {
        bestLength = soFar + end;
        bestOrder = [...order];
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const leg = dist(last, i);
      if (leg < 0) continue;
      used[i] = true;
      order.push(i);
      search(i, soFar + leg);
      order.pop();
      used[i] = false;
    }
  };
  // Exhaustive search is fine for the handful of checkpoints a map has.
  if (n <= 8) {
    search(-1, 0);
  } else {
    let last = -1;
    let total = 0;
    for (let k = 0; k < n && total >= 0; k++) {
      let pick = -1;
      for (let i = 0; i < n; i++) {
        if (!used[i] && dist(last, i) >= 0 && (pick < 0 || dist(last, i) < dist(last, pick))) pick = i;
      }
      if (pick < 0) {
        total = -1;
        break;
      }
      total += dist(last, pick);
      used[pick] = true;
      order.push(pick);
      last = pick;
    }
    const end = total >= 0 ? dist(last, n) : -1;
    bestLength = end >= 0 ? total + end : -1;
    bestOrder = bestLength >= 0 ? [...order] : [];
  }
  return { order: bestOrder, length: bestLength, fields };
}
