import { type GameMap, type RunSummary } from '@cursar/game-core';
import { read, write } from './storage';

/** Your record on one map. */
export interface MapRecord {
  name: string;
  /** 'tiny' … 'large', or 'custom' for a hand-made map. */
  size: string;
  /** A generated map's seed, so it can be raced again from the statistics. */
  seed?: string;
  runs: number;
  finishes: number;
  /** Sum of finishing times, for the average. */
  totalTime: number;
  best: number | null;
  /** Checkpoint times of the best run, in the order touched. */
  bestSplits: number[] | null;
  lastPlayed: string;
}

export interface Totals {
  soloRuns: number;
  soloFinishes: number;
  netRaces: number;
  netFinishes: number;
  netWins: number;
  /** Tiles run, solo and in races. */
  distance: number;
  /** Seconds raced. */
  seconds: number;
  heartsLost: number;
  trapsSprung: number;
  mapSeconds: number;
  /** Races by map size ('custom' for hand-made maps). */
  bySize: Record<string, number>;
}

export interface Stats {
  totals: Totals;
  maps: Record<string, MapRecord>;
}

const KEY = 'cursar.stats';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function emptyTotals(): Totals {
  return { soloRuns: 0, soloFinishes: 0, netRaces: 0, netFinishes: 0, netWins: 0, distance: 0, seconds: 0, heartsLost: 0, trapsSprung: 0, mapSeconds: 0, bySize: {} };
}

export function loadStats(): Stats {
  const raw = read<Partial<Stats>>(KEY);
  const totals = emptyTotals();
  const t = (raw?.totals ?? {}) as Partial<Totals>;
  for (const k of Object.keys(totals) as (keyof Totals)[]) if (k !== 'bySize') totals[k] = num(t[k]);
  if (t.bySize && typeof t.bySize === 'object') for (const [size, n] of Object.entries(t.bySize)) totals.bySize[size] = num(n);
  const maps: Record<string, MapRecord> = {};
  if (raw?.maps && typeof raw.maps === 'object') {
    for (const [id, r] of Object.entries(raw.maps)) {
      if (!r || typeof r !== 'object') continue;
      maps[id] = {
        name: typeof r.name === 'string' ? r.name : id,
        size: typeof r.size === 'string' ? r.size : 'custom',
        ...(typeof r.seed === 'string' ? { seed: r.seed } : {}),
        runs: num(r.runs),
        finishes: num(r.finishes),
        totalTime: num(r.totalTime),
        best: typeof r.best === 'number' && r.best > 0 ? r.best : null,
        bestSplits: Array.isArray(r.bestSplits) ? r.bestSplits.filter((s) => typeof s === 'number') : null,
        lastPlayed: typeof r.lastPlayed === 'string' ? r.lastPlayed : '',
      };
    }
  }
  return { totals, maps };
}

function mapSize(map: GameMap): string {
  return map.generator?.size ?? 'custom';
}

function recordFor(stats: Stats, map: GameMap): MapRecord {
  const record = stats.maps[map.id] ?? {
    name: map.name,
    size: mapSize(map),
    ...(map.generator ? { seed: map.generator.seed } : {}),
    runs: 0,
    finishes: 0,
    totalTime: 0,
    best: null,
    bestSplits: null,
    lastPlayed: '',
  };
  record.name = map.name;
  record.lastPlayed = new Date().toISOString();
  stats.maps[map.id] = record;
  return record;
}

function addFinish(record: MapRecord, time: number, splits: number[] | null): void {
  record.finishes++;
  record.totalTime += time;
  if (record.best === null || time < record.best) {
    record.best = time;
    record.bestSplits = splits;
  }
}

/** Records a solo run. Returns your record on the map as it was before this run. */
export function recordSolo(map: GameMap, run: { finished: boolean; time: number | null; raceSeconds: number; summary: RunSummary }): MapRecord | null {
  const stats = loadStats();
  const before = stats.maps[map.id] ? { ...stats.maps[map.id]! } : null;
  const t = stats.totals;
  t.soloRuns++;
  t.seconds += run.raceSeconds;
  t.distance += run.summary.distance;
  t.heartsLost += run.summary.heartsLost;
  t.trapsSprung += run.summary.trapsSprung;
  t.mapSeconds += run.summary.mapSeconds;
  t.bySize[mapSize(map)] = (t.bySize[mapSize(map)] ?? 0) + 1;
  const record = recordFor(stats, map);
  record.runs++;
  if (run.finished && run.time !== null) {
    t.soloFinishes++;
    addFinish(record, run.time, run.summary.splits);
  }
  write(KEY, stats);
  return before;
}

/** Records a multiplayer race from your row of the results. */
export function recordRace(map: GameMap, run: { place: number | null; time: number | null; raceSeconds: number; distance: number }): void {
  const stats = loadStats();
  const t = stats.totals;
  t.netRaces++;
  t.seconds += run.raceSeconds;
  t.distance += run.distance;
  t.bySize[mapSize(map)] = (t.bySize[mapSize(map)] ?? 0) + 1;
  const record = recordFor(stats, map);
  record.runs++;
  if (run.place !== null && run.time !== null) {
    t.netFinishes++;
    if (run.place === 1) t.netWins++;
    addFinish(record, run.time, null);
  }
  write(KEY, stats);
}

export function clearStats(): void {
  write(KEY, { totals: emptyTotals(), maps: {} });
}
