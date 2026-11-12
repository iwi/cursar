import type { GhostRecording, MapSize } from '@cursar/game-core';

export interface Settings {
  size: MapSize;
  seed: string;
  /** Show an arrow pointing straight at the nearest checkpoint, then the finish (direction only). */
  finishArrow: boolean;
  muted: boolean;
  volume: number;
  /** Name and colour used in network play (the colour is also your runner's in single player). */
  name: string;
  color: number;
}

const DEFAULTS: Settings = { size: 'small', seed: '', finishArrow: false, muted: false, volume: 0.7, name: '', color: 0xffb000 };
const SETTINGS_KEY = 'cursar.settings';
const ghostKey = (mapId: string) => `cursar.ghost.${mapId}`;

// Storage can be unavailable (private windows, blocked site data): the game must still run.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULTS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

export function loadGhost(mapId: string): GhostRecording | null {
  const ghost = read<GhostRecording>(ghostKey(mapId));
  return ghost && ghost.format === 1 && ghost.mapId === mapId && Array.isArray(ghost.samples) ? ghost : null;
}

export function saveGhost(ghost: GhostRecording): void {
  write(ghostKey(ghost.mapId), ghost);
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
