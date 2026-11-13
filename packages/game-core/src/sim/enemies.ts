import type { GameConfig } from '../config';
import { distanceField } from '../map/distance';
import { type EnemySpawn, type GameMap, type Point, isSolid } from '../map/types';
import { applyEffect } from './effects';
import { resolveWalls } from './movement';
import { closedGateCheck, knock, obstacleTime } from './obstacles';
import { wakeRange } from './skills';
import { lineOfSight } from './visibility';
import type { ChaserState, FoeSound, FoeState, GameEvent, PlayerState, RaceState, TurretState } from './types';

type Patroller = Extract<EnemySpawn, { kind: 'patroller' }>;

/** How often (seconds) a chasing chaser growls, and a sleeping one snores. */
const GROWL_EVERY = 0.7;
const SNORE_EVERY = 2.5;
/** A returning chaser walks home at this share of its chasing speed. */
const RETURN_PACE = 0.6;

/** The starting state of each map enemy (null for patrollers, which follow the clock). */
export function createFoes(map: GameMap): (FoeState | null)[] {
  return (map.enemies ?? []).map((e, index): FoeState | null => {
    if (e.kind === 'chaser') {
      // Snores staggered by index, so the race stays the same every time it is run.
      return { kind: 'chaser', x: e.x, y: e.y, facing: Math.PI / 2, mode: 'sleep', target: null, lastX: e.x, lastY: e.y, timer: 0, cue: (index % 5) * 0.5, stun: 0 };
    }
    if (e.kind === 'turret') return { kind: 'turret', aim: 0, target: null, charge: -1, reload: 0 };
    return null;
  });
}

/** The length of a patroller's beat (tiles). */
function beatLength(e: Patroller): number {
  let length = 0;
  for (let i = 1; i < e.path.length; i++) length += Math.hypot(e.path[i]!.x - e.path[i - 1]!.x, e.path[i]!.y - e.path[i - 1]!.y);
  return length;
}

/**
 * Where a patroller is and which way it faces: it walks its beat to the end
 * and back at a steady pace, turning the corners on the way.
 */
export function patrollerPose(config: GameConfig, e: Patroller, t: number): Point & { heading: number } {
  const length = beatLength(e);
  const first = e.path[0]!;
  if (e.path.length < 2 || length < 1e-6) return { x: first.x, y: first.y, heading: 0 };
  const oneWay = length / config.enemies.patroller.speed;
  const u = t / (oneWay * 2) + e.phase;
  const v = (u - Math.floor(u)) * 2;
  const back = v > 1;
  let left = (back ? 2 - v : v) * length;
  for (let i = 1; i < e.path.length; i++) {
    const a = e.path[i - 1]!;
    const b = e.path[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === e.path.length - 1) {
      const k = seg > 0 ? Math.min(1, left / seg) : 0;
      const heading = back ? Math.atan2(a.y - b.y, a.x - b.x) : Math.atan2(b.y - a.y, b.x - a.x);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading };
    }
    left -= seg;
  }
  return { x: first.x, y: first.y, heading: 0 };
}

/** Where a patroller is at time `t`. */
export function patrollerPosition(config: GameConfig, e: Patroller, t: number): Point {
  const { x, y } = patrollerPose(config, e, t);
  return { x, y };
}

/** A patroller that will be within `margin` of (x, y) at time `t`, for computer players looking ahead. */
export function patrollerDanger(state: RaceState, t: number, x: number, y: number, margin: number): Point | null {
  const reach = state.config.enemies.patroller.radius + state.config.player.radius + margin;
  for (const e of state.map.enemies ?? []) {
    if (e.kind !== 'patroller') continue;
    const at = patrollerPosition(state.config, e, t);
    if (Math.hypot(at.x - x, at.y - y) < reach) return at;
  }
  return null;
}

/**
 * Patrollers are on a schedule, so a runner's own page can predict touching
 * one: this runs inside `stepPlayer`. A touch costs a heart and a shove.
 */
