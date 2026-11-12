import {
  type ActiveSkill,
  type EffectKind,
  type GameConfig,
  type GameEvent,
  type GameMap,
  type GhostRecording,
  GhostRecorder,
  type RaceState,
  applyEffect,
  createRace,
  damage,
  hearFoe,
  offerSkills,
  pickSkill,
  placeMarker,
  removeLastMarker,
  resumeRace,
  sampleGhost,
  skipPreview,
  step,
} from '@cursar/game-core';

export interface MoveIntent {
  mx: number;
  my: number;
  sprint: boolean;
  /** An active skill whose key was pressed since the last tick. */
  use?: ActiveSkill;
}

export interface Rival {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  facing: number;
  /** Effects on this rival, for drawing. */
  fx: readonly EffectKind[];
  /** In the safe time after a respawn. */
  safe: boolean;
}

/** A chaser or turret to draw (patrollers follow the clock, so the scene works them out). */
export interface FoeSprite {
  /** Index in the map's enemy list. */
  index: number;
  x: number;
  y: number;
  /** Facing (chaser) or aim (turret). */
  angle: number;
  /** Chaser: 0 asleep, 1 chasing, 2 going home. Turret: 0 idle, 1 whirring. */
  mode: number;
}

export interface Print {
  x: number;
  y: number;
  /** Race time at which it was left. */
  t: number;
  color: number;
}

/** A route to draw over the revealed map after the race. */
export interface Track {
  samples: readonly number[];
  /** Numbers per point in `samples`: 2 for x, y; 3 for x, y, facing. */
  stride: number;
  color: number;
  alpha: number;
  width: number;
}

/**
 * What the race scene needs from "whatever is running the race". The scene
 * draws and plays sound; a driver owns the race state. There is one driver for
 * single player (the simulation runs here) and one for network play (the
 * server runs it, and the driver predicts the local runner).
 */
export interface RaceDriver {
  /** The race as this player knows it. `state.players[0]` is always the local runner. */
  readonly state: RaceState;
  readonly paused: boolean;
  readonly canPause: boolean;
  /** Where the results panel sits, so the map can be framed beside it. */
  readonly resultsLayout: 'top' | 'side';
  /** Advances by the frame's elapsed time and returns what happened. */
  advance(deltaMs: number, readIntent: () => MoveIntent): GameEvent[];
  /** Smoothed position of the local runner for drawing. */
  position(): { x: number; y: number };
  rivals(): Rival[];
  rivalPrints(): readonly Print[];
  /** Chasers and turrets known to this page (in network play, only those in view). */
  foes(): FoeSprite[];
  /** Turret bolts in flight. */
  bolts(): { x: number; y: number }[];
  /** Decoys known to this page. */
  decoys(): { x: number; y: number }[];
  /** Take card 0, 1 or 2 of the skill offer. */
  pick(slot: number): void;
  ghost(): { x: number; y: number; facing: number } | null;
  /** Routes to reveal once the race is over, or null until they are known. */
  routes(): Track[] | null;
  /** Whether a finish deserves the full fanfare. */
  celebrate(event: Extract<GameEvent, { type: 'finish' }>): boolean;
  runnerName(id: string): string;
  /** Preview readiness, for races where everyone must be ready. */
  readiness(): { ready: number; total: number; mine: boolean } | null;
  placeMarker(x: number, y: number): boolean;
  removeLastMarker(): boolean;
  ready(): void;
  setPaused(paused: boolean): void;
  /** Solo only: put an effect on the local runner, from the Tuning panel. */
  testEffect?(kind: EffectKind): void;
  /** Solo only: take a heart from the local runner, from the Tuning panel. */
  testHurt?(): void;
  /** Solo only: give the local runner skill points, from the Tuning panel. */
  testPoints?(): void;
  destroy(): void;
}

export interface LocalResult {
  finished: boolean;
  time: number | null;
  recording: GhostRecording | null;
}

const LOCAL_ID = 'p1';
const GHOST_COLOR = 0xffffff;

/** Single player: the whole simulation runs in the browser. */
export class LocalDriver implements RaceDriver {
  readonly state: RaceState;
  readonly canPause = true;
  readonly resultsLayout = 'top';
  paused = false;
  private recorder: GhostRecorder;
  private accumulator = 0;
  private prevX: number;
  private prevY: number;
  private seq = 0;
  /** Events from outside the tick (effects tried from the Tuning panel), returned by the next advance. */
  private queued: GameEvent[] = [];

  constructor(
    map: GameMap,
    config: GameConfig,
    private readonly best: GhostRecording | null,
    private readonly onResult: (result: LocalResult) => void,
    options: { color: number },
  ) {
    this.state = createRace(map, [{ id: LOCAL_ID, name: 'You', color: options.color }], config);
    this.recorder = new GhostRecorder(this.state, LOCAL_ID);
    this.prevX = this.me.x;
    this.prevY = this.me.y;
  }

