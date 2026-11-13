import type { GameConfig } from '../config';
import { MAP_SIZES, type MapSize } from '../map/generate';
import { type EncodedMap, decodeMap } from '../map/edit';
import type { GameMap } from '../map/types';
import type { EffectKind, GameEvent, PlayerState, RacePhase } from '../sim/types';

/** Bumped whenever messages change shape, so mismatched client and server refuse each other. */
export const PROTOCOL_VERSION = 16;

/** The longest message a client may send (a hand-made map); every other message must be under 2000 characters. */
export const MAX_MAP_MESSAGE = 60000;
export const MAX_PLAYERS = 8;
export const MAX_NAME_LENGTH = 16;
/** Network snapshots are sent every this many simulation ticks (3 ticks at 60 Hz = 20 per second). */
export const SNAPSHOT_EVERY_TICKS = 3;

/**
 * Room codes: consonants only, so a code can never spell a word, and no
 * letters that are easy to confuse. 20^4 = 160,000 codes.
 */
export const ROOM_CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;

/** Normalises a typed room code: upper case, room-code letters only. Returns '' if it cannot be one. */
export function cleanRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== ROOM_CODE_LENGTH || [...code].some((c) => !ROOM_CODE_LETTERS.includes(c))) return '';
  return code;
}

/** Runner colours, chosen to stay distinguishable from each other and from the map. */
export const PLAYER_COLORS: readonly number[] = [
  0xffb000, 0x4dc3ff, 0xff5a5f, 0x7ee08a, 0xc77dff, 0xffffff, 0xff8fd0, 0x2ec4b6,
];

/** Series points by finishing place. Runners who do not finish score nothing. */
export const PLACE_POINTS: readonly number[] = [10, 7, 5, 4, 3, 2, 1, 1];

export function pointsForPlace(place: number | null): number {
  return place === null ? 0 : (PLACE_POINTS[place - 1] ?? 0);
}

/**
 * Computer players. They know the map and take the best route, so their level
 * is simply how fast they run, as a share of a runner's normal top speed.
 */
export const BOT_LEVELS = {
  easy: { label: 'Easy', speed: 0.45 },
  normal: { label: 'Normal', speed: 0.6 },
  hard: { label: 'Hard', speed: 0.8 },
} as const;
export type BotLevel = keyof typeof BOT_LEVELS;

export interface LobbySettings {
  size: MapSize;
  /** Base seed. Each race in a series uses a different map derived from it. Empty = random. */
  seed: string;
  /** Number of races in the series. */
  races: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: number;
  connected: boolean;
  points: number;
  /** False for someone who joined while a race was running and is waiting for the next. */
  inRace: boolean;
  /** Has said they are ready in the lobby (name and colour chosen). Computer players always are. */
  ready: boolean;
  /** Set for a computer player. */
  bot: BotLevel | null;
}

export type RoomStage = 'lobby' | 'race' | 'results';

export interface RoomInfo {
  stage: RoomStage;
  hostId: string;
  settings: LobbySettings;
  players: RoomPlayer[];
  /** Races completed so far in the current series. */
  racesDone: number;
  /** A hand-made map the host chose, raced instead of generated ones; null for generated maps. */
  customMap: { id: string; name: string } | null;
}

/** Everything about a runner except identity and footprints: what the owner needs to predict movement. */
export type SelfState = Omit<PlayerState, 'id' | 'name' | 'color' | 'footprints'>;

export interface RivalView {
  id: string;
  x: number;
  y: number;
  facing: number;
  /** Effects on this rival, when there are any, so they can be drawn. */
  fx?: EffectKind[];
  /** Set during the safe time after a respawn, so the rival can be drawn flickering. */
  safe?: true;
}

/** A chaser or turret inside your view (patrollers follow the clock, so pages work them out). */
export interface FoeView {
  /** Index in the map's enemy list. */
  i: number;
  x: number;
  y: number;
  /** Facing (chaser) or aim (turret), radians. */
  a: number;
  /** Chaser: 0 asleep, 1 chasing, 2 going home, 3 stunned by a shove. Turret: 0 idle, 1 whirring. */
  m: number;
}

export interface ResultRow {
  id: string;
  name: string;
  color: number;
  place: number | null;
  time: number | null;
  checkpoints: number;
  pointsGained: number;
  pointsTotal: number;
  /** Flat x, y pairs: the route taken, shown to everyone after the race. */
  track: number[];
}

export type ClientMessage =
  /** First message on a connection. `room` is the code to join; without one, a new room is created. */
  | { t: 'hello'; v: number; name: string; color: number; room?: string; token?: string }
  | { t: 'profile'; name: string; color: number }
  | { t: 'settings'; settings: Partial<LobbySettings> }
  /** Host, in the lobby: race this hand-made map (checked by the server), or null to go back to generated maps. */
  | { t: 'map'; map: GameMap | null }
  /** Host: start the series, or the next race. */
  | { t: 'start' }
  /** Host: cancel the race or series and return everyone to the lobby. */
  | { t: 'lobby' }
  /** Host: freeze or resume the race for everyone. */
  | { t: 'pause'; on: boolean }
  /** Host: start the current race again on the same map. */
  | { t: 'restart' }
  | { t: 'addBot'; level: BotLevel }
  /** Host: remove a computer player, or a person (who cannot rejoin this room from the same page). */
  | { t: 'remove'; id: string }
  | { t: 'input'; seq: number; mx: number; my: number; sprint: boolean; shove?: true }
  /** Take card 0, 1 or 2 of the skill offer. */
  | { t: 'pick'; slot: number }
  | { t: 'marker'; x: number; y: number }
  | { t: 'unmarker' }
  /** Done studying the preview. */
  | { t: 'ready' }
  /** In the lobby: ready (name and colour chosen), or not ready after all. */
  | { t: 'lobbyReady'; on: boolean };