export function hitPatrollers(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  const { map, config } = state;
  if (!map.enemies || p.hitGuard > 0 || p.safeTime > 0 || p.finished) return;
  const t = obstacleTime(state);
  const reach = config.enemies.patroller.radius + config.player.radius;
  for (const e of map.enemies) {
    if (e.kind !== 'patroller') continue;
    const at = patrollerPosition(config, e, t);
    const dx = p.x - at.x;
    const dy = p.y - at.y;
    const d = Math.hypot(dx, dy);
    if (d >= reach) continue;
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    events.push({ type: 'enemyHit', playerId: p.id, kind: 'patroller' });
    knock(state, p, at.x + nx * (reach + 0.05), at.y + ny * (reach + 0.05), nx, ny, config.obstacles.hitDamage, 0, events);
    return;
  }
}

/** Runners an enemy may notice: still racing and not in their safe time. */
function quarry(state: RaceState): PlayerState[] {
  return state.players.filter((p) => !p.finished && p.safeTime <= 0);
}

/** A runner an enemy can go after. */
interface Target {
  id: string;
  x: number;
  y: number;
  player: PlayerState;
}

/**
 * What an enemy at (x, y) goes after, among what it can see within range:
 * the runner with the highest threat, then the nearest. `range` may depend on the runner.
 */
function chooseTarget(state: RaceState, x: number, y: number, range: (p: PlayerState) => number): Target | null {
  let best: Target | null = null;
  let bestRank = -1;
  let bestDist = Infinity;
  const consider = (target: Target, rank: number, reach: number) => {
    const d = Math.hypot(target.x - x, target.y - y);
    if (d > reach || !lineOfSight(state.map, x, y, target.x, target.y)) return;
    if (rank > bestRank || (rank === bestRank && d < bestDist)) {
      best = target;
      bestRank = rank;
      bestDist = d;
    }
  };
  for (const p of quarry(state)) consider({ id: p.id, x: p.x, y: p.y, player: p }, p.threat, range(p));
  return best;
}

/** Finds a target again by id, or null if it is gone (finished or safe). */
function findTarget(state: RaceState, id: string | null): Target | null {
  if (!id) return null;
  const p = quarry(state).find((pl) => pl.id === id);
  return p ? { id, x: p.x, y: p.y, player: p } : null;
}

/** Walking-distance fields to each chaser's home, worked out once per map. */
const homeFields = new WeakMap<GameMap, Map<number, Int32Array>>();
function homeField(map: GameMap, index: number, home: Point): Int32Array {
  let fields = homeFields.get(map);
  if (!fields) homeFields.set(map, (fields = new Map()));
  let field = fields.get(index);
  if (!field) {
    field = distanceField(map, { x: Math.floor(home.x) - 1, y: Math.floor(home.y) - 1, w: 2, h: 2 });
    fields.set(index, field);
  }
  return field;
}

/** Moves a chaser towards (tx, ty) at `speed`, sliding along walls and stopping at closed gates. */
function moveChaser(state: RaceState, c: ChaserState, tx: number, ty: number, speed: number, dt: number): void {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return;
  const step = Math.min(d, speed * dt);
  const body = { x: c.x + (dx / d) * step, y: c.y + (dy / d) * step, vx: (dx / d) * speed, vy: (dy / d) * speed };
  resolveWalls(state.map, body, state.config.enemies.chaser.radius, c.x, c.y, closedGateCheck(state.map, state.config, obstacleTime(state)));
  c.x = body.x;
  c.y = body.y;
  c.facing = Math.atan2(dy, dx);
}

