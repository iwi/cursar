import { DEFAULT_CONFIG, ENGINE_VERSION } from '../config';
import { type EncodedMap, decodeMap, encodeMap } from '../map/edit';
import { MAP_SIZES, type MapSize, generateMap } from '../map/generate';
import type { GameMap } from '../map/types';
import type { GhostRecording } from './ghost';

/**
 * Where a ghost's map comes from: a generated map is named by its seed and
 * size (the generator rebuilds it); any other map travels whole.
 */
export type MapRef = { seed: string; size: MapSize } | { map: EncodedMap };

/** A ghost with its map, as written to a `.cursar-ghost.json` file. */
export interface GhostFile {
  kind: 'cursar-ghost';
  format: 1;
  map: MapRef;
  ghost: Omit<GhostRecording, 'samples'> & { samples: string };
}

const LIMITS = {
  name: 24,
  seed: 40,
  /** Seconds: the longest race, with room for a slower clock in tuning. */
  time: DEFAULT_CONFIG.race.timeLimitSeconds * 2,
  splits: 12,
};

/** How a map is referred to in files and the ghost library. */
export function mapRef(map: GameMap): MapRef {
  const gen = map.generator;
  if (gen && gen.size in MAP_SIZES) {
    const size = gen.size as MapSize;
    if (generateMap({ seed: gen.seed, size }).id === map.id) return { seed: gen.seed, size };
  }
  return { map: encodeMap(map) };
}

export type MapRefResult = { ok: true; map: GameMap } | { ok: false; error: string };

/** Builds the map a reference names, trusting nothing in it. */
export function resolveMapRef(raw: unknown): MapRefResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'The ghost’s map is missing.' };
  const ref = raw as Record<string, unknown>;
  if ('map' in ref) {
    const decoded = decodeMap(ref.map);
    return decoded.ok ? decoded : { ok: false, error: decoded.error };
  }
  const { seed, size } = ref;
  if (typeof seed !== 'string' || seed.length === 0 || seed.length > LIMITS.seed || typeof size !== 'string' || !(size in MAP_SIZES)) {
    return { ok: false, error: 'The ghost’s map is not valid.' };
  }
  return { ok: true, map: generateMap({ seed, size: size as MapSize }) };
}

/**
 * Checks a ghost read from storage, a file or a results table. Returns a clean
 * copy, or null if anything about it is wrong.
 */
export function checkGhost(raw: unknown): GhostRecording | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (g.format !== 1 || typeof g.mapId !== 'string' || g.mapId.length === 0 || g.mapId.length > 120) return null;
  if (!num(g.time) || g.time <= 0 || g.time > LIMITS.time) return null;
  if (!num(g.intervalMs) || g.intervalMs < 10 || g.intervalMs > 1000) return null;
  if (!num(g.mapVersion)) return null;
  const samples = g.samples;
  const maxSamples = Math.ceil((LIMITS.time * 1000) / g.intervalMs + 20) * 3;
  if (!Array.isArray(samples) || samples.length < 3 || samples.length % 3 !== 0 || samples.length > maxSamples) return null;
  if (!samples.every((v) => num(v) && Math.abs(v) < 10000)) return null;
  let splits: number[] | undefined;
  if (g.splits !== undefined) {
    if (!Array.isArray(g.splits) || g.splits.length > LIMITS.splits || !g.splits.every((t) => num(t) && t >= 0 && t <= LIMITS.time)) return null;
    splits = g.splits as number[];
  }
  return {
    format: 1,
    engineVersion: typeof g.engineVersion === 'string' ? g.engineVersion.slice(0, 20) : ENGINE_VERSION,
    mapId: g.mapId,
    mapVersion: g.mapVersion,
    playerName: cleanName(g.playerName),
    time: g.time,
    intervalMs: g.intervalMs,
    recordedAt: typeof g.recordedAt === 'string' && !Number.isNaN(Date.parse(g.recordedAt)) ? g.recordedAt : new Date(0).toISOString(),
    samples: samples as number[],
    ...(splits ? { splits } : {}),
  };
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.name) : '';
  return name || 'Runner';
}

