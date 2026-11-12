import {
  type GameEvent,
  type GameMap,
  type PlayerInput,
  type RaceState,
  type ResultRow,
  type RivalView,
  type ServerMessage,
  createRace,
  placeMarker,
  removeLastMarker,
  stepPlayer,
  wrapAngle,
} from '@cursar/game-core';
import type { Connection } from '../net/Connection';
import type { MoveIntent, Print, RaceDriver, Rival, Track } from './driver';

type RaceStart = Extract<ServerMessage, { t: 'race' }>;
type Snapshot = Extract<ServerMessage, { t: 'snap' }>;

interface RivalFrame {
  tick: number;
  at: number;
  rivals: Map<string, RivalView>;
}

/** Rivals are drawn this many ticks in the past, so there are always two snapshots to blend between. */
const INTERPOLATION_TICKS = 6;

/**
 * Network play. The server runs the race and is the only authority. To keep
 * the controls immediate, this driver moves the local runner at once with the
 * same rules the server uses (prediction), then corrects itself from each
 * server snapshot by replaying the inputs the server has not processed yet
 * (reconciliation). Rivals are shown slightly in the past, blended between
 * snapshots.
 */
export class NetDriver implements RaceDriver {
  readonly state: RaceState;
  readonly canPause = false;
  /** Set by the host, for everyone. */
  paused = false;
  readonly resultsLayout = 'side';
  private pending: PlayerInput[] = [];
  private seq = 0;
  private accumulator = 0;
  private prevX: number;
  private prevY: number;
  private errX = 0;
  private errY = 0;
  private queued: GameEvent[] = [];
  private frames: RivalFrame[] = [];
  private prints: Print[] = [];
  private results: ResultRow[] | null = null;
  private readyCount = 0;
  private sentReady = false;
  private readonly runners = new Map<string, { name: string; color: number }>();
  private readonly colors: number[];
  private readonly unsubscribe: (() => void)[];

  constructor(
    map: GameMap,
    private readonly start: RaceStart,
    private readonly connection: Connection,
  ) {
    for (const runner of start.runners) this.runners.set(runner.id, runner);
    this.colors = start.runners.map((runner) => runner.color);
    const self = this.runners.get(connection.id) ?? { name: 'You', color: 0xffb000 };
    this.state = createRace(map, [{ id: connection.id, name: self.name, color: self.color, slot: start.slot }], start.config);
    this.prevX = this.me.x;
    this.prevY = this.me.y;
    this.unsubscribe = [
      connection.on('snap', (snapshot) => this.onSnapshot(snapshot)),
      connection.on('results', (message) => (this.results = message.rows)),
    ];
  }

  private get me() {
    return this.state.players[0]!;
  }

  private onSnapshot(snapshot: Snapshot): void {
    const { state, me } = this;
    const dt = 1 / state.config.tickRate;
    state.phase = snapshot.phase;
    state.phaseTime = snapshot.phaseTime;
    state.deadline = snapshot.deadline;
    this.readyCount = snapshot.readyCount;
    this.paused = snapshot.paused;
    // After a page reload the server remembers our last input number: carry on from it.
    if (this.seq < snapshot.you.lastInputSeq) this.seq = snapshot.you.lastInputSeq;

    // Reconcile: take the server's word for where we are, then re-apply the
    // inputs it has not seen yet.
    const beforeX = me.x;
    const beforeY = me.y;
    const footprints = me.footprints;
    Object.assign(me, snapshot.you);
    me.footprints = [];
    this.pending = this.pending.filter((input) => input.seq > snapshot.you.lastInputSeq);
    state.raceTicks = snapshot.raceTicks;
    const discard: GameEvent[] = [];
    if (snapshot.phase === 'racing') {
      for (const input of this.pending) {
        if (me.finished) break;
        state.raceTicks++;
        state.raceTime = state.raceTicks / state.config.tickRate;
        stepPlayer(state, me, input, dt, discard, true);
      }
    }
    state.raceTime = state.raceTicks / state.config.tickRate;
    me.footprints = footprints;

    // Hide small corrections by easing them out instead of snapping.
    const shiftX = me.x - beforeX;
    const shiftY = me.y - beforeY;
    this.prevX += shiftX;
    this.prevY += shiftY;
    this.errX -= shiftX;
    this.errY -= shiftY;
    if (Math.hypot(this.errX, this.errY) > 1.5) {
      this.errX = 0;
      this.errY = 0;
    }

    this.frames.push({ tick: snapshot.tick, at: performance.now(), rivals: new Map(snapshot.rivals.map((r) => [r.id, r])) });
    if (this.frames.length > 12) this.frames.shift();
    this.prints = [];
    for (let i = 0; i + 3 < snapshot.prints.length; i += 4) {
      this.prints.push({
        x: snapshot.prints[i]!,
        y: snapshot.prints[i + 1]!,
        t: snapshot.prints[i + 2]!,
        color: this.colors[snapshot.prints[i + 3]!] ?? 0xffffff,
      });
    }
    this.queued.push(...snapshot.events);
  }

