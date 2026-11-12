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

export type LandmarkKind = 'fountain' | 'statue' | 'tree' | 'crystal' | 'brazier' | 'obelisk';

export interface Landmark extends Point {
  kind: LandmarkKind;
}

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
  /** Present when the map came from the generator. */
  generator?: { seed: string; size: string };
}

export function tileAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Wall;
  return map.tiles[ty * map.width + tx]!;
}

export function isSolid(map: GameMap, tx: number, ty: number): boolean {
  return TERRAIN[tileAt(map, tx, ty)]!.solid;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
