import {
  type GameConfig,
  type GameEvent,
  type GameMap,
  type GhostRecording,
  GhostRecorder,
  type RaceState,
  createRace,
  placeMarker,
  removeLastMarker,
  sampleGhost,
  skipPreview,
  step,
} from '@cursar/game-core';

export interface MoveIntent {
  mx: number;
  my: number;
  sprint: boolean;
}

export interface Rival {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  facing: number;
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
    const events: GameEvent[] = [];
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
    this.paused = this.state.phase === 'finished' ? false : paused;
  }

  destroy(): void {}
}
