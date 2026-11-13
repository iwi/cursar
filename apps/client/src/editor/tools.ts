import {
  type EnemySpawn,
  type GameMap,
  LANDMARK_KINDS,
  type Obstacle,
  type Point,
  Tile,
  type TrapKind,
  cellCentre,
  cellGrid,
  cellRect,
  openBlock,
  startPositionsAt,
  wallTiles,
} from '@cursar/game-core';

export type ToolId =
  | 'wall'
  | 'floor'
  | 'mud'
  | 'ice'
  | 'start'
  | 'finish'
  | 'checkpoint'
  | 'landmark'
  | 'trap'
  | 'treasure'
  | 'chaser'
  | 'turret'
  | 'patroller'
  | 'boulder'
  | 'gate'
  | 'barrier'
  | 'erase';

export interface ToolInfo {
  id: ToolId;
  label: string;
  group: 'Ground' | 'Race' | 'Hazards' | 'Enemies' | 'Obstacles' | 'Edit';
  hint: string;
}

export const TOOLS: ToolInfo[] = [
  { id: 'wall', label: 'Walls', group: 'Ground', hint: 'Click or drag along the walls between cells to open or close them. Click a corner post too, to make a plaza.' },
  { id: 'floor', label: 'Floor', group: 'Ground', hint: 'Paint cells back to plain floor.' },
  { id: 'mud', label: 'Mud', group: 'Ground', hint: 'Paint cells with mud (slow).' },
  { id: 'ice', label: 'Ice', group: 'Ground', hint: 'Paint cells with ice (slippery).' },
  { id: 'start', label: 'Start', group: 'Race', hint: 'Click a cell: the start plaza (2×2 cells, room for eight) goes there.' },
  { id: 'finish', label: 'Finish', group: 'Race', hint: 'Click a cell to put the finish there.' },
  { id: 'checkpoint', label: 'Checkpoint', group: 'Race', hint: 'Click a cell to add or remove a checkpoint.' },
  { id: 'landmark', label: 'Landmark', group: 'Race', hint: 'Click a cell (or the post in a plaza) to add a landmark; click again to change its kind, until it is removed.' },
  { id: 'trap', label: 'Trap', group: 'Hazards', hint: 'Click a floor tile to add or remove a trap of the chosen kind.' },
  { id: 'treasure', label: 'Treasure', group: 'Hazards', hint: 'Click a cell to add or remove a coin.' },
  { id: 'chaser', label: 'Chaser', group: 'Enemies', hint: 'Click a cell for a chaser’s home (a dead end makes a good lair).' },
  { id: 'turret', label: 'Turret', group: 'Enemies', hint: 'Click a cell to add or remove a turret.' },
  { id: 'patroller', label: 'Patroller', group: 'Enemies', hint: 'Click cells one after another along open corridors to draw its beat; click the last cell again to finish. Esc cancels.' },
  { id: 'boulder', label: 'Boulder', group: 'Obstacles', hint: 'Click one end of a straight open corridor, then the other end.' },
  { id: 'gate', label: 'Gate', group: 'Obstacles', hint: 'Click an opening between two cells to add or remove a gate.' },
  { id: 'barrier', label: 'Barrier', group: 'Obstacles', hint: 'Click a landmark to put a turning barrier round it (click again: other way, then off). Needs an open plaza.' },
  { id: 'erase', label: 'Erase', group: 'Edit', hint: 'Click anything placed to remove it.' },
];

/** What is under the pointer: a cell, the wall between two cells, or a corner post. */
export type Spot =
  | { kind: 'cell'; c: number; r: number }
  | { kind: 'wall'; c: number; r: number; dx: 1 | 0; dy: 1 | 0 }
  | { kind: 'post'; c: number; r: number };

