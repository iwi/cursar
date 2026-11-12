import {
  BOT_LEVELS,
  type BotLevel,
  type ClientMessage,
  type GameEvent,
  type GameMap,
  type LobbySettings,
  MAX_PLAYERS,
  NO_INPUT,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  type PlayerInput,
  type PlayerState,
  type RaceState,
  type ResultRow,
  type RoomInfo,
  type RoomStage,
  SNAPSHOT_EVERY_TICKS,
  type RivalView,
  type SelfState,
  type ServerMessage,
  cloneConfig,
  computeVisibility,
  effectiveVision,
  createAutopilot,
  createRace,
  generateMap,
  placeMarker,
  pointsForPlace,
  removeLastMarker,
  skipPreview,
  resumeRace,
  step,
} from '@cursar/game-core';

export type Send = (message: ServerMessage) => void;

export interface Member {
  id: string;
  token: string;
  name: string;
  color: number;
  /** Null while the player's connection is down. */
  send: Send | null;
  /** Closes this player's connection (used when the host removes them). */
  close: (() => void) | null;
  points: number;
  inRace: boolean;
  ready: boolean;
  queue: PlayerInput[];
  lastInput: PlayerInput;
  /** Ticks since an input last arrived from this player. */
  starved: number;
  events: GameEvent[];
  track: number[];
  goneAt: number | null;
  /** Set for a computer player, which has no connection and is driven by the server. */
  bot: BotLevel | null;
}

interface Race {
  state: RaceState;
  map: GameMap;
  seed: string;
  racers: Member[];
  visible: Uint8Array;
  /** Route-follower shared by the computer players. */
  pilot: ReturnType<typeof createAutopilot>;
}

export interface RoomOptions {
  /** The code players use to join this room. */
  code?: string;
  /** Addresses other machines can use to reach this server, shown in the lobby. */
  addresses?: string[];
  now?: () => number;
  randomId?: () => string;
}

/** How close a rival's footsteps can be heard, in tiles. A little further than you can see to the side. */
const HEARING_RANGE = 9;
/** How long a disconnected player's place is kept, in milliseconds. */
const RECONNECT_GRACE_MS = 30_000;
const MAX_QUEUED_INPUTS = 12;
/**
 * If a page stops sending inputs for this many ticks (a background tab, a
 * frozen page), its runner stops instead of repeating the last move forever.
 */
const INPUT_TIMEOUT_TICKS = 15;
const BOT_NAMES = ['Dash', 'Bolt', 'Zip', 'Comet', 'Pace', 'Blur', 'Swift', 'Gale'];
const SEED_WORDS = ['amber', 'brisk', 'cedar', 'dusk', 'ember', 'frost', 'glade', 'heron', 'iris', 'jade', 'kite', 'lark', 'moss', 'north', 'onyx', 'pine'];

/**
 * One game room: the lobby, the race in progress and the series score.
 * It knows nothing about sockets. Whoever owns it calls `join`, `receive`,
 * `leave` and, 60 times a second, `tick`. That keeps it testable and means the
 * same room could sit behind any transport.
 */
export class Room {
  private members: Member[] = [];
  private stage: RoomStage = 'lobby';
  private hostId = '';
  /** A host whose connection dropped: the role goes back to them if they return. */
  private returningHostId = '';
  private settings: LobbySettings = { size: 'small', seed: '', races: 3 };
  private racesDone = 0;
  private seriesSeed = '';
  private race: Race | null = null;
  private raceId = 0;
  private paused = false;
  private ticks = 0;
  private readonly config = cloneConfig();
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly addresses: string[];
  readonly code: string;
  /** Tokens of players the host removed: they may not rejoin from the same page. */
  private readonly removed = new Set<string>();

  constructor(options: RoomOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.addresses = options.addresses ?? [];
    this.code = options.code ?? '';
  }

  /** True once no people are left in the room (connected or keeping their place), only computer players or nobody. */
  get abandoned(): boolean {
    return !this.members.some((m) => !m.bot);
  }

