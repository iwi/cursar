import type { GameConfig } from '../config';
import type { GameMap, Obstacle, Point } from '../map/types';
import { applyEffect } from './effects';
import { damage } from './health';
import { resolveWalls } from './movement';
import type { GameEvent, PlayerState, RaceState } from './types';

type Boulder = Extract<Obstacle, { kind: 'boulder' }>;
type Barrier = Extract<Obstacle, { kind: 'barrier' }>;
type Gate = Extract<Obstacle, { kind: 'gate' }>;

/**
 * The obstacles' clock, in seconds. It runs from the moment the race is
 * created (preview included, so obstacles move in the preview too) and stops
 * only while the race is paused.
 */
export function obstacleTime(state: RaceState): number {
  return state.tick / state.config.tickRate;
}

const cycle = (t: number, period: number, phase: number) => {
  const u = t / period + phase;
  return u - Math.floor(u);
};

/** Where a boulder is: it rolls from a to b and back at a steady speed, turning at each end. */
export function boulderPosition(config: GameConfig, o: Boulder, t: number): Point {
  const length = Math.hypot(o.bx - o.ax, o.by - o.ay);
  const oneWay = Math.max(0.1, length / config.obstacles.boulder.speed);
  const u = cycle(t, oneWay * 2, o.phase) * 2;
  const along = u <= 1 ? u : 2 - u;
  return { x: o.ax + (o.bx - o.ax) * along, y: o.ay + (o.by - o.ay) * along };
}

/** The barrier's angle in radians. The bar runs through the post, so it looks the same every half turn. */
export function barrierAngle(config: GameConfig, o: Barrier, t: number): number {
  return o.dir * Math.PI * 2 * cycle(t, config.obstacles.barrier.turnSeconds, o.phase);
}

/** The two ends of a barrier's bar. */
export function barrierEnds(config: GameConfig, o: Barrier, t: number): [Point, Point] {
  const a = barrierAngle(config, o, t);
  const dx = Math.cos(a) * config.obstacles.barrier.armLength;
  const dy = Math.sin(a) * config.obstacles.barrier.armLength;
  return [
    { x: o.x - dx, y: o.y - dy },
    { x: o.x + dx, y: o.y + dy },
  ];
}

/** Whether a gate is closed: each cycle it is open first, then closed. */
export function gateClosed(config: GameConfig, o: Gate, t: number): boolean {
  const { openSeconds, closedSeconds } = config.obstacles.gate;
  return cycle(t, openSeconds + closedSeconds, o.phase) * (openSeconds + closedSeconds) >= openSeconds;
}

/** A check for closed gates at a tile, or null when the map has no gates (so movement skips the work). */
export function closedGateCheck(map: GameMap, config: GameConfig, t: number): ((tx: number, ty: number) => boolean) | null {
  const closed = (map.obstacles ?? []).filter((o): o is Gate => o.kind === 'gate' && gateClosed(config, o, t));
  if (closed.length === 0) return null;
  return (tx, ty) => closed.some((g) => tx >= g.x && tx < g.x + g.w && ty >= g.y && ty < g.y + g.h);
}

/**
 * How far into an obstacle a runner at (x, y) is, which way out, and the
 * obstacle's nearest point, or null if they are clear of it. `margin` widens
 * the obstacle, for looking ahead.
 */
export function overlap(
  config: GameConfig,
  o: Obstacle,
  t: number,
  x: number,
  y: number,
  margin = 0,
): { nx: number; ny: number; depth: number; cx: number; cy: number } | null {
  const radius = config.player.radius + margin;
  let cx: number;
  let cy: number;
  let reach: number;
  if (o.kind === 'boulder') {
    const b = boulderPosition(config, o, t);
    cx = b.x;
    cy = b.y;
    reach = config.obstacles.boulder.radius + radius;
  } else if (o.kind === 'barrier') {
    const [a, b] = barrierEnds(config, o, t);
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const along = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
    cx = a.x + ex * along;
    cy = a.y + ey * along;
    reach = config.obstacles.barrier.thickness / 2 + radius;
  } else {
    return null;
  }
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= reach) return null;
  if (d < 1e-6) return { nx: 1, ny: 0, depth: reach, cx, cy };
  return { nx: dx / d, ny: dy / d, depth: reach - d, cx, cy };
}