function stepChaser(state: RaceState, index: number, home: Point, c: ChaserState, dt: number, events: GameEvent[]): void {
  const { config, map } = state;
  const cfg = config.enemies.chaser;
  const cue = (sound: FoeSound) => events.push({ type: 'foeCue', index, sound });

  // Shoved: it stands dazed, then walks home to rest.
  if (c.stun > 0) {
    c.stun = Math.max(0, c.stun - dt);
    return;
  }

  if (c.mode === 'sleep') {
    c.cue -= dt;
    if (c.cue <= 0) {
      c.cue = SNORE_EVERY;
      cue('snore');
    }
    // Still resting after a catch: it does not wake yet.
    c.timer = Math.max(0, c.timer - dt);
    if (c.timer > 0) return;
    const prey = chooseTarget(state, c.x, c.y, (p) => wakeRange(config, p));
    if (prey) {
      c.mode = 'chase';
      c.target = prey.id;
      c.lastX = prey.x;
      c.lastY = prey.y;
      c.timer = cfg.giveUpSeconds;
      c.cue = GROWL_EVERY;
      cue('wake');
    }
    return;
  }

  if (c.mode === 'chase') {
    const prey = findTarget(state, c.target);
    if (!prey) {
      goHome(c, 0);
      return;
    }
    const dist = Math.hypot(prey.x - c.x, prey.y - c.y);
    if (dist <= cfg.sightRange && lineOfSight(map, c.x, c.y, prey.x, prey.y)) {
      c.lastX = prey.x;
      c.lastY = prey.y;
      c.timer = cfg.giveUpSeconds;
    } else {
      c.timer -= dt;
      if (c.timer <= 0) {
        goHome(c, 0);
        return;
      }
    }
    moveChaser(state, c, c.lastX, c.lastY, cfg.speed, dt);
    c.cue -= dt;
    if (c.cue <= 0) {
      c.cue = GROWL_EVERY;
      cue('growl');
    }
    // Caught: a heart and a stun, then it rests and walks home.
    const reach = cfg.radius + config.player.radius;
    const gap = Math.hypot(prey.x - c.x, prey.y - c.y);
    if (gap < reach && prey.player.hitGuard <= 0) {
      const nx = gap > 1e-6 ? (prey.x - c.x) / gap : Math.cos(c.facing);
      const ny = gap > 1e-6 ? (prey.y - c.y) / gap : Math.sin(c.facing);
      events.push({ type: 'enemyHit', playerId: prey.id, kind: 'chaser' });
      knock(state, prey.player, c.x + nx * (reach + 0.05), c.y + ny * (reach + 0.05), nx, ny, config.obstacles.hitDamage, cfg.stunSeconds, events);
      goHome(c, cfg.restSeconds);
    }
    return;
  }

  // Returning: walk home along the shortest way; once rested, a runner in sight wakes it again.
  c.timer -= dt;
  if (c.timer <= 0) {
    const prey = chooseTarget(state, c.x, c.y, (p) => wakeRange(config, p));
    if (prey) {
      c.mode = 'chase';
      c.target = prey.id;
      c.lastX = prey.x;
      c.lastY = prey.y;
      c.timer = cfg.giveUpSeconds;
      cue('wake');
      return;
    }
  }
  if (Math.hypot(home.x - c.x, home.y - c.y) < 0.3) {
    // Home: asleep again (any rest left carries on while it sleeps).
    c.mode = 'sleep';
    c.target = null;
    c.cue = SNORE_EVERY;
    c.timer = Math.max(0, c.timer);
    return;
  }
  const field = homeField(map, index, home);
  const tx = Math.floor(c.x);
  const ty = Math.floor(c.y);
  let best = field[ty * map.width + tx]!;
  let goal: Point = home;
  if (best > 0) {
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (isSolid(map, tx + ox, ty + oy)) continue;
      const d = field[(ty + oy) * map.width + tx + ox]!;
      if (d >= 0 && d < best) {
        best = d;
        goal = { x: tx + ox + 0.5, y: ty + oy + 0.5 };
      }
    }
  }
  moveChaser(state, c, goal.x, goal.y, cfg.speed * RETURN_PACE, dt);
}

export function goHome(c: ChaserState, rest: number): void {
  c.mode = 'return';
  c.target = null;
  c.timer = rest;
}

