import { Rng } from '../rng';
import { type GameMap, type Landmark, type LandmarkKind, type Point, Tile } from './types';
import { distanceField } from './distance';
import { validateMap } from './validate';

export type MapSize = 'small' | 'medium' | 'large';

/** Map sizes in maze cells. Each cell is a 2x2-tile patch of floor with 1-tile walls between. */
export const MAP_SIZES: Record<MapSize, { cols: number; rows: number; checkpoints: number; label: string }> = {
  small: { cols: 21, rows: 15, checkpoints: 3, label: 'Small' },
  medium: { cols: 22, rows: 16, checkpoints: 4, label: 'Medium' },
  large: { cols: 24, rows: 17, checkpoints: 5, label: 'Large' },
};

/** Bumped whenever the generator changes, so saved ghosts never play on a different layout. */
const GENERATOR_VERSION = 3;

export interface GenerateOptions {
  seed: string;
  size: MapSize;
  /** Chance that a dead end is opened into a loop (creates alternative routes). */
  loopChance?: number;
  /** Rough share of maze cells covered by mud or ice. */
  terrainShare?: number;
  /** Number of checkpoints (defaults to the size's own count). */
  checkpoints?: number;
}

const PITCH = 3;
const LANDMARK_KINDS: LandmarkKind[] = ['fountain', 'statue', 'tree', 'crystal', 'brazier', 'obelisk'];
const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/**
 * Seeded map generator. The same seed and size always give the same map, so a
 * seed can be shared between friends and ghosts stay valid for it.
 *
 * Layout: a maze with 2-tile-wide corridors, some dead ends opened into loops
 * (shortcuts and route choice), open plazas with distinct landmarks (things to
 * remember during the preview), patches of mud and ice, and checkpoints spread
 * across the map so a race covers most of it.
 */
