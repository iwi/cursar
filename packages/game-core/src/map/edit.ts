import {
  ENEMY_KINDS,
  type EnemySpawn,
  type GameMap,
  LANDMARK_KINDS,
  type Landmark,
  type Obstacle,
  type Point,
  type Rect,
  TERRAIN,
  TRAP_KINDS,
  type Trap,
  Tile,
} from './types';
import { validateMap } from './validate';

/**
 * Maze cells, as the generator and the editor use them: each cell is a 2x2
 * patch of floor, with 1-tile walls (and posts at the corners) between cells.
 * A map of `cols` x `rows` cells is `cols * 3 + 1` tiles wide.
 */
export const CELL_PITCH = 3;

/** Smallest and largest maps the editor makes, in cells. */
export const EDITOR_LIMITS = { minCols: 5, minRows: 5, maxCols: 30, maxRows: 22 } as const;

/** The map's size in cells, or null if it is not laid out on the cell grid. */
export function cellGrid(map: Pick<GameMap, 'width' | 'height'>): { cols: number; rows: number } | null {
  if ((map.width - 1) % CELL_PITCH !== 0 || (map.height - 1) % CELL_PITCH !== 0) return null;
  return { cols: (map.width - 1) / CELL_PITCH, rows: (map.height - 1) / CELL_PITCH };
}

export function cellCentre(c: number, r: number): Point {
  return { x: c * CELL_PITCH + 2, y: r * CELL_PITCH + 2 };
}

/** The 2x2 floor of a cell, as a zone (checkpoints and the finish use it). */
export function cellRect(c: number, r: number): Rect {
  return { x: c * CELL_PITCH + 1, y: r * CELL_PITCH + 1, w: 2, h: 2 };
}

/** The tiles of the wall between cell (c, r) and its neighbour one step (dx, dy) away. */
export function wallTiles(c: number, r: number, dx: number, dy: number): Point[] {
  if (dx !== 0) {
    const x = (dx > 0 ? c + 1 : c) * CELL_PITCH;
    return [{ x, y: r * CELL_PITCH + 1 }, { x, y: r * CELL_PITCH + 2 }];
  }
  const y = (dy > 0 ? r + 1 : r) * CELL_PITCH;
  return [{ x: c * CELL_PITCH + 1, y }, { x: c * CELL_PITCH + 2, y }];
}

/** Eight start places in the 2x2-cell block whose top-left cell is (c, r): room for eight runners. */
export function startPositionsAt(c: number, r: number): Point[] {
  const sx = c * CELL_PITCH + 1;
  const sy = r * CELL_PITCH + 1;
  const out: Point[] = [];
  for (const oy of [1, 2.5, 4]) {
    for (const ox of [1, 2.5, 4]) {
      if (ox === 2.5 && oy === 2.5) continue;
      out.push({ x: sx + ox, y: sy + oy });
    }
  }
  return out;
}

export function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

/** Makes every tile of cells (c0, r0)..(c1, r1) floor, walls and posts between them included: a plaza. */
export function openBlock(map: GameMap, c0: number, r0: number, c1: number, r1: number): void {
  for (let y = r0 * CELL_PITCH + 1; y <= r1 * CELL_PITCH + 2; y++) {
    for (let x = c0 * CELL_PITCH + 1; x <= c1 * CELL_PITCH + 2; x++) {
      if (map.tiles[tileIndex(map, x, y)] === Tile.Wall) map.tiles[tileIndex(map, x, y)] = Tile.Floor;
    }
  }
}

/**
 * A blank map of `cols` x `rows` cells: every cell walled off, the start
 * plaza in the top-left corner (open) and the finish in the far corner.
 */
