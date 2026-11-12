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

/** How far into an obstacle the runner is, and which way out, or null if they are clear of it. */
function overlap(config: GameConfig, o: Obstacle, t: number, x: number, y: number): { nx: number; ny: number; depth: number } | null {
  const radius = config.player.radius;
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
  if (d < 1e-6) return { nx: 1, ny: 0, depth: reach };
  return { nx: dx / d, ny: dy / d, depth: reach - d };
}

/**
 * Checks whether a boulder or barrier has hit the runner. A hit costs hearts,
 * shoves the runner clear and stuns them briefly; then obstacles pass through
 * them for a moment so the same one cannot hit again straight away.
 */
export function hitObstacles(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  const { map, config } = state;
  if (!map.obstacles || map.obstacles.length === 0 || p.hitGuard > 0 || p.safeTime > 0 || p.finished) return;
  const t = obstacleTime(state);
  for (const o of map.obstacles) {
    const hit = overlap(config, o, t, p.x, p.y);
    if (!hit) continue;
    const { obstacles } = config;
    p.hitGuard = obstacles.hitGuardSeconds;
    events.push({ type: 'obstacleHit', playerId: p.id, kind: o.kind as 'boulder' | 'barrier' });
    const fromX = p.x;
    const fromY = p.y;
    p.x += hit.nx * (hit.depth + 0.05);
    p.y += hit.ny * (hit.depth + 0.05);
    p.vx = hit.nx * obstacles.knockSpeed;
    p.vy = hit.ny * obstacles.knockSpeed;
    resolveWalls(map, p, config.player.radius, fromX, fromY, closedGateCheck(map, config, t));
    const before = events.length;
    damage(config, p, obstacles.hitDamage, events);
    const respawned = events.slice(before).some((e) => e.type === 'respawn');
    if (!respawned) applyEffect(config, p, 'stun', events, obstacles.hitStunSeconds);
    return;
  }
}