export type ServerMessage =
  | { t: 'welcome'; v: number; id: string; token: string; room: string; addresses: string[] }
  | { t: 'error'; message: string }
  | { t: 'room'; room: RoomInfo }
  | {
      t: 'race';
      /** Changes every time a race is started or restarted. */
      id: number;
      seed: string;
      size: MapSize;
      config: GameConfig;
      raceNumber: number;
      racesTotal: number;
      /** Your start position. */
      slot: number;
      runners: { id: string; name: string; color: number }[];
      /** A hand-made map, when the host chose one; otherwise everyone generates the map from the seed. */
      map?: EncodedMap;
    }
  | {
      t: 'snap';
      /** Server simulation tick, used to interpolate rivals smoothly. */
      tick: number;
      phase: RacePhase;
      phaseTime: number;
      raceTicks: number;
      deadline: number;
      /** Seconds left in the count after a pause (0 when play is running). */
      resumeTime: number;
      you: SelfState;
      /** Only the rivals you are allowed to see right now. */
      rivals: RivalView[];
      /** Rivals' footprints inside your view: flat x, y, race time, runner index. */
      prints: number[];
      /** Sprung traps inside your view: flat map trap index, seconds until armed again. */
      traps: number[];
      /** Chasers and turrets inside your view. */
      foes: FoeView[];
      /** Turret bolts inside your view: flat id, x, y. */
      bolts: number[];
      readyCount: number;
      /** The host has frozen the race. */
      paused: boolean;
      events: GameEvent[];
    }
  | { t: 'results'; rows: ResultRow[]; raceNumber: number; racesTotal: number; seriesOver: boolean };

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Printable characters only, single spaces, limited length.
  return raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH).trim();
}

export function cleanSettings(raw: unknown): Partial<LobbySettings> {
  const out: Partial<LobbySettings> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.size === 'string' && r.size in MAP_SIZES) out.size = r.size as MapSize;
  if (typeof r.seed === 'string') out.seed = r.seed.replace(/[^\w -]/g, '').slice(0, 40);
  if (isNumber(r.races)) out.races = Math.max(1, Math.min(9, Math.round(r.races)));
  return out;
}

/**
 * Checks a message from a client. The server never trusts what it receives:
 * anything malformed is dropped by returning null.
 */
export function parseClientMessage(text: string): ClientMessage | null {
  // Only a map may be long.
  if (text.length > MAX_MAP_MESSAGE) return null;
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    m = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (m.t !== 'map' && text.length > 2000) return null;
  switch (m.t) {
    case 'map': {
      if (m.map === null) return { t: 'map', map: null };
      const result = decodeMap(m.map);
      return result.ok ? { t: 'map', map: result.map } : null;
    }
    case 'hello':
      if (!isNumber(m.v) || !isNumber(m.color)) return null;
      return {
        t: 'hello',
        v: m.v,
        name: cleanName(m.name),
        color: m.color,
        room: m.room === undefined ? undefined : cleanRoomCode(m.room),
        token: typeof m.token === 'string' ? m.token.slice(0, 64) : undefined,
      };
    case 'profile':
      return isNumber(m.color) ? { t: 'profile', name: cleanName(m.name), color: m.color } : null;
    case 'settings':
      return { t: 'settings', settings: cleanSettings(m.settings) };
    case 'pause':
      return { t: 'pause', on: m.on === true };
    case 'lobbyReady':
      return { t: 'lobbyReady', on: m.on === true };
    case 'addBot':
      return typeof m.level === 'string' && m.level in BOT_LEVELS ? { t: 'addBot', level: m.level as BotLevel } : null;
    case 'remove':
      return typeof m.id === 'string' ? { t: 'remove', id: m.id.slice(0, 16) } : null;
    case 'restart':
    case 'start':
    case 'lobby':
    case 'unmarker':
    case 'ready':
      return { t: m.t };
    case 'input':
      if (!isNumber(m.seq) || !isNumber(m.mx) || !isNumber(m.my)) return null;
      return {
        t: 'input',
        seq: Math.floor(m.seq),
        mx: Math.max(-1, Math.min(1, m.mx)),
        my: Math.max(-1, Math.min(1, m.my)),
        sprint: m.sprint === true,
        ...(m.shove === true ? { shove: true as const } : {}),
      };
    case 'pick':
      return isNumber(m.slot) && [0, 1, 2].includes(m.slot) ? { t: 'pick', slot: m.slot } : null;
    case 'marker':
      return isNumber(m.x) && isNumber(m.y) ? { t: 'marker', x: m.x, y: m.y } : null;
    default:
      return null;
  }
}