export function blankMap(cols: number, rows: number, name = 'My map'): GameMap {
  const width = cols * CELL_PITCH + 1;
  const height = rows * CELL_PITCH + 1;
  const tiles = new Array<number>(width * height).fill(Tile.Wall);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { x, y } = cellRect(c, r);
      for (let ty = y; ty < y + 2; ty++) for (let tx = x; tx < x + 2; tx++) tiles[ty * width + tx] = Tile.Floor;
    }
  }
  const map: GameMap = {
    schema: 1,
    id: '',
    name,
    version: 1,
    width,
    height,
    tiles,
    startPositions: startPositionsAt(0, 0),
    finish: cellRect(cols - 1, rows - 1),
    checkpoints: [],
    landmarks: [],
    obstacles: [],
    traps: [],
    enemies: [],
    treasures: [],
  };
  openBlock(map, 0, 0, 1, 1);
  map.id = contentId(map);
  return map;
}

/** A short hash of the map's layout and contents: the id of a hand-made map, so ghosts stay with the exact map. */
export function contentId(map: GameMap): string {
  const { id: _id, name: _name, generator: _generator, ...content } = map;
  const text = JSON.stringify(content);
  let h1 = 0x811c9dc5;
  let h2 = 0x12345678;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
  }
  return `custom-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** A map in the form it is saved, sent and exported: tiles as a string of digits, which is far shorter. */
export type EncodedMap = Omit<GameMap, 'tiles'> & { tiles: string };

export function encodeMap(map: GameMap): EncodedMap {
  return { ...map, tiles: map.tiles.join('') };
}

/** Limits on what a map may hold, so a map from a file or another player cannot be absurd. */
const MAX = { side: 200, starts: 16, checkpoints: 12, landmarks: 40, obstacles: 40, traps: 80, enemies: 40, path: 30, treasures: 60, name: 40 };

export type DecodeResult = { ok: true; map: GameMap } | { ok: false; error: string };

/**
 * Reads a map from a file, the browser's storage or the network, trusting
 * nothing: every field is checked, the map must be playable (`validateMap`),
 * and its id is worked out again from its contents.
 */
export function decodeMap(raw: unknown): DecodeResult {
  const fail = (error: string): DecodeResult => ({ ok: false, error });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('Not a map.');
  const m = raw as Record<string, unknown>;
  if (m.schema !== 1) return fail('Not a Cursar map (unknown format).');
  const width = m.width;
  const height = m.height;
  if (!isInt(width) || !isInt(height) || width < 5 || height < 5 || width > MAX.side || height > MAX.side) return fail('The map size is not valid.');
  const inside = (x: unknown, y: unknown) => isNum(x) && isNum(y) && x >= 0 && y >= 0 && x <= width && y <= height;
  const point = (p: unknown): Point | null => {
    if (typeof p !== 'object' || p === null) return null;
    const q = p as Record<string, unknown>;
    return inside(q.x, q.y) ? { x: q.x as number, y: q.y as number } : null;
  };
  const rect = (v: unknown, maxSide = 10): Rect | null => {
    if (typeof v !== 'object' || v === null) return null;
    const q = v as Record<string, unknown>;
    if (!isNum(q.w) || !isNum(q.h) || q.w <= 0 || q.h <= 0 || q.w > maxSide || q.h > maxSide) return null;
    if (!inside(q.x, q.y) || !inside((q.x as number) + q.w, (q.y as number) + q.h)) return null;
    return { x: q.x as number, y: q.y as number, w: q.w, h: q.h };
  };
  const list = (v: unknown, max: number): unknown[] | null => (v === undefined ? [] : Array.isArray(v) && v.length <= max ? v : null);
  const phase = (v: unknown) => (isNum(v) ? v - Math.floor(v) : 0);

  let tiles: number[];
  if (typeof m.tiles === 'string' && /^[0-9]*$/.test(m.tiles)) tiles = [...m.tiles].map(Number);
  else if (Array.isArray(m.tiles) && m.tiles.every(isInt)) tiles = m.tiles as number[];
  else return fail('The map’s tiles are not valid.');
  if (tiles.length !== width * height || tiles.some((t) => TERRAIN[t] === undefined)) return fail('The map’s tiles are not valid.');

  const starts = list(m.startPositions, MAX.starts)?.map(point);
  if (!starts || starts.length === 0 || starts.some((p) => !p)) return fail('The start positions are not valid.');
  const finish = rect(m.finish);
  if (!finish) return fail('The finish is not valid.');
  const checkpoints = list(m.checkpoints, MAX.checkpoints)?.map((c) => rect(c));
  if (!checkpoints || checkpoints.some((c) => !c)) return fail('The checkpoints are not valid.');

  const landmarks: Landmark[] = [];
  for (const v of list(m.landmarks, MAX.landmarks) ?? [null]) {
    const p = point(v);
    const kind = (v as { kind?: unknown } | null)?.kind;
    if (!p || !(LANDMARK_KINDS as readonly unknown[]).includes(kind)) return fail('The landmarks are not valid.');
    landmarks.push({ ...p, kind: kind as Landmark['kind'] });
  }

  const obstacles: Obstacle[] = [];
  for (const v of list(m.obstacles, MAX.obstacles) ?? [null]) {
    const o = (v ?? {}) as Record<string, unknown>;
    if (o.kind === 'boulder' && inside(o.ax, o.ay) && inside(o.bx, o.by)) {
      obstacles.push({ kind: 'boulder', ax: o.ax as number, ay: o.ay as number, bx: o.bx as number, by: o.by as number, phase: phase(o.phase) });
    } else if (o.kind === 'barrier' && inside(o.x, o.y) && (o.dir === 1 || o.dir === -1)) {
      obstacles.push({ kind: 'barrier', x: o.x as number, y: o.y as number, dir: o.dir, phase: phase(o.phase) });
    } else if (o.kind === 'gate' && rect(o, 3)) {
      obstacles.push({ kind: 'gate', ...rect(o, 3)!, phase: phase(o.phase) });
    } else {
      return fail('The moving obstacles are not valid.');
    }
  }

  const traps: Trap[] = [];
  for (const v of list(m.traps, MAX.traps) ?? [null]) {
    const t = (v ?? {}) as Record<string, unknown>;
    if (!(TRAP_KINDS as readonly unknown[]).includes(t.kind) || !isInt(t.x) || !isInt(t.y) || t.x < 0 || t.y < 0 || t.x >= width || t.y >= height) {
      return fail('The traps are not valid.');
    }
    traps.push({ kind: t.kind as Trap['kind'], x: t.x, y: t.y });
  }

  const enemies: EnemySpawn[] = [];
  for (const v of list(m.enemies, MAX.enemies) ?? [null]) {
    const e = (v ?? {}) as Record<string, unknown>;
    if (!(ENEMY_KINDS as readonly unknown[]).includes(e.kind)) return fail('The enemies are not valid.');
    if (e.kind === 'patroller') {
      const path = list(e.path, MAX.path)?.map(point);
      if (!path || path.length === 0 || path.some((p) => !p)) return fail('The enemies are not valid.');
      enemies.push({ kind: 'patroller', path: path as Point[], phase: phase(e.phase) });
    } else {
      const p = point(e);
      if (!p) return fail('The enemies are not valid.');
      enemies.push({ kind: e.kind as 'chaser' | 'turret', ...p });
    }
  }

  const treasures = list(m.treasures, MAX.treasures)?.map(point);
  if (!treasures || treasures.some((p) => !p)) return fail('The treasures are not valid.');

  const name = typeof m.name === 'string' ? m.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX.name) : '';
  const map: GameMap = {
    schema: 1,
    id: '',
    name: name || 'Untitled map',
    version: isInt(m.version) ? m.version : 1,
    width,
    height,
    tiles,
    startPositions: starts as Point[],
    finish,
    checkpoints: checkpoints as Rect[],
    landmarks,
    obstacles,
    traps,
    enemies,
    treasures: treasures as Point[],
  };
  const check = validateMap(map);
  if (!check.ok) return fail(check.errors[0] ?? 'The map cannot be played.');
  map.id = contentId(map);
  return { ok: true, map };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isInt(v: unknown): v is number {
  return Number.isInteger(v);
}