/**
 * Knocks a runner: puts them at (x, y) moving away along (nx, ny), costs
 * `hearts`, then stuns them for `stunSeconds` (unless that sent them back to a
 * checkpoint). Obstacles and enemies then pass through them for a moment, so
 * the same one cannot hit again straight away. The caller reports what hit them.
 */
export function knock(
  state: RaceState,
  p: PlayerState,
  x: number,
  y: number,
  nx: number,
  ny: number,
  hearts: number,
  stunSeconds: number,
  events: GameEvent[],
  speed = state.config.obstacles.knockSpeed,
): void {
  const { map, config } = state;
  p.hitGuard = config.obstacles.hitGuardSeconds;
  const fromX = p.x;
  const fromY = p.y;
  p.x = x;
  p.y = y;
  p.vx = nx * speed;
  p.vy = ny * speed;
  resolveWalls(map, p, config.player.radius, fromX, fromY, closedGateCheck(map, config, obstacleTime(state)));
  const before = events.length;
  damage(config, p, hearts, events);
  const respawned = events.slice(before).some((e) => e.type === 'respawn');
  if (!respawned && stunSeconds > 0) applyEffect(config, p, 'stun', events, stunSeconds);
}

/** An obstacle hit: a heart and a short stun (see `knock`). */
function hit(state: RaceState, p: PlayerState, kind: Obstacle['kind'], x: number, y: number, nx: number, ny: number, events: GameEvent[]): void {
  events.push({ type: 'obstacleHit', playerId: p.id, kind });
  const { obstacles } = state.config;
  knock(state, p, x, y, nx, ny, obstacles.hitDamage, obstacles.hitStunSeconds, events);
}

/** Checks whether a boulder or barrier has hit the runner. */
export function hitObstacles(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  const { map, config } = state;
  if (!map.obstacles || map.obstacles.length === 0 || p.hitGuard > 0 || p.safeTime > 0 || p.finished) return;
  const t = obstacleTime(state);
  for (const o of map.obstacles) {
    const into = overlap(config, o, t, p.x, p.y);
    if (!into) continue;
    const out = into.depth + 0.05;
    hit(state, p, o.kind, p.x + into.nx * out, p.y + into.ny * out, into.nx, into.ny, events);
    return;
  }
}

/**
 * A gate that closes on a runner standing in it hurts them and throws them out
 * to the nearer side. Call before movement: a runner can only be inside a
 * closed gate if it closed on them (otherwise it is solid). Without a hit (the
 * guard or safe time), the walls code simply pushes them out.
 */
export function gateTraps(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  const { map, config } = state;
  if (!map.obstacles || p.hitGuard > 0 || p.safeTime > 0 || p.finished) return;
  const t = obstacleTime(state);
  const r = config.player.radius;
  for (const o of map.obstacles) {
    if (o.kind !== 'gate' || !gateClosed(config, o, t)) continue;
    const nearX = Math.max(o.x, Math.min(p.x, o.x + o.w));
    const nearY = Math.max(o.y, Math.min(p.y, o.y + o.h));
    // Clearly inside, not just pressed against it (walls leave a runner exactly `r` away).
    if (Math.hypot(p.x - nearX, p.y - nearY) >= r - 0.05) continue;
    // Out across the gate's thin side, whichever way is nearer.
    if (o.w <= o.h) {
      const side = p.x < o.x + o.w / 2 ? -1 : 1;
      hit(state, p, 'gate', side < 0 ? o.x - r - 0.05 : o.x + o.w + r + 0.05, p.y, side, 0, events);
    } else {
      const side = p.y < o.y + o.h / 2 ? -1 : 1;
      hit(state, p, 'gate', p.x, side < 0 ? o.y - r - 0.05 : o.y + o.h + r + 0.05, 0, side, events);
    }
    return;
  }
}

/**
 * For computer players: the first boulder or barrier that will be within
 * `margin` of (x, y) at time `t`, or a gate that will be closed there.
 * Returns where the danger is, or null.
 */
export function dangerAt(state: RaceState, t: number, x: number, y: number, margin: number): Point | null {
  const { config } = state;
  for (const o of state.map.obstacles ?? []) {
    if (o.kind === 'gate') {
      if (!gateClosed(config, o, t)) continue;
      const reach = config.player.radius + margin;
      if (x > o.x - reach && x < o.x + o.w + reach && y > o.y - reach && y < o.y + o.h + reach) return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
      continue;
    }
    const near = overlap(config, o, t, x, y, margin);
    if (near) return { x: near.cx, y: near.cy };
  }
  return null;
}
