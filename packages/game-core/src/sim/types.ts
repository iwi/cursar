import type { GameConfig } from '../config';
import type { GameMap, Point } from '../map/types';

/** One tick of player intent. `seq` lets a server acknowledge inputs for client prediction. */
export interface PlayerInput {
  seq: number;
  /** Movement direction, each axis in [-1, 1]. Screen convention: +y is down. */
  mx: number;
  my: number;
  sprint: boolean;
}

export const NO_INPUT: PlayerInput = { seq: 0, mx: 0, my: 0, sprint: false };

export interface Marker extends Point {
  reached: boolean;
}

/** Temporary effects; their strengths and default lengths are in `config.effects`. */
export type EffectKind = 'slow' | 'haste' | 'stun' | 'reversed' | 'confused' | 'blind';

export interface ActiveEffect {
  kind: EffectKind;
  /** Seconds left. */
  time: number;
  /** Seconds it lasts in all, for drawing how much is left. */
  total: number;
}

export interface Footprint extends Point {
  /** Race time at which it was left. */
  t: number;
}

export interface PlayerState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Smoothed facing angle in radians (0 = right, PI/2 = down). */
  facing: number;
  stamina: number;
  exhausted: boolean;
  sprinting: boolean;
  regenDelay: number;
  /** Tile code currently underfoot. */
  terrain: number;
  strideProgress: number;
  bumpCooldown: number;
  lastInputSeq: number;
  markers: Marker[];
  /** One flag per map checkpoint: true once this runner has touched it. */
  checkpoints: boolean[];
  noticeCooldown: number;
  footprints: Footprint[];
  /** Effects running now, at most one of each kind. */
  effects: ActiveEffect[];
  /** Seconds left in which no new loss-of-control effect can start. */
  controlGuard: number;
  /** Hearts left. Running out sends the runner back to their respawn point. */
  health: number;
  /** Where the runner comes back after running out of hearts: the last checkpoint touched, or the start. */
  respawnX: number;
  respawnY: number;
  /** Seconds left of the safe time after respawning (no damage, no harmful effects). */
  safeTime: number;
  finished: boolean;
  finishTime: number | null;
}

export type RacePhase = 'preview' | 'countdown' | 'racing' | 'finished';

export interface RaceState {
  map: GameMap;
  config: GameConfig;
  phase: RacePhase;
  tick: number;
  /** Seconds left in the preview or countdown. */
  phaseTime: number;
  raceTicks: number;
  /** Race clock in seconds (derived from raceTicks, so it is exact). */
  raceTime: number;
  /** Race time at which the race is cut off (time limit, or grace after the first finisher). */
  deadline: number;
  /** Seconds left in the count after a pause. Nobody moves and the clock stands still while it runs. */
  resumeTime: number;
  players: PlayerState[];
}

export type GameEvent =
  | { type: 'phase'; phase: RacePhase }
  | { type: 'countdown'; n: number }
  /** The count after a pause has ended and play continues. */
  | { type: 'resumed' }
  | { type: 'footstep'; playerId: string; terrain: number; sprinting: boolean }
  | { type: 'bump'; playerId: string; speed: number }
  | { type: 'exhausted'; playerId: string }
  | { type: 'marker'; playerId: string; index: number }
  | { type: 'checkpoint'; playerId: string; index: number; remaining: number }
  /** The runner reached the finish with checkpoints still to touch. */
  | { type: 'finishLocked'; playerId: string; remaining: number }
  | { type: 'finish'; playerId: string; time: number; place: number }
  /** An effect took hold (or a running one of the same kind was lengthened). */
  | { type: 'effect'; playerId: string; kind: EffectKind; seconds: number }
  | { type: 'effectEnd'; playerId: string; kind: EffectKind }
  /** A loss-of-control effect was refused: another was running, or the guard after one was. */
  | { type: 'effectResisted'; playerId: string; kind: EffectKind }
  /** The runner lost hearts. */
  | { type: 'hurt'; playerId: string; amount: number; health: number }
  /** Out of hearts: the runner is back at their respawn point. */
  | { type: 'respawn'; playerId: string; x: number; y: number }
  /** Network play only: a rival's footstep nearby. Direction and loudness, never a position. */
  | { type: 'rivalStep'; pan: number; closeness: number };
