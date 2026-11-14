import { type Look, isLook } from './game/looks';
import { type EncodedMap, type GameMap, type MapSize, decodeMap, encodeMap } from '@cursar/game-core';

export interface Settings {
  size: MapSize;
  seed: string;
  /** Locked doors, each with its key, in generated solo maps (0 to 3). */
  doors: number;
  /** Show an arrow pointing straight at the nearest checkpoint, then the finish (direction only). */
  finishArrow: boolean;
  /** The hand-made map to race in solo play (its id), or '' for generated maps. */
  mapId: string;
  /** Also move with H J K L, as in vim. */
  vimKeys: boolean;
  /** During the race, click (or hold) to run towards the pointer. */
  mouseMove: boolean;
  muted: boolean;
  volume: number;
  /** Name and colour used in network play (the colour is also your runner's in single player). */
  name: string;
  color: number;
  /** How the race is drawn: pixel art or a hand-drawn map. */
  look: Look;
}

const DEFAULTS: Settings = { size: 'small', seed: '', doors: 0, finishArrow: false, mapId: '', vimKeys: false, mouseMove: false, muted: false, volume: 0.7, name: '', color: 0xffb000, look: 'pixel' };
const SETTINGS_KEY = 'cursar.settings';

// Storage can be unavailable (private windows, blocked site data): the game must still run.
export function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Stores a value; false if the browser refused (storage full or blocked). */
export function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  const loaded = { ...DEFAULTS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
  if (!isLook(loaded.look)) loaded.look = DEFAULTS.look;
  return loaded;
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

const MAPS_KEY = 'cursar.maps';

/** Hand-made maps saved in this browser, newest first. Anything unreadable is skipped. */
export function loadMaps(): GameMap[] {
  const raw = read<unknown[]>(MAPS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const result = decodeMap(entry);
    return result.ok ? [result.map] : [];
  });
}

/** Saves a map (replacing `replaces`, the id it had before this edit, if given) and returns the map list. */
export function saveMap(map: GameMap, replaces?: string): GameMap[] {
  const rest = loadMaps().filter((m) => m.id !== map.id && m.id !== replaces);
  const next = [map, ...rest];
  write(MAPS_KEY, next.map((m): EncodedMap => encodeMap(m)));
  return next;
}

export function deleteMap(id: string): GameMap[] {
  const next = loadMaps().filter((m) => m.id !== id);
  write(MAPS_KEY, next.map((m): EncodedMap => encodeMap(m)));
  return next;
}

const ADJECTIVES = ['amber', 'brisk', 'crimson', 'dusty', 'eager', 'frosty', 'golden', 'hollow', 'ivory', 'jolly', 'keen', 'lunar', 'misty', 'nimble', 'opal', 'quiet', 'rapid', 'silver', 'tidal', 'vivid'];
const NOUNS = ['badger', 'comet', 'dune', 'ember', 'falcon', 'glacier', 'harbor', 'island', 'jungle', 'kestrel', 'lantern', 'meadow', 'nomad', 'orchard', 'pebble', 'quarry', 'river', 'summit', 'thicket', 'valley'];

/** A short, sayable seed, so friends can tell each other which map to race. */
export function randomSeed(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]!;
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 90 + 10)}`;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
