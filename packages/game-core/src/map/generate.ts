import { Rng } from '../rng';
import { ENEMY_KINDS, type EnemySpawn, type GameMap, type Landmark, type LandmarkKind, type Obstacle, type Point, TRAP_KINDS, type Trap, Tile } from './types';
import { distanceField } from './distance';
import { validateMap } from './validate';

export type MapSize = 'tiny' | 'small' | 'medium' | 'large';

/** Map sizes in maze cells. Each cell is a 2x2-tile patch of floor with 1-tile walls between. */
export const MAP_SIZES: Record<
  MapSize,
  { cols: number; rows: number; checkpoints: number; obstacles: number; traps: number; enemies: number; chasers: number; treasures: number; label: string }
> = {
  tiny: { cols: 15, rows: 11, checkpoints: 2, obstacles: 3, traps: 3, enemies: 2, chasers: 1, treasures: 3, label: 'Tiny' },
  small: { cols: 21, rows: 15, checkpoints: 3, obstacles: 5, traps: 6, enemies: 3, chasers: 2, treasures: 6, label: 'Small' },
  medium: { cols: 22, rows: 16, checkpoints: 4, obstacles: 6, traps: 8, enemies: 4, chasers: 2, treasures: 8, label: 'Medium' },
  large: { cols: 24, rows: 17, checkpoints: 5, obstacles: 7, traps: 10, enemies: 5, chasers: 2, treasures: 10, label: 'Large' },
};

/** Bumped whenever the generator changes, so saved ghosts never play on a different layout. */
const GENERATOR_VERSION = 9;

export interface GenerateOptions {
  seed: string;
  size: MapSize;
  /** Chance that a dead end is opened into a loop (creates alternative routes). */
  loopChance?: number;
  /** Rough share of maze cells covered by mud or ice. */
  terrainShare?: number;
  /** Number of checkpoints (defaults to the size's own count). */
  checkpoints?: number;
  /** Number of moving obstacles (defaults to the size's own count). */
  obstacles?: number;
  /** Number of traps (defaults to the size's own count). */
  traps?: number;
  /** Number of enemies, taking turns by kind (defaults to the size's own count). */
  enemies?: number;
  /** Extra chasers on top of those (defaults to the size's own count). */
  chasers?: number;
  /** Number of treasures (defaults to the size's own count). */
  treasures?: number;
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

  // 5. Moving obstacles, roughly a third of each kind (placed before the finish
  //    and checkpoints, which are then spread over the maze as it finally is):
  //    - barriers turn round the landmark in a plaza;
  //    - boulders roll along straight corridors of 4 to 6 plain cells;
  //    - gates sit in the openings between two plain corridor cells.
  // Nothing is placed in the start plaza; the finish, checkpoints and terrain keep off them.
  const obstacleCount = options.obstacles ?? MAP_SIZES[size].obstacles;
  const obstacles: Obstacle[] = [];
  const free = (c: number, r: number) => inGrid(c, r) && !reserved[r * cols + c];
  const centre = (c: number, r: number) => ({ x: c * PITCH + 2, y: r * PITCH + 2 });

  const barrierCount = Math.min(landmarks.length, Math.round(obstacleCount / 3));
  for (const mark of rng.shuffle([...landmarks]).slice(0, barrierCount)) {
    obstacles.push({ kind: 'barrier', x: mark.x, y: mark.y, dir: rng.chance(0.5) ? 1 : -1, phase: rng.next() });
  }

