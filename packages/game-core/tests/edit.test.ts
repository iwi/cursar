import { describe, expect, it } from 'vitest';
import {
  MAP_SIZES, type MapSize, Tile, blankMap, cellGrid, contentId, decodeMap, encodeMap, generateMap, isSolid, openBlock, validateMap, wallTiles,
} from '../src';

describe('map editing helpers', () => {
  it('a blank map is on the cell grid, playable, with its start plaza open', () => {
    const map = blankMap(8, 6);
    expect(cellGrid(map)).toEqual({ cols: 8, rows: 6 });
    expect(map.startPositions).toHaveLength(8);
    // Cells are walled off from each other, so the finish cannot be reached yet.
    expect(validateMap(map).ok).toBe(false);
    // Open a corridor along the top row and down the right side: now it can.
    for (let c = 0; c < 7; c++) for (const t of wallTiles(c, 0, 1, 0)) map.tiles[t.y * map.width + t.x] = Tile.Floor;
    for (let r = 0; r < 5; r++) for (const t of wallTiles(7, r, 0, 1)) map.tiles[t.y * map.width + t.x] = Tile.Floor;
    expect(validateMap(map).ok).toBe(true);
  });

  it('opening a block makes a plaza, posts included', () => {
    const map = blankMap(6, 6);
    openBlock(map, 2, 2, 3, 3);
    expect(isSolid(map, 9, 9)).toBe(false);
    expect(isSolid(map, 9, 7)).toBe(false);
  });

  it('generated maps sit on the cell grid', () => {
    for (const size of Object.keys(MAP_SIZES) as MapSize[]) {
      const map = generateMap({ seed: 'grid', size });
      expect(cellGrid(map)).toEqual({ cols: MAP_SIZES[size].cols, rows: MAP_SIZES[size].rows });
    }
  });
});

describe('reading a map from outside', () => {
  const map = generateMap({ seed: 'decode', size: 'small' });
  const encoded = () => JSON.parse(JSON.stringify(encodeMap(map))) as Record<string, unknown>;

  it('reads back an encoded map exactly, with an id from its contents', () => {
    const result = decodeMap(encoded());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map.tiles).toEqual(map.tiles);
    expect(result.map.enemies).toEqual(map.enemies);
    expect(result.map.obstacles).toEqual(map.obstacles);
    expect(result.map.id).toMatch(/^custom-/);
    expect(result.map.id).toBe(contentId(result.map));
    // The same contents always give the same id; a change gives another.
    const changed = { ...result.map, treasures: [] };
    expect(contentId(changed)).not.toBe(result.map.id);
    expect(decodeMap(encoded()).ok && (decodeMap(encoded()) as { map: { id: string } }).map.id).toBe(result.map.id);
  });

  it('refuses anything malformed or unplayable', () => {
    expect(decodeMap(null).ok).toBe(false);
    expect(decodeMap({ ...encoded(), schema: 2 }).ok).toBe(false);
    expect(decodeMap({ ...encoded(), width: 9999 }).ok).toBe(false);
    expect(decodeMap({ ...encoded(), tiles: '12' }).ok).toBe(false);
    expect(decodeMap({ ...encoded(), traps: [{ kind: 'bomb', x: 3, y: 3 }] }).ok).toBe(false);
    expect(decodeMap({ ...encoded(), enemies: [{ kind: 'chaser', x: -5, y: 3 }] }).ok).toBe(false);
    expect(decodeMap({ ...encoded(), treasures: new Array(500).fill({ x: 2, y: 2 }) }).ok).toBe(false);
    expect(decodeMap({ ...encoded(), startPositions: [] }).ok).toBe(false);
    // All walls: nothing can be reached.
    const walled = encoded();
    walled.tiles = (walled.tiles as string).replace(/[023]/g, '1');
    const result = decodeMap(walled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/wall|reach/i);
  });

  it('cleans the name', () => {
    const result = decodeMap({ ...encoded(), name: '  A\u0007 very long name that goes on and on and on forever  ' });
    expect(result.ok && result.map.name.length).toBeLessThanOrEqual(40);
    expect(result.ok && result.map.name.startsWith('A very')).toBe(true);
  });
});