  /** For tests and diagnostics. */
  get raceState(): RaceState | null {
    return this.race?.state ?? null;
  }

  // --- Connections ---------------------------------------------------------

  join(send: Send, hello: Extract<ClientMessage, { t: 'hello' }>, close: (() => void) | null = null): Member | null {
    if (hello.v !== PROTOCOL_VERSION) {
      send({ t: 'error', message: 'This page is out of date. Reload it to match the game server.' });
      return null;
    }
    if (hello.token && this.removed.has(hello.token)) {
      send({ t: 'error', message: 'The host removed you from this room.' });
      return null;
    }
    let member = hello.token ? this.members.find((m) => m.token === hello.token) : undefined;
    if (member) {
      // A returning player (page reload, dropped connection) takes their place back.
      member.send = send;
      member.close = close;
      member.goneAt = null;
      if (member.id === this.returningHostId) {
        this.hostId = member.id;
        this.returningHostId = '';
      }
    } else {
      if (this.members.length >= MAX_PLAYERS) {
        send({ t: 'error', message: `The room is full (${MAX_PLAYERS} players).` });
        return null;
      }
      member = {
        id: this.randomId().slice(0, 8),
        token: this.randomId(),
        name: hello.name || `Runner ${this.members.length + 1}`,
        color: this.freeColor(hello.color),
        send,
        close,
        points: 0,
        inRace: false,
        ready: false,
        queue: [],
        lastInput: NO_INPUT,
        starved: 0,
        events: [],
        track: [],
        goneAt: null,
        bot: null,
      };
      this.members.push(member);
    }
    if (!this.members.some((m) => m.id === this.hostId && m.send)) this.hostId = member.id;
    send({ t: 'welcome', v: PROTOCOL_VERSION, id: member.id, token: member.token, room: this.code, addresses: this.addresses });
    if (this.race && member.inRace) this.sendRaceStart(member);
    this.broadcastRoom();
    return member;
  }

  leave(member: Member): void {
    if (!this.members.includes(member)) return;
    member.send = null;
    member.close = null;
    member.goneAt = this.now();
    const connected = this.members.filter((m) => m.send);
    // With nobody connected the places are still kept, so a host who reloads gets the room back.
    if (member.id === this.hostId && connected[0]) {
      this.returningHostId = member.id;
      this.hostId = connected[0].id;
    }
    if (this.race && !this.race.racers.some((m) => m.send)) this.reset();
    this.broadcastRoom();
  }