function stepTurret(state: RaceState, index: number, at: Point, tu: TurretState, dt: number, events: GameEvent[]): void {
  const cfg = state.config.enemies.turret;
  tu.reload = Math.max(0, tu.reload - dt);
  const prey = chooseTarget(state, at.x, at.y, () => cfg.range);
  tu.target = prey?.id ?? null;
  if (!prey) {
    tu.charge = -1;
    return;
  }
  const want = Math.atan2(prey.y - at.y, prey.x - at.x);
  let diff = want - tu.aim;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const turn = cfg.turnRate * dt;
  tu.aim += Math.max(-turn, Math.min(turn, diff));
  if (tu.charge < 0) {
    if (tu.reload <= 0 && Math.abs(diff) < 0.2) {
      tu.charge = cfg.chargeSeconds;
      events.push({ type: 'foeCue', index, sound: 'whir' });
    }
    return;
  }
  tu.charge -= dt;
  if (tu.charge > 0) return;
  tu.charge = -1;
  tu.reload = cfg.reloadSeconds;
  state.bolts.push({
    id: state.nextBoltId++,
    x: at.x + Math.cos(tu.aim) * 0.5,
    y: at.y + Math.sin(tu.aim) * 0.5,
    vx: Math.cos(tu.aim) * cfg.boltSpeed,
    vy: Math.sin(tu.aim) * cfg.boltSpeed,
    life: (cfg.range + 2) / cfg.boltSpeed,
  });
  events.push({ type: 'foeCue', index, sound: 'fire' });
}

function stepBolts(state: RaceState, dt: number, events: GameEvent[]): void {
  const { map, config } = state;
  const cfg = config.enemies.turret;
  const gates = closedGateCheck(map, config, obstacleTime(state));
  const reach = cfg.boltRadius + config.player.radius;
  state.bolts = state.bolts.filter((b) => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    const tx = Math.floor(b.x);
    const ty = Math.floor(b.y);
    if (b.life <= 0 || isSolid(map, tx, ty) || gates?.(tx, ty)) return false;
    const struck = quarry(state).find((p) => Math.hypot(p.x - b.x, p.y - b.y) < reach);
    if (!struck) return true;
    events.push({ type: 'enemyHit', playerId: struck.id, kind: 'turret' });
    applyEffect(config, struck, 'slow', events, cfg.slowSeconds);
    return false;
  });
}

/** Moves chasers, turns and fires turrets, and flies bolts: one tick, during the race only. */
export function stepEnemies(state: RaceState, dt: number, events: GameEvent[]): void {
  const spawns = state.map.enemies;
  if (!spawns || spawns.length === 0) return;
  spawns.forEach((spawn, index) => {
    const foe = state.foes[index];
    if (!foe) return;
    if (foe.kind === 'chaser' && spawn.kind === 'chaser') stepChaser(state, index, spawn, foe, dt, events);
    else if (foe.kind === 'turret' && spawn.kind === 'turret') stepTurret(state, index, spawn, foe, dt, events);
  });
  stepBolts(state, dt, events);
}

/** Where an enemy is now (for sounds). */
export function foePosition(state: RaceState, index: number): Point | null {
  const spawn = state.map.enemies?.[index];
  if (!spawn) return null;
  if (spawn.kind === 'patroller') return patrollerPosition(state.config, spawn, obstacleTime(state));
  const foe = state.foes[index];
  if (foe?.kind === 'chaser') return { x: foe.x, y: foe.y };
  return { x: spawn.x, y: spawn.y };
}

/**
 * How one listener hears an enemy's sound: a direction and loudness, never a
 * position. Snores only carry a short way. Returns null when out of earshot.
 */
export function hearFoe(state: RaceState, cue: Extract<GameEvent, { type: 'foeCue' }>, listener: PlayerState): Extract<GameEvent, { type: 'foeHeard' }> | null {
  const at = foePosition(state, cue.index);
  if (!at) return null;
  const range = cue.sound === 'snore' ? 5 : state.config.enemies.hearingRange;
  const dist = Math.hypot(at.x - listener.x, at.y - listener.y);
  if (dist >= range) return null;
  const foe = state.foes[cue.index];
  const aimed = (foe?.kind === 'chaser' || foe?.kind === 'turret') && foe.target === listener.id;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    type: 'foeHeard',
    sound: cue.sound,
    pan: round(Math.max(-1, Math.min(1, (at.x - listener.x) / 6))),
    closeness: round(1 - dist / range),
    aimed,
  };
}
