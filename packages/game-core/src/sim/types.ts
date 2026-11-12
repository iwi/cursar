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
  players: PlayerState[];
}

export type GameEvent =
  | { type: 'phase'; phase: RacePhase }
  | { type: 'countdown'; n: number }
  | { type: 'footstep'; playerId: string; terrain: number; sprinting: boolean }
  | { type: 'bump'; playerId: string; speed: number }
  | { type: 'exhausted'; playerId: string }
  | { type: 'marker'; playerId: string; index: number }
  | { type: 'checkpoint'; playerId: string; index: number; remaining: number }
  /** The runner reached the finish with checkpoints still to touch. */
  | { type: 'finishLocked'; playerId: string; remaining: number }
  | { type: 'finish'; playerId: string; time: number; place: number }
  /** Network play only: a rival's footstep nearby. Direction and loudness, never a position. */
  | { type: 'rivalStep'; pan: number; closeness: number };