  advance(deltaMs: number, readIntent: () => MoveIntent): GameEvent[] {
    const { state, me } = this;
    const events = this.queued;
    this.queued = [];
    const stepMs = 1000 / state.config.tickRate;
    const dt = stepMs / 1000;
    if (this.paused) {
      this.accumulator = 0;
      return events;
    }
    this.accumulator = Math.min(this.accumulator + deltaMs, stepMs * 8);
    while (this.accumulator >= stepMs) {
      this.accumulator -= stepMs;
      if (state.phase === 'preview' || state.phase === 'countdown') {
        // Count down smoothly between snapshots; the server decides when the phase ends.
        state.phaseTime = Math.max(0.01, state.phaseTime - dt);
      } else if (state.phase === 'racing') {
        state.raceTicks++;
        state.raceTime = state.raceTicks / state.config.tickRate;
        this.prevX = me.x;
        this.prevY = me.y;
        if (!me.finished) {
          const input: PlayerInput = { seq: ++this.seq, ...readIntent() };
          this.pending.push(input);
          if (this.pending.length > 120) this.pending.splice(0, 60);
          this.connection.send({ t: 'input', ...input });
          stepPlayer(state, me, input, dt, events, true);
        }
      }
    }
    const decay = Math.pow(0.002, deltaMs / 1000);
    this.errX *= decay;
    this.errY *= decay;
    return events;
  }

  position() {
    const blend = this.accumulator / (1000 / this.state.config.tickRate);
    return {
      x: this.prevX + (this.me.x - this.prevX) * blend + this.errX,
      y: this.prevY + (this.me.y - this.prevY) * blend + this.errY,
    };
  }

  rivals(): Rival[] {
    const latest = this.frames[this.frames.length - 1];
    if (!latest) return [];
    const rate = this.state.config.tickRate;
    const renderTick = latest.tick + ((performance.now() - latest.at) * rate) / 1000 - INTERPOLATION_TICKS;
    let older = this.frames[0]!;
    let newer = older;
    if (renderTick >= latest.tick) {
      older = newer = latest;
    } else {
      for (let i = this.frames.length - 1; i > 0; i--) {
        if (this.frames[i - 1]!.tick <= renderTick) {
          older = this.frames[i - 1]!;
          newer = this.frames[i]!;
          break;
        }
      }
    }
    const span = newer.tick - older.tick;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTick - older.tick) / span)) : 1;
    const out: Rival[] = [];
    for (const [id, to] of newer.rivals) {
      const from = older.rivals.get(id) ?? to;
      const info = this.runners.get(id);
      out.push({
        id,
        name: info?.name ?? '?',
        color: info?.color ?? 0xffffff,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        facing: from.facing + wrapAngle(to.facing - from.facing) * t,
      });
    }
    return out;
  }

  rivalPrints(): readonly Print[] {
    return this.prints;
  }

  ghost() {
    return null;
  }

  routes(): Track[] | null {
    if (!this.results) return null;
    return this.results.map((row) => {
      const mine = row.id === this.connection.id;
      return { samples: row.track, stride: 2, color: row.color, alpha: mine ? 0.95 : 0.6, width: mine ? 4 : 2.5 };
    });
  }

  celebrate(event: Extract<GameEvent, { type: 'finish' }>): boolean {
    return event.place === 1;
  }

  runnerName(id: string): string {
    return this.runners.get(id)?.name ?? 'Someone';
  }

  readiness() {
    return { ready: this.readyCount, total: this.start.runners.length, mine: this.sentReady };
  }

  placeMarker(x: number, y: number): boolean {
    // Shown at once; the server applies the same rule and its next snapshot confirms it.
    if (!placeMarker(this.state, this.connection.id, x, y)) return false;
    this.connection.send({ t: 'marker', x, y });
    return true;
  }

  removeLastMarker(): boolean {
    if (!removeLastMarker(this.state, this.connection.id)) return false;
    this.connection.send({ t: 'unmarker' });
    return true;
  }

  ready(): void {
    if (this.sentReady || this.state.phase !== 'preview') return;
    this.sentReady = true;
    this.connection.send({ t: 'ready' });
  }

  setPaused(): void {}

  destroy(): void {
    this.unsubscribe.forEach((off) => off());
  }
}