  const runs: { c: number; r: number; dx: number; dy: number; len: number }[] = [];
  for (const d of [DIRS[0]!, DIRS[2]!]) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Only start a run where the previous cell does not continue it.
        if (free(c - d.dx, r - d.dy) && isOpenBetween(c - d.dx, r - d.dy, d.dx, d.dy)) continue;
        let len = 0;
        while (free(c + d.dx * len, r + d.dy * len) && (len === 0 || isOpenBetween(c + d.dx * (len - 1), r + d.dy * (len - 1), d.dx, d.dy))) len++;
        if (len >= 4) runs.push({ c, r, dx: d.dx, dy: d.dy, len });
      }
    }
  }
  const gateCount = Math.round(obstacleCount / 3);
  const boulderCount = obstacleCount - barrierCount - gateCount;
  let boulders = 0;
  for (const run of rng.shuffle(runs)) {
    if (boulders >= boulderCount) break;
    const len = Math.min(run.len, 4 + rng.int(3));
    const skip = rng.int(run.len - len + 1);
    const c0 = run.c + run.dx * skip;
    const r0 = run.r + run.dy * skip;
    let clear = true;
    for (let n = 0; n < len; n++) if (!free(c0 + run.dx * n, r0 + run.dy * n)) clear = false;
    if (!clear) continue;
    const a = centre(c0, r0);
    const b = centre(c0 + run.dx * (len - 1), r0 + run.dy * (len - 1));
    obstacles.push({ kind: 'boulder', ax: a.x, ay: a.y, bx: b.x, by: b.y, phase: rng.next() });
    // The boulder fills the corridor, so there must be side passages to duck
    // into: every cell along it has an opening to the side (one is carved
    // where there is none). Without them it could not be passed unhurt, and
    // slower runners (Easy computer players) need one within a few steps.
    const sides = run.dx !== 0 ? [DIRS[2]!, DIRS[3]!] : [DIRS[0]!, DIRS[1]!];
    for (let n = 0; n < len; n++) {
      const c = c0 + run.dx * n;
      const r = r0 + run.dy * n;
      const options = sides.filter((d) => inGrid(c + d.dx, r + d.dy));
      if (options.some((d) => isOpenBetween(c, r, d.dx, d.dy))) continue;
      const d = rng.pick(options);
      openBetween(c, r, d.dx, d.dy);
    }
    // Keep other obstacles off the boulder's corridor, its side passages and the cells beside its ends.
    reserve(Math.min(c0, c0 + run.dx * (len - 1)) - 1, Math.min(r0, r0 + run.dy * (len - 1)) - 1,
      Math.max(c0, c0 + run.dx * (len - 1)) + 1, Math.max(r0, r0 + run.dy * (len - 1)) + 1);
    boulders++;
  }

  const wantedGates = obstacleCount - obstacles.length;
  for (let attempts = 0, gates = 0; gates < wantedGates && attempts < 400; attempts++) {
    const c = rng.int(cols);
    const r = rng.int(rows);
    const d = rng.pick(DIRS);
    if (!free(c, r) || !free(c + d.dx, r + d.dy) || !isOpenBetween(c, r, d.dx, d.dy)) continue;
    obstacles.push(
      d.dx !== 0
        ? { kind: 'gate', x: (d.dx > 0 ? c + 1 : c) * PITCH, y: r * PITCH + 1, w: 1, h: 2, phase: rng.next() }
        : { kind: 'gate', x: c * PITCH + 1, y: (d.dy > 0 ? r + 1 : r) * PITCH, w: 2, h: 1, phase: rng.next() },
    );
    reserve(Math.min(c, c + d.dx) - 1, Math.min(r, r + d.dy) - 1, Math.max(c, c + d.dx) + 1, Math.max(r, r + d.dy) + 1);
    gates++;
  }

  // 6. Finish: the cell that is the longest walk from the start.
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
    obstacles,
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

  // 6b. Checkpoints: each one goes as far as possible (by walking distance) from
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

  // 7. Terrain patches: short runs of mud or ice along connected corridor cells.
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


  // 8. Traps: one tile in a plain corridor cell (not in plazas, in or next to
  //    the start, the finish, checkpoints, mud or ice, or near an obstacle), at least a
  //    cell apart. A corridor is two tiles wide, so a runner who remembers a
  //    trap can step round it. The kinds take turns, so every kind appears.
  const trapCount = options.traps ?? MAP_SIZES[size].traps;
  const trapKinds = rng.shuffle([...TRAP_KINDS]);
  const traps: Trap[] = [];
  for (let attempts = 0; traps.length < trapCount && attempts < 600; attempts++) {
    const c = rng.int(cols);
    const r = rng.int(rows);
    if (!free(c, r)) continue;
    // Not right outside the start, where everyone leaves together.
    if (c >= startC - 1 && c <= startC + 2 && r >= startR - 1 && r <= startR + 2) continue;
    const x = c * PITCH + 1 + rng.int(2);
    const y = r * PITCH + 1 + rng.int(2);
    if (get(x, y) !== Tile.Floor) continue;
    traps.push({ kind: trapKinds[traps.length % trapKinds.length]!, x, y });
    reserve(c - 1, r - 1, c + 1, r + 1);
  }
  base.traps = traps;

  // 9. Enemies, taking turns by kind, in plain cells away from the start and
  //    from everything placed so far:
  //    - patrollers walk a winding beat of 4 to 7 cells that turns at least one corner;
  //    - chasers sleep in a dead end if there is one free (a lair), else any cell;
  //    - turrets stand in a cell, watching the corridors round it.
  //    After the kinds have taken turns come the extra chasers.
  const turnCount = options.enemies ?? MAP_SIZES[size].enemies;
  const enemyCount = turnCount + (options.chasers ?? MAP_SIZES[size].chasers);
  const turnKinds = rng.shuffle([...ENEMY_KINDS]);
  const kindOf = (n: number) => (n < turnCount ? turnKinds[n % turnKinds.length]! : 'chaser');
  const enemies: EnemySpawn[] = [];
  const nearStart = (c: number, r: number) => c >= startC - 1 && c <= startC + 2 && r >= startR - 1 && r <= startR + 2;
  const openSides = (c: number, r: number) => DIRS.filter((d) => inGrid(c + d.dx, r + d.dy) && isOpenBetween(c, r, d.dx, d.dy)).length;
  const freeCells = () => {
    const cells: { c: number; r: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (free(c, r) && !nearStart(c, r)) cells.push({ c, r });
    return cells;
  };
  for (let n = 0; n < enemyCount; n++) {
    const kind = kindOf(n);
    if (kind === 'patroller') {
      const beat = findBeat();
      if (beat) {
        enemies.push({ kind: 'patroller', path: beat.map(({ c, r }) => centre(c, r)), phase: rng.next() });
        for (const { c, r } of beat) reserve(c - 1, r - 1, c + 1, r + 1);
        continue;
      }
    }
    const cells = freeCells();
    if (cells.length === 0) break;
    const lairs = cells.filter(({ c, r }) => openSides(c, r) === 1);
    const { c, r } = rng.pick(kind === 'chaser' && lairs.length > 0 ? lairs : cells);
    const at = centre(c, r);
    // A patroller with no beat free becomes a chaser instead.
    enemies.push(kind === 'turret' ? { kind: 'turret', x: at.x, y: at.y } : { kind: 'chaser', x: at.x, y: at.y });
    reserve(c - 1, r - 1, c + 1, r + 1);
  }
  base.enemies = enemies;

  /** A patroller's beat: a walk along open corridor cells, 4 to 7 long, turning at least one corner. */
  function findBeat(): { c: number; r: number }[] | null {
    const ok = (c: number, r: number) => free(c, r) && !nearStart(c, r);
    for (const startCell of rng.shuffle(freeCells())) {
      const target = 4 + rng.int(4);
      const beat = [startCell];
      const seen = new Set([startCell.r * cols + startCell.c]);
      while (beat.length < target) {
        const { c, r } = beat[beat.length - 1]!;
        const next = DIRS.filter((d) => ok(c + d.dx, r + d.dy) && !seen.has((r + d.dy) * cols + c + d.dx) && isOpenBetween(c, r, d.dx, d.dy));
        if (next.length === 0) break;
        const d = rng.pick(next);
        beat.push({ c: c + d.dx, r: r + d.dy });
        seen.add((r + d.dy) * cols + c + d.dx);
      }
      if (beat.length < 4) continue;
      const turns = beat.some((cell, i) => i >= 2 && cell.c !== beat[i - 2]!.c && cell.r !== beat[i - 2]!.r);
      if (turns) return beat;
    }
    return null;
  }

  // 10. Treasures, in plain cells away from the start and each other, dead
  //     ends first: fetching one is a detour, so it is a route choice.
  const treasureCount = options.treasures ?? MAP_SIZES[size].treasures;
  const treasures: Point[] = [];
  for (let n = 0; n < treasureCount; n++) {
    const cells = freeCells();
    if (cells.length === 0) break;
    const ends = cells.filter(({ c, r }) => openSides(c, r) === 1);
    const { c, r } = rng.pick(ends.length > 0 ? ends : cells);
    treasures.push(centre(c, r));
    reserve(c - 1, r - 1, c + 1, r + 1);
  }
  base.treasures = treasures;

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
    obstacles: map.obstacles?.map((o): Obstacle => {
      if (o.kind === 'boulder') return { ...o, ax: px(o.ax), ay: py(o.ay), bx: px(o.bx), by: py(o.by) };
      // A mirror image turns the other way.
      if (o.kind === 'barrier') return { ...o, x: px(o.x), y: py(o.y), dir: flipX !== flipY ? (-o.dir as 1 | -1) : o.dir };
      return { ...o, ...rect(o) };
    }),
    traps: map.traps?.map((t) => ({ ...t, x: flipX ? width - 1 - t.x : t.x, y: flipY ? height - 1 - t.y : t.y })),
    treasures: map.treasures?.map((t) => ({ x: px(t.x), y: py(t.y) })),
    enemies: map.enemies?.map((e): EnemySpawn =>
      e.kind === 'patroller' ? { ...e, path: e.path.map((pt) => ({ x: px(pt.x), y: py(pt.y) })) } : { ...e, x: px(e.x), y: py(e.y) },
    ),
  };
}
