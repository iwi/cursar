import { ENGINE_VERSION } from '../config';
import { wrapAngle } from '../sim/movement';
import type { PlayerState, RaceState } from '../sim/types';

/**
 * A ghost is a position track, not an input log: it plays back identically on
 * any machine and never needs the simulation to be deterministic.
 */
export interface GhostRecording {
  format: 1;
  engineVersion: string;
  mapId: string;
  mapVersion: number;
  playerName: string;
  /** Finishing time in seconds. */
  time: number;
  intervalMs: number;
  recordedAt: string;
  /** Flat x, y, facing triples, one per interval, starting at race time 0. */
  samples: number[];
  /** Race times at which each checkpoint was touched, in the order touched (absent in older ghosts). */
  splits?: number[];
}

export class GhostRecorder {
  private samples: number[] = [];
  private splits: number[] = [];
  private lastTick = -1;

  constructor(
    private readonly state: RaceState,
    private readonly playerId: string,
  ) {}

  /** Call once after every simulation step. */
  capture(): void {
    const { state } = this;
    if (state.phase !== 'racing' && state.phase !== 'finished') return;
    const touched = this.player().checkpoints.filter(Boolean).length;
    while (this.splits.length < touched) this.splits.push(round(state.raceTime));
    if (state.raceTicks === this.lastTick || state.raceTicks % state.config.ghost.sampleEveryTicks !== 0) return;
    this.lastTick = state.raceTicks;
    const p = this.player();
    if (p.finished && p.finishTime !== null && state.raceTime > p.finishTime + 0.2) return;
    this.samples.push(round(p.x), round(p.y), round(p.facing));
  }

  /** The x, y, facing triples captured so far. */
  get track(): readonly number[] {
    return this.samples;
  }

  finish(): GhostRecording | null {
    const p = this.player();
    if (p.finishTime === null) return null;
    const { state } = this;
    return {
      format: 1,
      engineVersion: ENGINE_VERSION,
      mapId: state.map.id,
      mapVersion: state.map.version,
      playerName: p.name,
      time: p.finishTime,
      intervalMs: (1000 * state.config.ghost.sampleEveryTicks) / state.config.tickRate,
      recordedAt: new Date().toISOString(),
      samples: this.samples,
      splits: this.splits,
    };
  }

  private player(): PlayerState {
    return this.state.players.find((pl) => pl.id === this.playerId)!;
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Interpolated ghost position at a race time, or null once the ghost has finished. */
export function sampleGhost(
  ghost: GhostRecording,
  raceTime: number,
): { x: number; y: number; facing: number } | null {
  const count = Math.floor(ghost.samples.length / 3);
  if (count === 0) return null;
  // The first sample is taken at the first recorded tick, one interval in.
  const pos = (raceTime * 1000) / ghost.intervalMs - 1;
  if (pos > count - 1 + 10) return null;
  const i = Math.max(0, Math.min(count - 1, Math.floor(pos)));
  const j = Math.min(count - 1, i + 1);
  const t = Math.max(0, Math.min(1, pos - i));
  const s = ghost.samples;
  const fa = s[i * 3 + 2]!;
  const fb = s[j * 3 + 2]!;
  return {
    x: s[i * 3]! + (s[j * 3]! - s[i * 3]!) * t,
    y: s[i * 3 + 1]! + (s[j * 3 + 1]! - s[i * 3 + 1]!) * t,
    facing: fa + wrapAngle(fb - fa) * t,
  };
}
