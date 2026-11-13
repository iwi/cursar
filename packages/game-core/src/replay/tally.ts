import type { GameEvent, RaceState } from '../sim/types';

/** What happened to one runner during a race, for the run summary and statistics. */
export interface RunSummary {
  heartsLost: number;
  respawns: number;
  trapsSprung: number;
  /** Hits by obstacles and enemies. */
  hits: number;
  shovesLanded: number;
  /** Seconds spent looking at the full map. */
  mapSeconds: number;
  /** Tiles run (respawn jumps not counted). */
  distance: number;
  /** Race times at which each checkpoint was touched, in order. */
  splits: number[];
}

/** Tallies one runner's race, tick by tick. */
export class RunTally {
  readonly summary: RunSummary = { heartsLost: 0, respawns: 0, trapsSprung: 0, hits: 0, shovesLanded: 0, mapSeconds: 0, distance: 0, splits: [] };
  private lastX: number | null = null;
  private lastY = 0;

  constructor(private readonly playerId: string) {}

  /** Call after every step with that step's events; `peeking` is whether the full map was open. */
  update(state: RaceState, events: readonly GameEvent[], peeking: boolean): void {
    const p = state.players.find((pl) => pl.id === this.playerId);
    if (!p) return;
    const s = this.summary;
    for (const e of events) {
      if (!('playerId' in e) || e.playerId !== this.playerId) continue;
      if (e.type === 'hurt') s.heartsLost += e.amount;
      else if (e.type === 'respawn') s.respawns++;
      else if (e.type === 'trap') s.trapsSprung++;
      else if (e.type === 'obstacleHit' || e.type === 'enemyHit') s.hits++;
      else if (e.type === 'shoveHit') s.shovesLanded++;
      else if (e.type === 'checkpoint') s.splits.push(Math.round(state.raceTime * 1000) / 1000);
    }
    const running = state.phase === 'racing' && !p.finished;
    if (running && peeking) s.mapSeconds += 1 / state.config.tickRate;
    if (running && this.lastX !== null) {
      const d = Math.hypot(p.x - this.lastX, p.y - this.lastY);
      // A respawn is a jump, not a run.
      if (d < 1) s.distance += d;
    }
    this.lastX = p.x;
    this.lastY = p.y;
  }
}

/** Tiles covered by a route of x, y pairs, ignoring respawn jumps. */
export function routeDistance(route: readonly number[]): number {
  let total = 0;
  for (let i = 2; i + 1 < route.length; i += 2) {
    const d = Math.hypot(route[i]! - route[i - 2]!, route[i + 1]! - route[i - 1]!);
    if (d < 3) total += d;
  }
  return total;
}