  receive(member: Member, message: ClientMessage): void {
    // Someone the host removed may still have a message in flight.
    if (!this.members.includes(member)) return;
    const isHost = member.id === this.hostId;
    switch (message.t) {
      case 'hello':
        return;
      case 'profile':
        if (this.stage === 'race') return;
        if (message.name) member.name = message.name;
        if (message.color !== member.color) member.color = this.freeColor(message.color, member);
        this.broadcastRoom();
        return;
      case 'settings':
        if (!isHost || this.stage !== 'lobby') return;
        this.settings = { ...this.settings, ...message.settings };
        this.broadcastRoom();
        return;
      case 'start':
        if (!isHost || this.stage === 'race') return;
        if (this.stage === 'lobby' || this.racesDone >= this.settings.races) this.newSeries();
        this.startRace();
        return;
      case 'lobby':
        if (!isHost) return;
        this.reset();
        this.broadcastRoom();
        return;
      case 'pause':
        if (!isHost || !this.race || this.paused === message.on) return;
        this.paused = message.on;
        if (!message.on) resumeRace(this.race.state);
        this.sendSnapshots(this.race);
        return;
      case 'restart':
        if (!isHost || !this.race) return;
        // Same race number, so the same seed and the same map.
        this.startRace();
        return;
      case 'addBot': {
        if (!isHost || this.stage !== 'lobby' || this.members.length >= MAX_PLAYERS) return;
        const used = new Set(this.members.map((m) => m.name));
        this.members.push({
          id: this.randomId().slice(0, 8),
          token: this.randomId(),
          name: BOT_NAMES.find((name) => !used.has(name)) ?? `Bot ${this.members.length + 1}`,
          color: this.freeColor(-1),
          send: null,
          close: null,
          points: 0,
          inRace: false,
          ready: true,
          queue: [],
          lastInput: NO_INPUT,
          starved: 0,
          events: [],
          track: [],
          goneAt: null,
          bot: message.level,
        });
        this.broadcastRoom();
        return;
      }
      case 'remove': {
        const target = this.members.find((m) => m.id === message.id);
        if (!isHost || !target || target === member) return;
        if (target.bot) {
          if (this.stage !== 'lobby') return;
        } else {
          // Not someone running in the current race: they would leave a hole in it.
          if (this.race && target.inRace) return;
          this.removed.add(target.token);
          target.send?.({ t: 'error', message: 'The host removed you from this room.' });
          target.close?.();
          target.send = null;
          target.close = null;
        }
        this.members = this.members.filter((m) => m !== target);
        this.broadcastRoom();
        return;
      }
      case 'input': {
        const race = this.race;
        if (!race || !member.inRace || race.state.phase !== 'racing') return;
        const last = member.queue[member.queue.length - 1] ?? member.lastInput;
        if (message.seq <= last.seq) return;
        // A client sending faster than the simulation runs gains nothing: old inputs are dropped.
        if (member.queue.length >= MAX_QUEUED_INPUTS) member.queue.splice(0, MAX_QUEUED_INPUTS / 2);
        member.queue.push({ seq: message.seq, mx: message.mx, my: message.my, sprint: message.sprint });
        return;
      }
      case 'marker':
        if (this.race && member.inRace) placeMarker(this.race.state, member.id, message.x, message.y);
        return;
      case 'unmarker':
        if (this.race && member.inRace) removeLastMarker(this.race.state, member.id);
        return;
      case 'ready': {
        const race = this.race;
        if (!race || !member.inRace || race.state.phase !== 'preview') return;
        member.ready = true;
        if (race.racers.every((m) => m.ready || !m.send)) skipPreview(race.state);
        return;
      }
    }
  }

  // --- Lobby ---------------------------------------------------------------

  private freeColor(wanted: number, self?: Member): number {
    const taken = new Set(this.members.filter((m) => m !== self).map((m) => m.color));
    if (PLAYER_COLORS.includes(wanted) && !taken.has(wanted)) return wanted;
    if (self) return self.color;
    return PLAYER_COLORS.find((c) => !taken.has(c)) ?? PLAYER_COLORS[0]!;
  }

  private reset(): void {
    this.stage = 'lobby';
    this.race = null;
    this.paused = false;
    this.racesDone = 0;
    for (const m of this.members) {
      m.points = 0;
      m.inRace = false;
    }
  }