export function generateMap(options: GenerateOptions): GameMap {
  const { seed, size } = options;
  const loopChance = options.loopChance ?? 0.3;
  const terrainShare = options.terrainShare ?? 0.1;
  const { cols, rows } = MAP_SIZES[size];
  const rng = new Rng(`${size}:${seed}`);
  const width = cols * PITCH + 1;
  const height = rows * PITCH + 1;
  const tiles = new Array<number>(width * height).fill(Tile.Wall);
  const set = (x: number, y: number, t: number) => {
    tiles[y * width + x] = t;
  };
  const get = (x: number, y: number) => tiles[y * width + x]!;

  // Tile rectangle covering maze cells (c0,r0)..(c1,r1) inclusive, interior walls included.
  const fillCells = (c0: number, r0: number, c1: number, r1: number, t: number) => {
    for (let y = r0 * PITCH + 1; y <= r1 * PITCH + 2; y++) {
      for (let x = c0 * PITCH + 1; x <= c1 * PITCH + 2; x++) set(x, y, t);
    }
  };
  const openBetween = (c: number, r: number, dx: number, dy: number) => {
    if (dx !== 0) {
      const x = (dx > 0 ? c + 1 : c) * PITCH;
      set(x, r * PITCH + 1, Tile.Floor);
      set(x, r * PITCH + 2, Tile.Floor);
    } else {
      const y = (dy > 0 ? r + 1 : r) * PITCH;
      set(c * PITCH + 1, y, Tile.Floor);
      set(c * PITCH + 2, y, Tile.Floor);
    }
  };
  const isOpenBetween = (c: number, r: number, dx: number, dy: number) =>
    dx !== 0
      ? get((dx > 0 ? c + 1 : c) * PITCH, r * PITCH + 1) !== Tile.Wall
      : get(c * PITCH + 1, (dy > 0 ? r + 1 : r) * PITCH) !== Tile.Wall;
  const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;

  // 1. Carve every cell, then connect them with a depth-first maze.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) fillCells(c, r, c, r, Tile.Floor);
  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [rng.int(cols * rows)];
  visited[stack[0]!] = 1;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const c = cur % cols;
    const r = (cur - c) / cols;
    const unvisited = DIRS.filter((d) => inGrid(c + d.dx, r + d.dy) && !visited[(r + d.dy) * cols + c + d.dx]);
    if (unvisited.length === 0) {
      stack.pop();
      continue;
    }
    const d = rng.pick(unvisited);
    openBetween(c, r, d.dx, d.dy);
    const next = (r + d.dy) * cols + c + d.dx;
    visited[next] = 1;
    stack.push(next);
  }

  // 2. Open some dead ends into loops so there is more than one way through.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const open = DIRS.filter((d) => inGrid(c + d.dx, r + d.dy) && isOpenBetween(c, r, d.dx, d.dy));
      if (open.length !== 1 || !rng.chance(loopChance)) continue;
      const closed = DIRS.filter((d) => inGrid(c + d.dx, r + d.dy) && !isOpenBetween(c, r, d.dx, d.dy));
      if (closed.length > 0) {
        const d = rng.pick(closed);
        openBetween(c, r, d.dx, d.dy);
      }
    }
  }

  // 3. Start plaza in a random corner (2x2 cells: room for eight runners).
  const startC = rng.chance(0.5) ? 0 : cols - 2;
  const startR = rng.chance(0.5) ? 0 : rows - 2;
  fillCells(startC, startR, startC + 1, startR + 1, Tile.Floor);
  const reserved = new Uint8Array(cols * rows);
  const reserve = (c0: number, r0: number, c1: number, r1: number) => {
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) reserved[r * cols + c] = 1;
    }
  };
  reserve(startC, startR, startC + 1, startR + 1);
  const sx = startC * PITCH + 1;
  const sy = startR * PITCH + 1;
  const startPositions: Point[] = [];
  for (const oy of [1, 2.5, 4]) {
    for (const ox of [1, 2.5, 4]) {
      if (ox === 2.5 && oy === 2.5) continue;
      startPositions.push({ x: sx + ox, y: sy + oy });
    }
  }

  // 4. Landmark plazas: open rooms, each with a different feature in the middle.
  const landmarks: Landmark[] = [];
  const kinds = rng.shuffle([...LANDMARK_KINDS]);
  const roomCount = Math.max(2, Math.round((cols * rows) / 40));
  for (let i = 0, attempts = 0; i < roomCount && attempts < 200; attempts++) {
    const w = rng.chance(0.4) ? 3 : 2;
    const h = 2;
    const c = rng.int(cols - w + 1);
    const r = rng.int(rows - h + 1);
    let clash = false;
    for (let rr = r - 1; rr <= r + h && !clash; rr++) {
      for (let cc = c - 1; cc <= c + w && !clash; cc++) {
        if (inGrid(cc, rr) && reserved[rr * cols + cc]) clash = true;
      }
    }
    if (clash) continue;
    fillCells(c, r, c + w - 1, r + h - 1, Tile.Floor);
    reserve(c, r, c + w - 1, r + h - 1);
    landmarks.push({
      x: c * PITCH + 1 + (w * PITCH - 1) / 2,
      y: r * PITCH + 1 + (h * PITCH - 1) / 2,
      kind: kinds[i % kinds.length]!,
    });
    i++;
  }

  // 5. Finish: the cell that is the longest walk from the start.
  const base: GameMap = {
    schema: 1,
    id: `gen${GENERATOR_VERSION}-${size}-${seed}`,
    name: `${MAP_SIZES[size].label} run “${seed}”`,
    version: GENERATOR_VERSION,
    width,
    height,
    tiles,
    startPositions,
    finish: { x: 0, y: 0, w: 0, h: 0 },
    checkpoints: [],
    landmarks,
    generator: { seed, size },
  };
  const fromStart = distanceField(base, { x: sx, y: sy, w: 5, h: 5 });
  let best = -1;
  let finishC = 0;
  let finishR = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (reserved[r * cols + c]) continue;
      const d = fromStart[(r * PITCH + 1) * width + c * PITCH + 1]!;
      if (d > best) {
        best = d;
        finishC = c;
        finishR = r;
      }
    }
  }
  base.finish = { x: finishC * PITCH + 1, y: finishR * PITCH + 1, w: 2, h: 2 };
  reserve(finishC, finishR, finishC, finishR);

  // 5b. Checkpoints: each one goes as far as possible (by walking distance) from
  // the start, the finish and the checkpoints already placed.
  const checkpointCount = options.checkpoints ?? MAP_SIZES[size].checkpoints;
  const spread = [fromStart, distanceField(base, base.finish)];
  for (let n = 0; n < checkpointCount; n++) {
    let bestGap = -1;
    let pickC = -1;
    let pickR = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (reserved[r * cols + c]) continue;
        const tile = (r * PITCH + 1) * width + c * PITCH + 1;
        let gap = Infinity;
        for (const field of spread) gap = Math.min(gap, field[tile]!);
        if (gap > bestGap) {
          bestGap = gap;
          pickC = c;
          pickR = r;
        }
      }
    }
    if (pickC < 0) break;
    const zone = { x: pickC * PITCH + 1, y: pickR * PITCH + 1, w: 2, h: 2 };
    base.checkpoints.push(zone);
    reserve(pickC, pickR, pickC, pickR);
    spread.push(distanceField(base, zone));
  }

  // 6. Terrain patches: short runs of mud or ice along connected corridor cells.
  let budget = Math.round(cols * rows * terrainShare);
  for (let attempts = 0; budget > 0 && attempts < 300; attempts++) {
    const terrain = rng.chance(0.5) ? Tile.Mud : Tile.Ice;
    let c = rng.int(cols);
    let r = rng.int(rows);
    const run = 2 + rng.int(3);
    for (let n = 0; n < run && budget > 0; n++) {
      if (reserved[r * cols + c]) break;
      fillCellsWhereFloor(c, r, terrain);
      reserved[r * cols + c] = 1;
      budget--;
      const open = DIRS.filter((d) => inGrid(c + d.dx, r + d.dy) && isOpenBetween(c, r, d.dx, d.dy));
      if (open.length === 0) break;
      const d = rng.pick(open);
      c += d.dx;
      r += d.dy;
    }
  }
  function fillCellsWhereFloor(c: number, r: number, t: number) {
    for (let y = r * PITCH + 1; y <= r * PITCH + 2; y++) {
      for (let x = c * PITCH + 1; x <= c * PITCH + 2; x++) if (get(x, y) === Tile.Floor) set(x, y, t);
    }
  }

  const check = validateMap(base);
  if (!check.ok) throw new Error(`Generated map failed validation: ${check.errors.join(' ')}`);
  return base;
}

