import { type GameConfig, DEFAULT_CONFIG } from '../config';
import { type GameMap, inRect, isSolid, tileAt } from '../map/types';
import { clearEffects, controlledInput, tickEffects } from './effects';
import { movePlayer } from './movement';
import { closedGateCheck, gateTraps, hitObstacles, obstacleTime } from './obstacles';
import { springTraps } from './traps';
import { createFoes, hitPatrollers, stepEnemies } from './enemies';
import { type GameEvent, NO_INPUT, type PlayerInput, type PlayerState, type RaceState } from './types';

export interface PlayerSetup {
  id: string;
  name: string;
  color: number;
  /** Which start position to use. Defaults to the player's position in the list. */
  slot?: number;
}

export function previewSeconds(map: GameMap, config: GameConfig): number {
  const { previewBaseSeconds, previewSecondsPerTile, previewMaxSeconds } = config.race;
  return Math.min(previewMaxSeconds, Math.round(previewBaseSeconds + map.width * map.height * previewSecondsPerTile));
}

export function createRace(map: GameMap, players: PlayerSetup[], config: GameConfig = DEFAULT_CONFIG): RaceState {
  if (players.length > map.startPositions.length) {
    throw new Error(`Map has ${map.startPositions.length} start positions but ${players.length} players joined.`);
  }
  const cx = map.width / 2;
  const cy = map.height / 2;
  return {
    map,
    config,
    phase: 'preview',
    tick: 0,
    phaseTime: previewSeconds(map, config),
    raceTicks: 0,
    raceTime: 0,
    deadline: config.race.timeLimitSeconds,
    resumeTime: 0,
    traps: (map.traps ?? []).map(() => 0),
    foes: createFoes(map),
    bolts: [],
    nextBoltId: 1,
    players: players.map((setup, i): PlayerState => {
      const start = map.startPositions[setup.slot ?? i];
      if (!start) throw new Error(`No start position for slot ${setup.slot ?? i}.`);
      return {
        id: setup.id,
        name: setup.name,
        color: setup.color,
        x: start.x,
        y: start.y,
        vx: 0,
        vy: 0,
        facing: Math.atan2(cy - start.y, cx - start.x),
        stamina: config.sprint.staminaMax,
        exhausted: false,
        sprinting: false,
        regenDelay: 0,
        terrain: tileAt(map, Math.floor(start.x), Math.floor(start.y)),
        strideProgress: 0,
        bumpCooldown: 0,
        lastInputSeq: 0,
        markers: [],
        checkpoints: map.checkpoints.map(() => false),
        noticeCooldown: 0,
        footprints: [],
        effects: [],
        controlGuard: 0,
        health: config.health.hearts,
        respawnX: start.x,
        respawnY: start.y,
        safeTime: 0,
        hitGuard: 0,
        finished: false,
        finishTime: null,
      };
    }),
  };
}

/** Drops a waypoint during the preview. Returns false if it was not allowed. */
export function placeMarker(state: RaceState, playerId: string, x: number, y: number): boolean {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p || state.phase !== 'preview') return false;
  if (p.markers.length >= state.config.markers.max) return false;
  if (isSolid(state.map, Math.floor(x), Math.floor(y))) return false;
  p.markers.push({ x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, reached: false });
  return true;
}

export function removeLastMarker(state: RaceState, playerId: string): boolean {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p || state.phase !== 'preview' || p.markers.length === 0) return false;
  p.markers.pop();
  return true;
}

/**
 * Call when a pause ends. During the race this starts a short count (3-2-1)
 * before anyone can move again; in the preview or start countdown play simply
 * continues, since nobody is moving yet.
 */
export function resumeRace(state: RaceState): void {
  if (state.phase === 'racing') state.resumeTime = state.config.race.resumeCountdownSeconds;
}

/** Ends the preview early (single-player convenience; a lobby would require everyone ready). */
export function skipPreview(state: RaceState): void {
  if (state.phase === 'preview') state.phaseTime = 0;
}

/**
 * Advances the whole race by one fixed tick. This is the only way game state
 * changes, and it has no dependency on rendering, the browser or the network:
 * the same function runs in the browser for single player and on the server
 * for multiplayer.
 */
export function step(state: RaceState, inputs: Record<string, PlayerInput>): GameEvent[] {
  const events: GameEvent[] = [];
  const { config } = state;
  const dt = 1 / config.tickRate;
  state.tick++;

  if (state.phase === 'preview') {
    state.phaseTime -= dt;
    if (state.phaseTime <= 0) {
      state.phase = 'countdown';
      state.phaseTime = config.race.countdownSeconds;
      events.push({ type: 'phase', phase: 'countdown' }, { type: 'countdown', n: Math.ceil(state.phaseTime) });
    }
    return events;
  }

  if (state.phase === 'countdown') {
    const before = Math.ceil(state.phaseTime - 1e-9);
    state.phaseTime -= dt;
    const after = Math.ceil(state.phaseTime - 1e-9);
    if (state.phaseTime <= 1e-9) {
      state.phase = 'racing';
      state.phaseTime = 0;
      events.push({ type: 'phase', phase: 'racing' });
    } else if (after !== before) {
      events.push({ type: 'countdown', n: after });
    }
    return events;
  }

  if (state.phase !== 'racing') return events;

  if (state.resumeTime > 0) {
    // The count after a pause: inputs are ignored and the race clock stands still.
    const before = Math.ceil(state.resumeTime - 1e-9);
    if (state.resumeTime === state.config.race.resumeCountdownSeconds) events.push({ type: 'countdown', n: before });
    state.resumeTime -= dt;
    const after = Math.ceil(state.resumeTime - 1e-9);
    if (state.resumeTime <= 1e-9) {
      state.resumeTime = 0;
      events.push({ type: 'resumed' });
    } else if (after !== before) {
      events.push({ type: 'countdown', n: after });
    }
    return events;
  }

  state.raceTicks++;
  state.raceTime = state.raceTicks / config.tickRate;

  for (const p of state.players) {
    if (p.finished) continue;
    const input = inputs[p.id] ?? NO_INPUT;
    p.lastInputSeq = input.seq;
    stepPlayer(state, p, input, dt, events);
  }
  stepEnemies(state, dt, events);

  if (state.players.every((p) => p.finished) || state.raceTime >= state.deadline) {
    state.phase = 'finished';
    events.push({ type: 'phase', phase: 'finished' });
  }
  return events;
}

