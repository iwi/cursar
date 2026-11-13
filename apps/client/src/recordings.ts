import {
  DEFAULT_CONFIG, type GameMap, type GhostRecording, type PackedGhost, checkGhost, encodeGhostFile, packGhost, unpackGhost,
} from '@cursar/game-core';
import { read, remove, write } from './storage';

/** Where a ghost came from: your own solo run, a multiplayer race, or a file. */
export type GhostSource = 'mine' | 'race' | 'file';

export interface GhostEntry {
  id: string;
  source: GhostSource;
  /** Your own name for it ('' shows a description instead). */
  label: string;
  pinned: boolean;
  ghost: GhostRecording;
}

/** The ghosts kept for one map. */
export interface MapGhosts {
  mapId: string;
  mapName: string;
  /** The ghost to race in solo: an entry id, 'best' (your best run) or 'none'. */
  chosen: string;
  entries: GhostEntry[];
}

interface StoredEntry extends Omit<GhostEntry, 'ghost'> {
  ghost: PackedGhost;
}

interface Stored {
  mapName: string;
  chosen: string;
  entries: StoredEntry[];
}

const key = (mapId: string) => `cursar.ghosts.${mapId}`;
/** Before Phase 6 only the best run was kept, under this key. */
const oldKey = (mapId: string) => `cursar.ghost.${mapId}`;

export function loadGhosts(mapId: string, mapName = ''): MapGhosts {
  const stored = read<Stored>(key(mapId));
  const entries: GhostEntry[] = [];
  if (stored && Array.isArray(stored.entries)) {
    for (const e of stored.entries) {
      const ghost = unpackGhost(e?.ghost);
      if (!ghost || ghost.mapId !== mapId || typeof e.id !== 'string') continue;
      entries.push({
        id: e.id,
        source: e.source === 'race' || e.source === 'file' ? e.source : 'mine',
        label: typeof e.label === 'string' ? e.label.slice(0, 40) : '',
        pinned: e.pinned === true,
        ghost,
      });
    }
  }
  const lib: MapGhosts = {
    mapId,
    mapName: typeof stored?.mapName === 'string' && stored.mapName ? stored.mapName : mapName,
    chosen: typeof stored?.chosen === 'string' ? stored.chosen : 'best',
    entries,
  };
  // Bring over the best run saved by earlier versions.
  const old = checkGhost(read(oldKey(mapId)));
  if (old && old.mapId === mapId) {
    if (!entries.some((e) => e.ghost.recordedAt === old.recordedAt && e.ghost.time === old.time)) entries.push(newEntry(old, 'mine'));
    if (saveGhosts(lib)) remove(oldKey(mapId));
  }
  return lib;
}

/** Saves the library; false if the browser would not store it (usually because storage is full). */
export function saveGhosts(lib: MapGhosts): boolean {
  const stored: Stored = {
    mapName: lib.mapName,
    chosen: lib.chosen,
    entries: lib.entries.map((e) => ({ ...e, ghost: packGhost(e.ghost) })),
  };
  return write(key(lib.mapId), stored);
}

function newEntry(ghost: GhostRecording, source: GhostSource, label = ''): GhostEntry {
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, source, label, pinned: false, ghost };
}

/** Your fastest own run on this map. */
export function bestRun(lib: MapGhosts): GhostEntry | null {
  let best: GhostEntry | null = null;
  for (const e of lib.entries) if (e.source === 'mine' && (!best || e.ghost.time < best.ghost.time)) best = e;
  return best;
}

/** The ghost to race in solo, following the player's choice. */
export function chosenGhost(lib: MapGhosts): GhostEntry | null {
  if (lib.chosen === 'none') return null;
  return lib.entries.find((e) => e.id === lib.chosen) ?? bestRun(lib);
}

/**
 * Keeps your best run, anything pinned, your latest few runs and the latest
 * ghosts from others; the rest go.
 */
function prune(lib: MapGhosts): void {
  const { keepRecent, keepOthers } = DEFAULT_CONFIG.ghost;
  const best = bestRun(lib);
  const newest = (a: GhostEntry, b: GhostEntry) => b.ghost.recordedAt.localeCompare(a.ghost.recordedAt);
  const recentMine = lib.entries.filter((e) => e.source === 'mine' && !e.pinned && e !== best).sort(newest).slice(0, keepRecent);
  const recentOthers = lib.entries.filter((e) => e.source !== 'mine' && !e.pinned).sort(newest).slice(0, keepOthers);
  const keep = new Set<GhostEntry>([...recentMine, ...recentOthers, ...lib.entries.filter((e) => e.pinned)]);
  if (best) keep.add(best);
  lib.entries = lib.entries.filter((e) => keep.has(e));
  if (lib.chosen !== 'best' && lib.chosen !== 'none' && !lib.entries.some((e) => e.id === lib.chosen)) lib.chosen = 'best';
}

/** Adds a ghost to its map's library and saves it. */
export function addGhost(map: GameMap, ghost: GhostRecording, source: GhostSource, label = ''): { lib: MapGhosts; entry: GhostEntry; saved: boolean } {
  const lib = loadGhosts(map.id, map.name);
  lib.mapName = map.name;
  const entry = newEntry(ghost, source, label);
  lib.entries.push(entry);
  prune(lib);
  return { lib, entry, saved: saveGhosts(lib) };
}

export function updateGhosts(mapId: string, change: (lib: MapGhosts) => void): MapGhosts {
  const lib = loadGhosts(mapId);
  change(lib);
  prune(lib);
  saveGhosts(lib);
  return lib;
}

/** What a ghost is called in lists. */
export function ghostTitle(e: GhostEntry, best: GhostEntry | null): string {
  if (e.label) return e.label;
  if (e.source === 'mine') return e === best ? 'Your best run' : 'Your run';
  return e.ghost.playerName;
}

export function ghostDetail(e: GhostEntry): string {
  const when = new Date(e.ghost.recordedAt);
  const date = Number.isNaN(when.getTime()) || when.getTime() === 0
    ? ''
    : when.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const from = e.source === 'mine' ? 'solo' : e.source === 'race' ? 'from a race' : 'from a file';
  return [from, date].filter(Boolean).join(', ');
}

/** Offers a ghost as a file to save. */
export function exportGhost(map: GameMap, ghost: GhostRecording): void {
  const file = encodeGhostFile(ghost, map);
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ghost';
  link.href = url;
  link.download = `${slug(map.name)}-${slug(ghost.playerName)}.cursar-ghost.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
