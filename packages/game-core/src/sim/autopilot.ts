import { planRoute } from '../map/route';
import { type GameMap, Tile, isSolid } from '../map/types';
import { dangerAt, obstacleTime } from './obstacles';
import type { PlayerInput, RaceState } from './types';

/** Lets a computer player watch for obstacles: the race, and its speed as a share of a runner's top speed. */
export interface Caution {
  state: RaceState;
  speed: number;
}

/** How far ahead (seconds) a careful computer player looks, in steps of `LOOK_STEP`, and the berth it gives obstacles (tiles). */
const LOOK_AHEAD = 1;
const LOOK_STEP = 0.1;
/** Following the route only needs to be clear this far ahead: it is checked again every tick. */
const ROUTE_AHEAD = 0.5;
const BERTH = 0.2;
/** Routes keep at least this far (tiles) from a barrier's post, where the bar always sweeps. */
const POST_BERTH = 1.5;
/** A careful computer player that has not got any nearer its target for this long goes for it anyway, for `BOLD_SECONDS`. */
const STUCK_SECONDS = 4;
const BOLD_SECONDS = 1.5;

type Move = { mx: number; my: number };
const STAND: Move = { mx: 0, my: 0 };
const AXES: Move[] = [{ mx: 1, my: 0 }, { mx: -1, my: 0 }, { mx: 0, my: 1 }, { mx: 0, my: -1 }];

/**
 * A route-follower: it takes the shortest tour of the checkpoints and then the
 * finish, walking downhill on each target's distance field. Used by tests, the
 * client's demo mode and computer players.
 *
 * Given a `caution`, it also watches the obstacles (see `carefulMove`), and
 * its route keeps clear of barrier posts. Without this it would walk into the
 * same boulder on every attempt after a respawn. Caution has a limit: a runner
 * that has made no progress for a few seconds takes its chances, as a person
 * would, rather than waiting for ever.
 */
export function createAutopilot(
  map: GameMap,
): (p: { x: number; y: number; checkpoints: boolean[] }, sprint?: boolean, caution?: Caution) => PlayerInput {
  const routeMap = avoidPosts(map);
  const plan = planRoute(routeMap);
  let seq = 0;
  /** Per runner (one autopilot steers every computer player in a race): progress towards the current target. */
  const progress = new WeakMap<object, { target: number; best: number; at: number; boldUntil: number }>();

  /** The direction along the route from (x, y), towards the neighbouring tile nearest the target. */
  const routeDir = (dist: Int32Array, x: number, y: number): Move => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    // Off the route map (knocked next to a post): any open neighbour will do.
    let best = dist[ty * map.width + tx]! < 0 ? Infinity : dist[ty * map.width + tx]!;
    let targetX = tx;
    let targetY = ty;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (isSolid(routeMap, tx + dx, ty + dy)) continue;
      const d = dist[(ty + dy) * map.width + tx + dx]!;
      if (d >= 0 && d < best) {
        best = d;
        targetX = tx + dx;
        targetY = ty + dy;
      }
    }
    const mx = targetX + 0.5 - x;
    const my = targetY + 0.5 - y;
    const len = Math.hypot(mx, my) || 1;
    return { mx: mx / len, my: my / len };
  };

  return (p, sprint = false, caution) => {
    const next = plan.order.find((index) => !p.checkpoints[index]);
    const dist = plan.fields[next ?? map.checkpoints.length]!;
    const dir = routeDir(dist, p.x, p.y);
    if (caution && map.obstacles && map.obstacles.length > 0) {
      const now = obstacleTime(caution.state);
      const target = next ?? -1;
      let record = progress.get(p);
      if (!record || record.target !== target) {
        record = { target, best: Infinity, at: now, boldUntil: -1 };
        progress.set(p, record);
      }
      const left = dist[Math.floor(p.y) * map.width + Math.floor(p.x)]!;
      if (left >= 0 && left < record.best) {
        record.best = left;
        record.at = now;
      } else if (now - record.at > STUCK_SECONDS) {
        record.boldUntil = now + BOLD_SECONDS;
        record.at = now;
      }
      if (now >= record.boldUntil) {
        const move = carefulMove(map, caution, p, dist, (x, y) => routeDir(dist, x, y));
        if (move) return { seq: ++seq, mx: move.mx, my: move.my, sprint: false };
      }
    }
    return { seq: ++seq, mx: dir.mx, my: dir.my, sprint };
  };
}

/**
 * A short look ahead for computer players. Following the route is kept while
 * the next half second along it is clear of the obstacles' known motion
 * (returns null). Otherwise each other move (stand still, or step one of four
 * ways) is followed for a second, and the safe one that leaves the shortest
 * way on is taken; if none is safe, the one that is hit last.
 */
function carefulMove(
  map: GameMap,
  caution: Caution,
  p: { x: number; y: number },
  dist: Int32Array,
  follow: (x: number, y: number) => Move,
): Move | null {
  const { state } = caution;
  const now = obstacleTime(state);
  const pace = state.config.player.maxSpeed * caution.speed;

  /** Walks a move (or the route) ahead; returns when it is first in danger, and where it ends. */
  const walk = (move: Move | null, horizon: number) => {
    let x = p.x;
    let y = p.y;
    for (let t = LOOK_STEP; t <= horizon + 1e-9; t += LOOK_STEP) {
      const d = move ?? follow(x, y);
      const nx = x + d.mx * pace * LOOK_STEP;
      const ny = y + d.my * pace * LOOK_STEP;
      // Walls stop the walk (the half-width keeps clear of corners).
      if (!isSolid(map, Math.floor(nx + d.mx * 0.3), Math.floor(ny + d.my * 0.3))) {
        x = nx;
        y = ny;
      }
      if (dangerAt(state, now + t, x, y, BERTH)) return { hitAt: t, x, y };
    }
    return { hitAt: Infinity, x, y };
  };

  if (walk(null, ROUTE_AHEAD).hitAt === Infinity) return null;
  let best: Move = STAND;
  let bestScore = -Infinity;
  for (const move of [STAND, ...AXES]) {
    const { hitAt, x, y } = walk(move, LOOK_AHEAD);
    const left = dist[Math.floor(y) * map.width + Math.floor(x)]!;
    // Safe moves first, then the least distance left; unsafe moves by how late they are hit.
    const score = hitAt === Infinity ? 1e6 - (left >= 0 ? left : 1e5) : hitAt;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/** A copy of the map with the tiles round each barrier's post made solid (for planning only). */
function avoidPosts(map: GameMap): GameMap {
  const posts = (map.obstacles ?? []).filter((o) => o.kind === 'barrier');
  if (posts.length === 0) return map;
  const tiles = [...map.tiles];
  for (const o of posts) {
    for (let y = Math.floor(o.y - POST_BERTH); y <= Math.ceil(o.y + POST_BERTH); y++) {
      for (let x = Math.floor(o.x - POST_BERTH); x <= Math.ceil(o.x + POST_BERTH); x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (Math.hypot(x + 0.5 - o.x, y + 0.5 - o.y) <= POST_BERTH) tiles[y * map.width + x] = Tile.Wall;
      }
    }
  }
  return { ...map, tiles };
}