/**
 * Advances one runner by one tick. `step` calls this for everyone; a network
 * client also calls it directly, with `predict` set, to move its own runner
 * immediately instead of waiting for the server. In that mode nothing that
 * affects other runners (finishing place, the shared deadline) is decided.
 */
export function stepPlayer(
  state: RaceState,
  p: PlayerState,
  input: PlayerInput,
  dt: number,
  events: GameEvent[],
  predict = false,
): void {
  const { config, map } = state;
  // Effects such as stun or reversed controls change what the input does.
  input = controlledInput(p, input);
  const moving = Math.hypot(input.mx, input.my) > 0.01;

  // Stamina: sprinting drains it; running dry locks sprint until it recovers.
  const sprint = config.sprint;
  p.sprinting = input.sprint && moving && !p.exhausted && p.stamina > 0;
  if (p.sprinting) {
    p.stamina -= sprint.drainPerSec * dt;
    p.regenDelay = sprint.regenDelay;
    if (p.stamina <= 0) {
      p.stamina = 0;
      p.exhausted = true;
      p.sprinting = false;
      events.push({ type: 'exhausted', playerId: p.id });
    }
  } else if (p.regenDelay > 0) {
    p.regenDelay -= dt;
  } else {
    p.stamina = Math.min(sprint.staminaMax, p.stamina + sprint.regenPerSec * dt);
    if (p.exhausted && p.stamina >= sprint.recoverThreshold) p.exhausted = false;
  }

  gateTraps(state, p, events);
  const beforeX = p.x;
  const beforeY = p.y;
  const impact = movePlayer(map, config, p, input, dt, closedGateCheck(map, config, obstacleTime(state)));
  p.terrain = tileAt(map, Math.floor(p.x), Math.floor(p.y));
  tickEffects(config, p, dt, events);
  p.safeTime = Math.max(0, p.safeTime - dt);
  p.hitGuard = Math.max(0, p.hitGuard - dt);
  hitObstacles(state, p, events);
  springTraps(state, p, events);
  hitPatrollers(state, p, events);

  p.bumpCooldown = Math.max(0, p.bumpCooldown - dt);
  if (impact > 2.5 && p.bumpCooldown === 0) {
    p.bumpCooldown = 0.25;
    events.push({ type: 'bump', playerId: p.id, speed: impact });
  }

  // Footsteps: one per stride. They drive audio and leave fading footprints.
  p.strideProgress += Math.hypot(p.x - beforeX, p.y - beforeY);
  if (p.strideProgress >= config.player.strideLength) {
    p.strideProgress = 0;
    p.footprints.push({ x: p.x, y: p.y, t: state.raceTime });
    if (p.footprints.length > config.footprints.max) p.footprints.shift();
    events.push({ type: 'footstep', playerId: p.id, terrain: p.terrain, sprinting: p.sprinting });
  }
  while (p.footprints.length > 0 && state.raceTime - p.footprints[0]!.t > config.footprints.lifetimeSeconds) {
    p.footprints.shift();
  }

  // Waypoints are taken in the order they were placed.
  const nextIndex = p.markers.findIndex((m) => !m.reached);
  if (nextIndex >= 0) {
    const m = p.markers[nextIndex]!;
    if (Math.hypot(m.x - p.x, m.y - p.y) <= config.markers.reachRadius) {
      m.reached = true;
      events.push({ type: 'marker', playerId: p.id, index: nextIndex });
    }
  }

  // Checkpoints may be touched in any order; the finish only counts once all are done.
  const touched: number[] = [];
  let remaining = 0;
  map.checkpoints.forEach((zone, index) => {
    if (p.checkpoints[index]) return;
    if (inRect(zone, p.x, p.y)) {
      p.checkpoints[index] = true;
      touched.push(index);
      // A new checkpoint restores full health and becomes the respawn point.
      p.health = config.health.hearts;
      p.respawnX = zone.x + zone.w / 2;
      p.respawnY = zone.y + zone.h / 2;
    } else {
      remaining++;
    }
  });
  for (const index of touched) events.push({ type: 'checkpoint', playerId: p.id, index, remaining });

  p.noticeCooldown = Math.max(0, p.noticeCooldown - dt);
  if (inRect(map.finish, p.x, p.y)) {
    if (remaining > 0) {
      if (p.noticeCooldown === 0) {
        p.noticeCooldown = 2;
        events.push({ type: 'finishLocked', playerId: p.id, remaining });
      }
      return;
    }
    p.finished = true;
    p.finishTime = state.raceTime;
    p.sprinting = false;
    clearEffects(p);
    if (predict) return;
    const place = state.players.filter((pl) => pl.finished).length;
    events.push({ type: 'finish', playerId: p.id, time: state.raceTime, place });
    state.deadline = Math.min(state.deadline, state.raceTime + config.race.finishGraceSeconds);
  }
}