  private get me() {
    return this.state.players[0]!;
  }

  advance(deltaMs: number, readIntent: () => MoveIntent): GameEvent[] {
    const events: GameEvent[] = this.queued;
    this.queued = [];
    if (this.paused) return events;
    const { state } = this;
    const stepMs = 1000 / state.config.tickRate;
    // Fixed timestep: the simulation never depends on the display's frame rate.
    this.accumulator = Math.min(this.accumulator + deltaMs, stepMs * 8);
    while (this.accumulator >= stepMs) {
      this.accumulator -= stepMs;
      this.prevX = this.me.x;
      this.prevY = this.me.y;
      const input = { seq: ++this.seq, ...readIntent() };
      for (const event of step(state, { [LOCAL_ID]: input })) {
        if (event.type === 'foeCue') {
          // Heard as the runner hears it, like in network play.
          const heard = hearFoe(state, event, this.me);
          if (heard) events.push(heard);
          continue;
        }
        events.push(event);
        if (event.type === 'phase' && event.phase === 'finished') {
          this.onResult({ finished: this.me.finished, time: this.me.finishTime, recording: this.recorder.finish() });
        }
      }
      this.recorder.capture();
    }
    return events;
  }

  position() {
    const blend = this.paused ? 1 : this.accumulator / (1000 / this.state.config.tickRate);
    return { x: this.prevX + (this.me.x - this.prevX) * blend, y: this.prevY + (this.me.y - this.prevY) * blend };
  }

  rivals(): Rival[] {
    return [];
  }

  rivalPrints(): readonly Print[] {
    return [];
  }

  foes(): FoeSprite[] {
    const out: FoeSprite[] = [];
    this.state.foes.forEach((foe, index) => {
      const spawn = this.state.map.enemies?.[index];
      if (!foe || !spawn || spawn.kind === 'patroller') return;
      if (foe.kind === 'chaser') out.push({ index, x: foe.x, y: foe.y, angle: foe.facing, mode: foe.mode === 'sleep' ? 0 : foe.mode === 'chase' ? 1 : 2 });
      else out.push({ index, x: spawn.x, y: spawn.y, angle: foe.aim, mode: foe.charge >= 0 ? 1 : 0 });
    });
    return out;
  }

  bolts() {
    return this.state.bolts.map((b) => ({ x: b.x, y: b.y }));
  }

  decoys() {
    return this.state.decoys.map((d) => ({ x: d.x, y: d.y }));
  }

  pick(slot: number): void {
    pickSkill(this.state, LOCAL_ID, slot, this.queued);
  }

  testPoints(): void {
    if (this.state.phase !== 'racing') return;
    this.me.points += 3;
    // Deal cards at once, as if at a checkpoint, so they can be tried straight away.
    offerSkills(this.state, this.me, this.queued);
  }

  ghost() {
    return this.best && this.state.phase !== 'preview' ? sampleGhost(this.best, this.state.raceTime) : null;
  }

  routes(): Track[] {
    const tracks: Track[] = [];
    if (this.best) tracks.push({ samples: this.best.samples, stride: 3, color: GHOST_COLOR, alpha: 0.45, width: 3 });
    tracks.push({ samples: this.recorder.track, stride: 3, color: this.me.color, alpha: 0.9, width: 4 });
    return tracks;
  }

  celebrate(event: Extract<GameEvent, { type: 'finish' }>): boolean {
    return !this.best || event.time < this.best.time;
  }

  runnerName(): string {
    return 'You';
  }

  readiness() {
    return null;
  }

  placeMarker(x: number, y: number): boolean {
    return placeMarker(this.state, LOCAL_ID, x, y);
  }

  removeLastMarker(): boolean {
    return removeLastMarker(this.state, LOCAL_ID);
  }

  ready(): void {
    skipPreview(this.state);
  }

  setPaused(paused: boolean): void {
    // Pausing only stops a race in progress.
    const next = this.state.phase === 'finished' ? false : paused;
    if (this.paused && !next) resumeRace(this.state);
    this.paused = next;
  }

  testEffect(kind: EffectKind): void {
    if (this.state.phase === 'racing') applyEffect(this.state.config, this.me, kind, this.queued);
  }

  testHurt(): void {
    if (this.state.phase !== 'racing') return;
    damage(this.state.config, this.me, 1, this.queued);
    // A respawn is a jump, not a glide: do not blend from where the runner fell.
    this.prevX = this.me.x;
    this.prevY = this.me.y;
  }

  destroy(): void {}
}
