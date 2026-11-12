import type { GameConfig } from '../config';
import type { SkillId } from './skills';
import type { EnemyKind, GameMap, ObstacleKind, Point, TrapKind } from '../map/types';

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
  /** Seconds left in which obstacles pass through the runner, after being hit by one. */
  hitGuard: number;
  /** One flag per map treasure: true once this runner has collected it. */
  treasures: boolean[];
  /** Points to spend on skills. */
  points: number;
  /** Skills taken this race. */
  skills: SkillId[];
  /** The sum of the taken skills' threat. */
  threat: number;
  /** Cards on offer, waiting for a pick, or null. */
  offer: SkillId[] | null;
  /** Offers made so far (each deals from the deck afresh). */
  offersMade: number;
  /** Seconds left of Reveal's glow after touching a checkpoint. */
  revealTime: number;
  /** Trap sense: the armed trap the runner stepped on and the race time it clicked, or null. */
  trapClick: { index: number; at: number } | null;
  finished: boolean;
  finishTime: number | null;
}

export type ChaserMode = 'sleep' | 'chase' | 'return';

export interface ChaserState {
  kind: 'chaser';
  x: number;
  y: number;
  facing: number;
  mode: ChaserMode;
  /** The runner being chased. */
  target: string | null;
  /** Where the target was last seen. */
  lastX: number;
  lastY: number;
  /** Chasing: seconds left after losing sight. Returning or asleep: seconds left of rest before it may wake again. */
  timer: number;
  cue: number;
}

export interface TurretState {
  kind: 'turret';
  aim: number;
  target: string | null;
  /** Seconds left of the whir before firing, or -1 when not charging. */
  charge: number;
  reload: number;
}

export type FoeState = ChaserState | TurretState;


export interface Bolt {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Enemy sounds. */
export type FoeSound = 'snore' | 'wake' | 'growl' | 'whir' | 'fire';

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
  /** Per map trap: the race time at which it is armed again (0 or past = armed). */
  traps: number[];
  /** Per map enemy: its state, or null for a patroller (whose motion follows the clock). */
  foes: (FoeState | null)[];
  /** Turret bolts in flight. */
  bolts: Bolt[];
  nextBoltId: number;
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
  /** A boulder or barrier hit the runner, or a gate closed on them (the lost heart and the stun follow as their own events). */
  | { type: 'obstacleHit'; playerId: string; kind: ObstacleKind }
  /** The runner sprang a trap (its effect follows as its own events). */
  | { type: 'trap'; playerId: string; index: number; kind: TrapKind }
  /** An enemy caught the runner, or a turret bolt hit them (the cost follows as its own events). */
  | { type: 'enemyHit'; playerId: string; kind: EnemyKind }
  /** An enemy made a sound (the map enemy index). Pages turn this into `foeHeard` for the listener. */
  | { type: 'foeCue'; index: number; sound: FoeSound }
  /** An enemy sound as one listener hears it: a direction and loudness, never a position. `aimed`: it is after you. */
  | { type: 'foeHeard'; sound: FoeSound; pan: number; closeness: number; aimed: boolean }
  | { type: 'treasure'; playerId: string; index: number; points: number }
  /** Three cards on offer at a checkpoint. */
  | { type: 'offer'; playerId: string; cards: SkillId[] }
  | { type: 'skill'; playerId: string; skill: SkillId }
  /** Trap sense: the runner stepped on an armed trap, which springs unless they get off it in time. */
  | { type: 'trapClick'; playerId: string; index: number }
  /** The runner lost hearts. */
  | { type: 'hurt'; playerId: string; amount: number; health: number }
  /** Out of hearts: the runner is back at their respawn point. */
  | { type: 'respawn'; playerId: string; x: number; y: number }
  /** Network play only: a rival's footstep nearby. Direction and loudness, never a position. */
  | { type: 'rivalStep'; pan: number; closeness: number };
