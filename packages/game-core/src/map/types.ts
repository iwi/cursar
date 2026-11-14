/** Tile codes stored in GameMap.tiles. Index into TERRAIN for their behaviour. */
export const Tile = { Floor: 0, Wall: 1, Mud: 2, Ice: 3 } as const;
export type TileCode = (typeof Tile)[keyof typeof Tile];

export interface TerrainDef {
  id: string;
  name: string;
  solid: boolean;
  blocksSight: boolean;
  /** Multiplies top speed. */
  speedMul: number;
  /** Multiplies acceleration and braking: low grip means slow starts and long slides. */
  grip: number;
}

/**
 * Data-driven terrain table. A new terrain that only changes speed and grip is
 * one more row here, with no engine change.
 */
export const TERRAIN: readonly TerrainDef[] = [
  { id: 'floor', name: 'Floor', solid: false, blocksSight: false, speedMul: 1, grip: 1 },
  { id: 'wall', name: 'Wall', solid: true, blocksSight: true, speedMul: 1, grip: 1 },
  { id: 'mud', name: 'Mud', solid: false, blocksSight: false, speedMul: 0.55, grip: 0.6 },
  { id: 'ice', name: 'Ice', solid: false, blocksSight: false, speedMul: 1.1, grip: 0.1 },
];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LANDMARK_KINDS = ['fountain', 'statue', 'tree', 'crystal', 'brazier', 'obelisk'] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export interface Landmark extends Point {
  kind: LandmarkKind;
}

/**
 * Moving obstacles. Their motion depends only on the race clock (see
 * `sim/obstacles.ts`), so every page can draw them without being sent their
 * positions. Speeds and sizes are in `config.obstacles`; the map holds where
 * they are and where in their cycle they start (`phase`, 0 to 1).
 */
export type Obstacle =
  /** Rolls back and forth between two points along a straight corridor. */
  | { kind: 'boulder'; ax: number; ay: number; bx: number; by: number; phase: number }
  /** A bar turning round a post (a plaza's landmark). `dir` 1 turns clockwise on screen. */
  | { kind: 'barrier'; x: number; y: number; dir: 1 | -1; phase: number }
  /** Blocks the tiles in its rectangle while closed, on a steady rhythm. */
  | { kind: 'gate'; x: number; y: number; w: number; h: number; phase: number };

export type ObstacleKind = Obstacle['kind'];

/** Traps, one tile each. What each does is set in `config.traps`. */
export const TRAP_KINDS = ['spikes', 'snare', 'glue', 'flash', 'reverse', 'confuse'] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];

export interface Trap {
  kind: TrapKind;
  /** The trap's tile. */
  x: number;
  y: number;
}

/** Enemies. How they behave is set in `config.enemies`; the map says where they live. */
export const ENEMY_KINDS = ['patroller', 'chaser', 'turret'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export type EnemySpawn =
  /** Walks back and forth along a winding beat (corridor cell centres, turning at least one corner), on a schedule. */
  | { kind: 'patroller'; path: Point[]; phase: number }
  /** Sleeps at its home until a runner comes near, then chases. */
  | { kind: 'chaser'; x: number; y: number }
  /** Fixed in place; turns to face a runner in sight and fires bolts. */
  | { kind: 'turret'; x: number; y: number };

/**
 * A locked door in an opening between two cells, and the key that opens it.
 * Every runner picks up their own copy of the key; the door then opens for
 * them only.
 */
export interface Door {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where its key lies (tile units, centre). */
  key: Point;
}

/** Most door-and-key pairs a map can have (each has its own colour). */
export const MAX_DOORS = 4;

/** Versioned map format shared by the generator, the game and (later) the editor. */
export interface GameMap {
  schema: 1;
  id: string;
  name: string;
  version: number;
  width: number;
  height: number;
  /** Row-major tile codes, length = width * height. */
  tiles: number[];
  /** Player spawn points (tile units, centre of the character). */
  startPositions: Point[];
  /** Finish zone in tile units. */
  finish: Rect;
  /** Zones every runner must touch, in any order, before the finish counts. */
  checkpoints: Rect[];
  /** Decorative, memorable features used for navigation. */
  landmarks: Landmark[];
  /** Moving obstacles. Optional, so hand-made maps without them stay valid. */
  obstacles?: Obstacle[];
  /** Hidden traps. Optional, like obstacles. */
  traps?: Trap[];
  /** Enemies. Optional, like obstacles. */
  enemies?: EnemySpawn[];
  /** Treasures, a point each; every runner collects their own. Optional, like obstacles. */
  treasures?: Point[];
  /** Locked doors and their keys. Optional, like obstacles. */
  doors?: Door[];
  /** Present when the map came from the generator. `doors` is the number of door-and-key pairs asked for. */
  generator?: { seed: string; size: string; doors?: number };
}

export function tileAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Wall;
  return map.tiles[ty * map.width + tx]!;
}

export function isSolid(map: GameMap, tx: number, ty: number): boolean {
  return TERRAIN[tileAt(map, tx, ty)]!.solid;
}

/** The index of the door covering a tile, or -1. */
export function doorAt(map: GameMap, tx: number, ty: number): number {
  const doors = map.doors;
  if (!doors) return -1;
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i]!;
    if (tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return i;
  }
  return -1;
}

/**
 * A check for doors that are locked to someone holding `keys` (one flag per
 * door; null or empty means no keys), or null when nothing is locked.
 */
export function lockedDoors(map: GameMap, keys: readonly boolean[] | null): ((tx: number, ty: number) => boolean) | null {
  if (!map.doors?.length) return null;
  if (keys && map.doors.every((_, i) => keys[i])) return null;
  return (tx, ty) => {
    const i = doorAt(map, tx, ty);
    return i >= 0 && !keys?.[i];
  };
}

/** Both checks, or whichever exists. */
export function eitherBlocks(
  a: ((tx: number, ty: number) => boolean) | null,
  b: ((tx: number, ty: number) => boolean) | null,
): ((tx: number, ty: number) => boolean) | null {
  if (!a) return b;
  if (!b) return a;
  return (tx, ty) => a(tx, ty) || b(tx, ty);
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