  private newSeries(): void {
    this.racesDone = 0;
    for (const m of this.members) m.points = 0;
    const word = () => SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]!;
    this.seriesSeed = this.settings.seed.trim() || `${word()}-${word()}-${Math.floor(Math.random() * 90 + 10)}`;
  }

  info(): RoomInfo {
    return {
      stage: this.stage,
      hostId: this.hostId,
      settings: this.settings,
      racesDone: this.racesDone,
      players: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        connected: m.send !== null || m.bot !== null,
        points: m.points,
        inRace: m.inRace,
        bot: m.bot,
      })),
    };
  }

  private broadcast(message: ServerMessage): void {
    for (const m of this.members) m.send?.(message);
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.info() });
  }

  // --- Race ----------------------------------------------------------------

  private startRace(): void {
    const racers = this.members.filter((m) => m.send || m.bot).slice(0, MAX_PLAYERS);
    if (racers.length === 0) return;
    const seed = `${this.seriesSeed}-${this.racesDone + 1}`;
    const map = generateMap({ seed, size: this.settings.size });
    // Start positions rotate from race to race so nobody keeps the same one.
    const state = createRace(
      map,
      racers.map((m, i) => ({ id: m.id, name: m.name, color: m.color, slot: (i + this.racesDone) % map.startPositions.length })),
      this.config,
    );
    for (const m of this.members) {
      m.inRace = racers.includes(m);
      m.ready = m.bot !== null;
      m.queue = [];
      m.lastInput = NO_INPUT;
      m.starved = 0;
      m.events = [];
      m.track = [];
    }
    this.race = { state, map, seed, racers, visible: new Uint8Array(map.width * map.height), pilot: createAutopilot(map) };
    this.raceId++;
    this.paused = false;
    this.stage = 'race';
    for (const m of racers) this.sendRaceStart(m);
    this.broadcastRoom();
  }

  private sendRaceStart(member: Member): void {
    const race = this.race!;
    const index = race.racers.indexOf(member);
    member.send?.({
      t: 'race',
      id: this.raceId,
      seed: race.seed,
      size: this.settings.size,
      config: this.config,
      raceNumber: this.racesDone + 1,
      racesTotal: this.settings.races,
      slot: (index + this.racesDone) % race.map.startPositions.length,
      runners: race.racers.map((m) => ({ id: m.id, name: m.name, color: m.color })),
    });
  }

  /** Advances the room by one simulation tick. Call at the configured tick rate. */
  tick(): void {
    this.ticks++;
    if (this.ticks % 60 === 0) this.prune();
    const race = this.race;
    if (!race) return;
    const { state } = race;
    if (this.paused) {
      // Frozen by the host. Keep telling everyone, at a gentle rate.
      if (this.ticks % 20 === 0) this.sendSnapshots(race);
      return;
    }

    const inputs: Record<string, PlayerInput> = {};
    race.racers.forEach((m, i) => {
      if (!m.bot) return;
      // A computer player steers along the best route at a share of full speed.
      const steer = race.pilot(state.players[i]!);
      const speed = BOT_LEVELS[m.bot].speed;
      inputs[m.id] = { seq: steer.seq, mx: steer.mx * speed, my: steer.my * speed, sprint: false };
    });
    for (const m of race.racers) {
      // During the count after a pause nobody moves: leave queued inputs for when play continues.
      if (!m.send || state.resumeTime > 0) continue;
      const next = m.queue.shift();
      if (next) {
        m.lastInput = next;
        m.starved = 0;
      } else if (++m.starved > INPUT_TIMEOUT_TICKS) {
        m.lastInput = { ...NO_INPUT, seq: m.lastInput.seq };
      }
      inputs[m.id] = m.lastInput;
    }

    const events = step(state, inputs);
    let urgent = false;
    for (const event of events) {
      if (event.type === 'phase' || event.type === 'countdown' || event.type === 'resumed' || event.type === 'finish') {
        for (const m of race.racers) if (m.send) m.events.push(event);
        urgent = true;
      } else if (event.type === 'footstep') {
        this.shareFootstep(race, event.playerId);
      } else if (event.type === 'effect' || event.type === 'effectResisted') {
        // Effects come from the server (hazards, traps), so the runner's page cannot predict them.
        const index = state.players.findIndex((p) => p.id === event.playerId);
        const member = race.racers[index];
        if (member?.send) member.events.push(event);
        urgent = true;
      }
      // Everything else concerns one runner only, and that runner's client predicts it.
    }

    if (state.phase === 'racing' && state.raceTicks % 6 === 0) {
      state.players.forEach((p, i) => {
        if (!p.finished || p.finishTime === state.raceTime) race.racers[i]!.track.push(round(p.x, 10), round(p.y, 10));
      });
    }

    if (urgent || this.ticks % SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots(race);
    if (state.phase === 'finished') this.finishRace(race);
  }

  /** Lets nearby runners hear a footstep: a direction and loudness, never a position. */
  private shareFootstep(race: Race, playerId: string): void {
    const source = race.state.players.find((p) => p.id === playerId)!;
    race.state.players.forEach((listener, i) => {
      if (listener === source || listener.finished || !race.racers[i]!.send) return;
      const dist = Math.hypot(source.x - listener.x, source.y - listener.y);
      if (dist >= HEARING_RANGE) return;
      race.racers[i]!.events.push({
        type: 'rivalStep',
        pan: round(Math.max(-1, Math.min(1, (source.x - listener.x) / 5)), 100),
        closeness: round(1 - dist / HEARING_RANGE, 100),
      });
    });
  }

  private sendSnapshots(race: Race): void {
    const { state, map, visible } = race;
    const readyCount = race.racers.filter((m) => m.ready).length;
    state.players.forEach((p, i) => {
      const member = race.racers[i]!;
      if (!member.send) return;
      // Before the start and after finishing, a runner may see everyone. During
      // the race the server only reveals what is inside that runner's view, so
      // a modified client cannot learn where the others are.
      const seeAll = state.phase !== 'racing' || p.finished;
      if (!seeAll) computeVisibility(map, p.x, p.y, p.facing, effectiveVision(state.config, p), visible);
      const inView = (x: number, y: number) => seeAll || visible[Math.floor(y) * map.width + Math.floor(x)] === 1;

      const rivals: RivalView[] = [];
      const prints: number[] = [];
      for (let j = 0; j < state.players.length; j++) {
        if (j === i) continue;
        const other = state.players[j]!;
        if (inView(other.x, other.y)) {
          const rival: RivalView = { id: other.id, x: round(other.x, 100), y: round(other.y, 100), facing: round(other.facing, 100) };
          if (other.effects.length > 0) rival.fx = other.effects.map((e) => e.kind);
          rivals.push(rival);
        }
        if (seeAll) continue;
        for (const print of other.footprints) {
          if (inView(print.x, print.y)) prints.push(round(print.x, 100), round(print.y, 100), round(print.t, 10), j);
        }
      }

      member.send({
        t: 'snap',
        tick: state.tick,
        phase: state.phase,
        phaseTime: state.phaseTime,
        raceTicks: state.raceTicks,
        deadline: state.deadline,
        resumeTime: state.resumeTime,
        you: selfState(p),
        rivals,
        prints,
        readyCount,
        paused: this.paused,
        events: member.events,
      });
      member.events = [];
    });
  }

  private finishRace(race: Race): void {
    const { state } = race;
    const order = state.players
      .filter((p) => p.finished)
      .sort((a, b) => a.finishTime! - b.finishTime!)
      .map((p) => p.id);
    this.racesDone++;
    const rows: ResultRow[] = state.players.map((p, i) => {
      const member = race.racers[i]!;
      const place = p.finished ? order.indexOf(p.id) + 1 : null;
      const pointsGained = pointsForPlace(place);
      member.points += pointsGained;
      return {
        id: p.id,
        name: member.name,
        color: member.color,
        place,
        time: p.finishTime,
        checkpoints: p.checkpoints.filter(Boolean).length,
        pointsGained,
        pointsTotal: member.points,
        track: member.track,
      };
    });
    rows.sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.checkpoints - a.checkpoints);
    const results: ServerMessage = {
      t: 'results',
      rows,
      raceNumber: this.racesDone,
      racesTotal: this.settings.races,
      seriesOver: this.racesDone >= this.settings.races,
    };
    for (const m of race.racers) m.send?.(results);
    this.race = null;
    this.paused = false;
    this.stage = 'results';
    this.broadcastRoom();
  }

  /** Forgets players whose connection has been down too long. Racers are kept until their race ends. */
  private prune(): void {
    const cutoff = this.now() - RECONNECT_GRACE_MS;
    const before = this.members.length;
    this.members = this.members.filter((m) => m.send || m.bot || (m.goneAt ?? 0) > cutoff || (this.race !== null && m.inRace));
    if (this.abandoned) {
      // No people left (computer players do not count): start clean.
      this.members = [];
      this.reset();
      return;
    }
    if (this.members.length !== before) this.broadcastRoom();
  }
}

function round(value: number, factor: number): number {
  return Math.round(value * factor) / factor;
}

function selfState(p: PlayerState): SelfState {
  const { id: _id, name: _name, color: _color, footprints: _footprints, ...rest } = p;
  return rest;
}