/** Works out the spot under a point in tiles (null outside the grid or on its outer wall). */
export function spotAt(map: GameMap, fx: number, fy: number): Spot | null {
  const grid = cellGrid(map)!;
  const c = Math.floor(fx / 3);
  const r = Math.floor(fy / 3);
  const lx = fx - c * 3;
  const ly = fy - r * 3;
  if (lx >= 1 && ly >= 1) return c < grid.cols && r < grid.rows ? { kind: 'cell', c, r } : null;
  if (lx < 1 && ly >= 1) return c > 0 && c < grid.cols && r < grid.rows ? { kind: 'wall', c: c - 1, r, dx: 1, dy: 0 } : null;
  if (ly < 1 && lx >= 1) return r > 0 && r < grid.rows && c < grid.cols ? { kind: 'wall', c, r: r - 1, dx: 0, dy: 1 } : null;
  return c > 0 && r > 0 && c < grid.cols && r < grid.rows ? { kind: 'post', c, r } : null;
}

/** The tiles a wall or post spot covers. */
export function spotTiles(spot: Spot): Point[] {
  if (spot.kind === 'wall') return wallTiles(spot.c, spot.r, spot.dx, spot.dy);
  if (spot.kind === 'post') return [{ x: spot.c * 3, y: spot.r * 3 }];
  const { x, y } = cellRect(spot.c, spot.r);
  return [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
}

const at = (map: GameMap, p: Point) => map.tiles[p.y * map.width + p.x]!;
const put = (map: GameMap, p: Point, t: number) => (map.tiles[p.y * map.width + p.x] = t);

/** Whether a wall or post spot is open. */
export function isOpen(map: GameMap, spot: Spot): boolean {
  return spotTiles(spot).every((p) => at(map, p) !== Tile.Wall);
}

/** Opens or closes a wall or post. */
export function setOpen(map: GameMap, spot: Spot, open: boolean): void {
  for (const p of spotTiles(spot)) put(map, p, open ? Tile.Floor : Tile.Wall);
}

export function paintCell(map: GameMap, c: number, r: number, tile: number): void {
  for (const p of spotTiles({ kind: 'cell', c, r })) put(map, p, tile);
}

/** Opens the walls between two neighbouring cells, if they are neighbours; returns whether they were. */
function neighbours(a: { c: number; r: number }, b: { c: number; r: number }): boolean {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1;
}

export function openBetween(map: GameMap, a: { c: number; r: number }, b: { c: number; r: number }): boolean {
  if (!neighbours(a, b)) return false;
  const spot: Spot = b.c > a.c || b.r > a.r
    ? { kind: 'wall', c: a.c, r: a.r, dx: b.c > a.c ? 1 : 0, dy: b.r > a.r ? 1 : 0 }
    : { kind: 'wall', c: b.c, r: b.r, dx: a.c > b.c ? 1 : 0, dy: a.r > b.r ? 1 : 0 };
  return isOpen(map, spot);
}

/** A steady spread of phases for newly placed moving things, so they do not all move in step. */
function nextPhase(map: GameMap): number {
  const n = (map.obstacles?.length ?? 0) + (map.enemies?.length ?? 0);
  return (n * 0.618034) % 1;
}

const near = (a: Point, b: Point, d = 0.6) => Math.hypot(a.x - b.x, a.y - b.y) < d;

export function placeStart(map: GameMap, c: number, r: number): void {
  const grid = cellGrid(map)!;
  const sc = Math.min(c, grid.cols - 2);
  const sr = Math.min(r, grid.rows - 2);
  openBlock(map, sc, sr, sc + 1, sr + 1);
  map.startPositions = startPositionsAt(sc, sr);
}

export function toggleCheckpoint(map: GameMap, c: number, r: number): string | null {
  const zone = cellRect(c, r);
  const i = map.checkpoints.findIndex((z) => z.x === zone.x && z.y === zone.y);
  if (i >= 0) map.checkpoints.splice(i, 1);
  else if (map.checkpoints.length >= 12) return 'At most 12 checkpoints.';
  else map.checkpoints.push(zone);
  return null;
}

/** Adds a landmark at `p`, or turns the one there into the next kind, or removes it after the last kind. */
export function cycleLandmark(map: GameMap, p: Point): void {
  const i = map.landmarks.findIndex((l) => near(l, p));
  if (i < 0) {
    map.landmarks.push({ ...p, kind: LANDMARK_KINDS[map.landmarks.length % LANDMARK_KINDS.length]! });
    return;
  }
  const mark = map.landmarks[i]!;
  const k = LANDMARK_KINDS.indexOf(mark.kind);
  if (k === LANDMARK_KINDS.length - 1) {
    map.landmarks.splice(i, 1);
    map.obstacles = (map.obstacles ?? []).filter((o) => !(o.kind === 'barrier' && near(o, mark)));
  } else {
    mark.kind = LANDMARK_KINDS[k + 1]!;
  }
}

/** Where a landmark goes for a spot: a cell's centre, or the middle of a post. */
export function landmarkPoint(spot: Spot): Point | null {
  if (spot.kind === 'cell') return cellCentre(spot.c, spot.r);
  if (spot.kind === 'post') return { x: spot.c * 3 + 0.5, y: spot.r * 3 + 0.5 };
  return null;
}

export function toggleTrap(map: GameMap, x: number, y: number, kind: TrapKind): string | null {
  if (at(map, { x, y }) === Tile.Wall) return 'Traps go on floor.';
  const traps = (map.traps ??= []);
  const i = traps.findIndex((t) => t.x === x && t.y === y);
  if (i >= 0 && traps[i]!.kind === kind) traps.splice(i, 1);
  else if (i >= 0) traps[i]!.kind = kind;
  else traps.push({ kind, x, y });
  return null;
}

export function toggleTreasure(map: GameMap, c: number, r: number): void {
  const p = cellCentre(c, r);
  const list = (map.treasures ??= []);
  const i = list.findIndex((t) => near(t, p));
  if (i >= 0) list.splice(i, 1);
  else list.push(p);
}

export function toggleFoe(map: GameMap, c: number, r: number, kind: 'chaser' | 'turret'): void {
  const p = cellCentre(c, r);
  const list = (map.enemies ??= []);
  const i = list.findIndex((e) => e.kind === kind && near(e, p));
  if (i >= 0) list.splice(i, 1);
  else list.push({ kind, ...p });
}

/**
 * Patroller beats are drawn cell by cell. Returns the path so far, or null
 * once finished (clicking the last cell again), with an error for a cell that
 * does not follow on through an opening.
 */
export function extendBeat(map: GameMap, path: { c: number; r: number }[], c: number, r: number): { path: { c: number; r: number }[] | null; error?: string } {
  const last = path[path.length - 1];
  if (last && last.c === c && last.r === r) {
    if (path.length < 2) return { path: null };
    (map.enemies ??= []).push({ kind: 'patroller', path: path.map((cell) => cellCentre(cell.c, cell.r)), phase: nextPhase(map) });
    return { path: null };
  }
  if (last && !openBetween(map, last, { c, r })) return { path, error: 'The next cell must be next to the last one, through an opening.' };
  if (path.length >= 30) return { path, error: 'A beat can be at most 30 cells.' };
  return { path: [...path, { c, r }] };
}

/** A boulder between two cells in a straight, open line. */
export function placeBoulder(map: GameMap, a: { c: number; r: number }, b: { c: number; r: number }): string | null {
  if (a.c !== b.c && a.r !== b.r) return 'A boulder rolls in a straight line: pick a cell in the same row or column.';
  if (a.c === b.c && a.r === b.r) return 'Pick the other end of the corridor.';
  const dc = Math.sign(b.c - a.c);
  const dr = Math.sign(b.r - a.r);
  for (let c = a.c, r = a.r; c !== b.c || r !== b.r; c += dc, r += dr) {
    if (!openBetween(map, { c, r }, { c: c + dc, r: r + dr })) return 'The corridor between the two ends must be open all the way.';
  }
  const pa = cellCentre(a.c, a.r);
  const pb = cellCentre(b.c, b.r);
  (map.obstacles ??= []).push({ kind: 'boulder', ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, phase: nextPhase(map) });
  return null;
}

export function toggleGate(map: GameMap, spot: Spot): string | null {
  if (spot.kind !== 'wall') return 'Gates go in the openings between cells.';
  if (!isOpen(map, spot)) return 'Open this wall first: a gate goes in an opening.';
  const tiles = wallTiles(spot.c, spot.r, spot.dx, spot.dy);
  const rect = { x: tiles[0]!.x, y: tiles[0]!.y, w: spot.dx ? 1 : 2, h: spot.dx ? 2 : 1 };
  const list = (map.obstacles ??= []);
  const i = list.findIndex((o) => o.kind === 'gate' && o.x === rect.x && o.y === rect.y);
  if (i >= 0) list.splice(i, 1);
  else list.push({ kind: 'gate', ...rect, phase: nextPhase(map) });
  return null;
}

/** Barrier round the landmark near `p`: added turning clockwise, then the other way, then removed. */
export function cycleBarrier(map: GameMap, p: Point): string | null {
  const mark = map.landmarks.find((l) => near(l, p, 1.5));
  if (!mark) return 'Click a landmark: a barrier turns round it.';
  const list = (map.obstacles ??= []);
  const i = list.findIndex((o) => o.kind === 'barrier' && near(o, mark));
  if (i < 0) list.push({ kind: 'barrier', x: mark.x, y: mark.y, dir: 1, phase: nextPhase(map) });
  else if ((list[i] as Extract<Obstacle, { kind: 'barrier' }>).dir === 1) (list[i] as Extract<Obstacle, { kind: 'barrier' }>).dir = -1;
  else list.splice(i, 1);
  return null;
}

/** Removes whatever is placed nearest to the point (within about a cell). Returns whether anything went. */
export function eraseAt(map: GameMap, fx: number, fy: number): boolean {
  const p = { x: fx, y: fy };
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const traps = map.traps ?? [];
  const trap = traps.findIndex((t) => t.x === tx && t.y === ty);
  if (trap >= 0) {
    traps.splice(trap, 1);
    return true;
  }
  const coins = map.treasures ?? [];
  const coin = coins.findIndex((t) => near(t, p, 1));
  if (coin >= 0) {
    coins.splice(coin, 1);
    return true;
  }
  const enemies = map.enemies ?? [];
  const foe = enemies.findIndex((e: EnemySpawn) => (e.kind === 'patroller' ? e.path.some((q) => near(q, p, 1.2)) : near(e, p, 1.2)));
  if (foe >= 0) {
    enemies.splice(foe, 1);
    return true;
  }
  const obstacles = map.obstacles ?? [];
  const ob = obstacles.findIndex((o) => {
    if (o.kind === 'gate') return fx >= o.x - 0.3 && fx <= o.x + o.w + 0.3 && fy >= o.y - 0.3 && fy <= o.y + o.h + 0.3;
    if (o.kind === 'barrier') return near(o, p, 2.2);
    return near({ x: o.ax, y: o.ay }, p, 1.2) || near({ x: o.bx, y: o.by }, p, 1.2) || distToSegment(p, { x: o.ax, y: o.ay }, { x: o.bx, y: o.by }) < 0.8;
  });
  if (ob >= 0) {
    obstacles.splice(ob, 1);
    return true;
  }
  const mark = map.landmarks.findIndex((l) => near(l, p, 1.2));
  if (mark >= 0) {
    const gone = map.landmarks.splice(mark, 1)[0]!;
    map.obstacles = obstacles.filter((o) => !(o.kind === 'barrier' && near(o, gone)));
    return true;
  }
  const zone = map.checkpoints.findIndex((z) => fx >= z.x && fx <= z.x + z.w && fy >= z.y && fy <= z.y + z.h);
  if (zone >= 0) {
    map.checkpoints.splice(zone, 1);
    return true;
  }
  return false;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Problems that make the map unraceable or odd, worded for the editor, on top of `validateMap`'s. */
export function editorWarnings(map: GameMap): string[] {
  const out: string[] = [];
  if (map.checkpoints.length === 0) out.push('No checkpoints: the race goes straight to the finish.');
  const zones = [map.finish, ...map.checkpoints];
  const startOverlaps = map.startPositions.some((s) => zones.some((z) => s.x >= z.x && s.x <= z.x + z.w && s.y >= z.y && s.y <= z.y + z.h));
  if (startOverlaps) out.push('The finish or a checkpoint is inside the start plaza.');
  for (const t of map.traps ?? []) if (at(map, t) === Tile.Wall) out.push(`A trap at ${t.x}, ${t.y} is inside a wall.`);
  return out;
}