/** Mirrored copy of a map: a cheap way to make a known map unfamiliar again. */
export function flipMap(map: GameMap, flipX: boolean, flipY: boolean): GameMap {
  if (!flipX && !flipY) return map;
  const { width, height } = map;
  const tiles = new Array<number>(map.tiles.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = flipX ? width - 1 - x : x;
      const srcY = flipY ? height - 1 - y : y;
      tiles[y * width + x] = map.tiles[srcY * width + srcX]!;
    }
  }
  const px = (x: number) => (flipX ? width - x : x);
  const py = (y: number) => (flipY ? height - y : y);
  const rect = (r: { x: number; y: number; w: number; h: number }) => ({
    x: flipX ? width - r.x - r.w : r.x,
    y: flipY ? height - r.y - r.h : r.y,
    w: r.w,
    h: r.h,
  });
  return {
    ...map,
    id: `${map.id}${flipX ? '-fx' : ''}${flipY ? '-fy' : ''}`,
    tiles,
    startPositions: map.startPositions.map((p) => ({ x: px(p.x), y: py(p.y) })),
    finish: rect(map.finish),
    checkpoints: map.checkpoints.map(rect),
    landmarks: map.landmarks.map((l) => ({ ...l, x: px(l.x), y: py(l.y) })),
  };
}