/**
 * Turns a route from a results table (x, y pairs, one every `intervalMs`,
 * the first one interval into the race) into a ghost. Facing is worked out
 * from the direction of travel.
 */
export function ghostFromRoute(
  route: readonly number[],
  info: { mapId: string; mapVersion: number; playerName: string; time: number; intervalMs: number },
): GhostRecording | null {
  const count = Math.floor(route.length / 2);
  if (count < 2) return null;
  const samples: number[] = [];
  let facing = 0;
  for (let i = 0; i < count; i++) {
    // Look either side, so a 0.1-tile grid does not make the facing twitch.
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const dx = route[b * 2]! - route[a * 2]!;
    const dy = route[b * 2 + 1]! - route[a * 2 + 1]!;
    const d = Math.hypot(dx, dy);
    // A big jump is a respawn: keep the old facing.
    if (d > 0.05 && d < 3) facing = Math.atan2(dy, dx);
    samples.push(route[i * 2]!, route[i * 2 + 1]!, Math.round(facing * 1000) / 1000);
  }
  return checkGhost({
    format: 1,
    engineVersion: ENGINE_VERSION,
    mapId: info.mapId,
    mapVersion: info.mapVersion,
    playerName: info.playerName,
    time: info.time,
    intervalMs: info.intervalMs,
    recordedAt: new Date().toISOString(),
    samples,
  });
}

/**
 * Packs samples into a short string: hundredths, each value stored as the
 * change from the same value one sample earlier, in base 36. Runners move
 * little in 50 ms, so most values take one or two characters.
 */
export function packSamples(samples: readonly number[]): string {
  const out: string[] = [];
  const last = [0, 0, 0];
  samples.forEach((v, i) => {
    const q = Math.round(v * 100);
    out.push((q - last[i % 3]!).toString(36));
    last[i % 3] = q;
  });
  return out.join(',');
}

export function unpackSamples(packed: unknown): number[] | null {
  if (typeof packed !== 'string' || packed.length === 0 || packed.length > 2_000_000) return null;
  const last = [0, 0, 0];
  const out: number[] = [];
  const parts = packed.split(',');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!/^-?[0-9a-z]{1,8}$/.test(part)) return null;
    const q = last[i % 3]! + parseInt(part, 36);
    last[i % 3] = q;
    out.push(q / 100);
  }
  return out;
}

/** A ghost packed for storage or a file (the samples as a string). */
export type PackedGhost = GhostFile['ghost'];

export function packGhost(ghost: GhostRecording): PackedGhost {
  return { ...ghost, samples: packSamples(ghost.samples) };
}

export function unpackGhost(raw: unknown): GhostRecording | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const samples = unpackSamples((raw as Record<string, unknown>).samples);
  return samples ? checkGhost({ ...raw, samples }) : null;
}

export function encodeGhostFile(ghost: GhostRecording, map: GameMap): GhostFile {
  return { kind: 'cursar-ghost', format: 1, map: mapRef(map), ghost: packGhost(ghost) };
}

export type GhostFileResult = { ok: true; ghost: GhostRecording; map: GameMap } | { ok: false; error: string };

/** Reads a ghost file, trusting nothing: the ghost must belong to the map it carries. */
export function decodeGhostFile(raw: unknown): GhostFileResult {
  if (typeof raw !== 'object' || raw === null || (raw as GhostFile).kind !== 'cursar-ghost') {
    return { ok: false, error: 'This is not a Cursar ghost file.' };
  }
  const file = raw as Record<string, unknown>;
  if (file.format !== 1) return { ok: false, error: 'This ghost file was made by a newer version of Cursar.' };
  const ghost = unpackGhost(file.ghost);
  if (!ghost) return { ok: false, error: 'The ghost in this file is not valid.' };
  const map = resolveMapRef(file.map);
  if (!map.ok) return map;
  if (map.map.id !== ghost.mapId) {
    return { ok: false, error: 'This ghost was recorded on a different version of its map, so it cannot be raced.' };
  }
  return { ok: true, ghost, map: map.map };
}
