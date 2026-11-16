import { planRoute } from '../map/route';
import { Rng, hashString } from '../rng';
import { type GameMap, Tile, isSolid } from '../map/types';
import { patrollerDanger } from './enemies';
import { dangerAt, obstacleTime } from './obstacles';
import type { PlayerInput, RaceState } from './types';

/** Lets a computer player watch for obstacles: the race, and its speed as a share of a runner's top speed. */
export interface Caution {
  state: RaceState;
  speed: number;
  /**
   * The chance, at each fork it reaches, that the runner loses track and takes
   * a wrong branch for a while (see `wrongTurn`). Leave out for none.
   */
  mistakes?: number;
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
 * A route-follower: it takes the shortest tour of the checkpoints (and keys,
 * when the map has doors) and then the finish, walking downhill on each target's distance field. Used by tests, the
 * client's demo mode and computer players.
 *
 * Its route steps round traps. Given a `caution`, it also watches the
 * obstacles (see `carefulMove`), and its route keeps clear of barrier posts. Without this it would walk into the
 * same boulder on every attempt after a respawn. Caution has a limit: a runner
 * that has made no progress for a few seconds takes its chances, as a person
 * would, rather than waiting for ever.
 */
export function createAutopilot(
  map: GameMap,
): (p: { id?: string; x: number; y: number; checkpoints: boolean[]; keys?: boolean[] }, sprint?: boolean, caution?: Caution) => PlayerInput {
  const routeMap = avoidPosts(map);
  const plan = planRoute(routeMap);
  let seq = 0;
  /** Per runner (one autopilot steers every computer player in a race): progress towards the current target. */
  const progress = new WeakMap<object, { target: number; best: number; at: number; boldUntil: number }>();
  /** Per runner: its wrong turns (see `wrongTurn`). */
  const lost = new WeakMap<object, Lost>();

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
    const step = plan.steps.findIndex((s) => (s.kind === 'checkpoint' ? !p.checkpoints[s.index] : !p.keys?.[s.index]));
    const dist = step >= 0 ? plan.steps[step]!.field : plan.finish;
    const next = step >= 0 ? step : undefined;
    const dir = routeDir(dist, p.x, p.y);
    if (caution?.mistakes) {
      let record = lost.get(p);
      if (!record) {
        record = { rng: new Rng(hashString(`${map.id}:${p.id ?? ''}`)), tile: -1, wrong: null, until: 0, pauseUntil: 0, calmUntil: 0 };
        lost.set(p, record);
      }
      const move = wrongTurn(routeMap, caution, record, p, dist, dir);
      // Lost, but not blind: heading into an obstacle or an enemy's way ends it at once.
      if (move && clearAhead(map, caution, p, move)) return { seq: ++seq, mx: move.mx, my: move.my, sprint: false };
      if (move) {
        record.wrong = null;
        record.pauseUntil = 0;
      }
    }
    if (caution && (map.obstacles?.length || map.enemies?.length)) {
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

/** Whether keeping to `move` for the next `ROUTE_AHEAD` seconds is clear of the obstacles' and patrollers' known motion. */
function clearAhead(map: GameMap, caution: Caution, p: { x: number; y: number }, move: Move): boolean {
  const { state } = caution;
  const now = obstacleTime(state);
  const pace = state.config.player.maxSpeed * caution.speed;
  let { x, y } = p;
  for (let t = 0; t <= ROUTE_AHEAD + 1e-9; t += LOOK_STEP) {
    if (dangerAt(state, now + t, x, y, BERTH) || patrollerDanger(state, now + t, x, y, BERTH)) return false;
    const nx = x + move.mx * pace * LOOK_STEP;
    const ny = y + move.my * pace * LOOK_STEP;
    if (!isSolid(map, Math.floor(nx + move.mx * 0.3), Math.floor(ny + move.my * 0.3))) {
      x = nx;
      y = ny;
    }
  }
  return true;
}

/** A runner's wrong turns: the branch it is wrongly following, and until when. */
interface Lost {
  rng: Rng;
  /** The tile it was last on, so each fork is considered once per visit. */
  tile: number;
  /** The way it is wrongly heading, or null when on track. */
  wrong: Move | null;
  until: number;
  /** Standing still, realising it went wrong. */
  pauseUntil: number;
  /** No new wrong turn before this. */
  calmUntil: number;
}

/**
 * Computer players now and then lose track of the route, as people do. At a
 * fork (a way on that leads further from the target and does not turn back),
 * with the chance `caution.mistakes`, a runner takes that branch and keeps
 * going away from its target, for up to `config.bots.wrongSeconds` or until a
 * dead end; it stops for a moment (`realiseSeconds`), then follows the route
 * again, which brings it back. Returns the move while it is lost, or null when
 * on track. Seeded per map and runner, so a race plays out the same each time.
 */
function wrongTurn(map: GameMap, caution: Caution, r: Lost, p: { x: number; y: number }, dist: Int32Array, dir: Move): Move | null {
  const cfg = caution.state.config.bots;
  const now = obstacleTime(caution.state);
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const here = ty * map.width + tx;
  const cur = dist[here]!;
  if (now < r.pauseUntil) return STAND;
  if (cur < 0) return null;
  /** Open neighbours further from the target, as moves towards their centres. */
  const away = (): (Move & { tile: number })[] => {
    const out: (Move & { tile: number })[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (isSolid(map, tx + dx, ty + dy)) continue;
      const d = dist[(ty + dy) * map.width + tx + dx]!;
      if (d > cur) out.push({ mx: dx, my: dy, tile: (ty + dy) * map.width + tx + dx });
    }
    return out;
  };
  if (r.wrong) {
    const ways = away();
    if (now >= r.until || ways.length === 0) {
      // Realises: stops, then the route brings it back.
      r.wrong = null;
      r.pauseUntil = now + cfg.realiseSeconds;
      r.calmUntil = now + cfg.calmSeconds;
      return STAND;
    }
    // Keep on the way it was going, as far as the branch allows.
    let best = ways[0]!;
    for (const w of ways) if (w.mx * r.wrong.mx + w.my * r.wrong.my > best.mx * r.wrong.mx + best.my * r.wrong.my) best = w;
    if (here !== r.tile) {
      r.tile = here;
      r.wrong = { mx: best.mx, my: best.my };
    }
    const tileX = (best.tile % map.width) + 0.5;
    const tileY = Math.floor(best.tile / map.width) + 0.5;
    const len = Math.hypot(tileX - p.x, tileY - p.y) || 1;
    return { mx: (tileX - p.x) / len, my: (tileY - p.y) / len };
  }
  if (here === r.tile) return null;
  r.tile = here;
  if (now < r.calmUntil) return null;
  // A fork: a way further from the target that is not straight back.
  const forks = away().filter((w) => w.mx * dir.mx + w.my * dir.my > -0.5);
  if (forks.length === 0 || !r.rng.chance(caution.mistakes!)) return null;
  const pick = r.rng.pick(forks);
  r.wrong = { mx: pick.mx, my: pick.my };
  r.until = now + cfg.wrongSeconds * (0.5 + 0.5 * r.rng.next());
  return null;
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
      if (dangerAt(state, now + t, x, y, BERTH) || patrollerDanger(state, now + t, x, y, BERTH)) return { hitAt: t, x, y };
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

/**
 * A copy of the map for planning only, with trap tiles (computer players know
 * the map) and the tiles round each barrier's post made solid.
 */
function avoidPosts(map: GameMap): GameMap {
  const posts = (map.obstacles ?? []).filter((o) => o.kind === 'barrier');
  if (posts.length === 0 && !map.traps?.length) return map;
  const tiles = [...map.tiles];
  for (const trap of map.traps ?? []) tiles[trap.y * map.width + trap.x] = Tile.Wall;
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
