import { describe, expect, it } from 'vitest';
import {
  type GameEvent, MAP_SIZES, type MapSize, createRace, damage, decodeMap, distanceField, encodeMap, generateMap, lockedDoors, mapRef,
  planRoute, resolveMapRef, skipPreview, step, validateMap,
} from '../src';
import { makeBot, mapFromText } from './helpers';

const RUNNER = [{ id: 'p1', name: 'Tester', color: 0xffffff }];

/** A corridor with a door in the middle and its key behind the start. */
function corridor() {
  const map = mapFromText([
    '##########',
    '#S...#..F#',
    '#........#',
    '##########',
  ]);
  map.tiles[1 * map.width + 5] = 0;
  map.doors = [{ x: 5, y: 1, w: 1, h: 2, key: { x: 1.5, y: 2.5 } }];
  return map;
}

function racing(map = corridor()) {
  const state = createRace(map, RUNNER);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  return state;
}

function run(state: ReturnType<typeof racing>, mx: number, my: number, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < seconds * 60; i++) events.push(...step(state, { p1: { seq: i, mx, my, sprint: false } }));
  return events;
}

describe('doors and keys', () => {
  it('stop a runner without the key, and say so', () => {
    const state = racing();
    const events = run(state, 1, 0, 3);
    expect(state.players[0]!.x).toBeLessThan(5);
    expect(events.some((e) => e.type === 'doorLocked' && e.index === 0)).toBe(true);
  });

  it('open for a runner who picked up the key, who keeps it after a respawn', () => {
    const state = racing();
    const p = state.players[0]!;
    p.x = 1.5;
    p.y = 2.5;
    const events = run(state, 0, 0, 0.1);
    expect(events.some((e) => e.type === 'key' && e.index === 0)).toBe(true);
    expect(p.keys).toEqual([true]);
    run(state, 1, 0, 3);
    expect(p.x).toBeGreaterThan(6);
    const after: GameEvent[] = [];
    damage(state.config, p, 3, after);
    expect(after.some((e) => e.type === 'respawn')).toBe(true);
    expect(p.keys).toEqual([true]);
  });

  it('are planned for: the route fetches the key first', () => {
    const plan = planRoute(corridor());
    expect(plan.steps.map((s) => s.kind)).toEqual(['key']);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('make a map unraceable when a key is behind its own door', () => {
    const map = corridor();
    map.doors![0]!.key = { x: 7.5, y: 2.5 };
    expect(validateMap(map).ok).toBe(false);
  });

  it('are left out of generated maps unless asked for, which stay as they were', () => {
    const plain = generateMap({ seed: 'doors', size: 'small' });
    expect(plain.doors).toBeUndefined();
    expect(generateMap({ seed: 'doors', size: 'small', doors: 0 })).toEqual(plain);
    const locked = generateMap({ seed: 'doors', size: 'small', doors: 2 });
    expect(locked.id).toBe(`${plain.id}-d2`);
    expect(locked.tiles).toEqual(plain.tiles);
  });

  it('each lock something away in generated maps, with every key reachable through no door', () => {
    let placed = 0;
    let asked = 0;
    for (const size of Object.keys(MAP_SIZES) as MapSize[]) {
      for (let i = 0; i < 6; i++) {
        const want = 1 + (i % 3);
        const map = generateMap({ seed: `lock${i}`, size, doors: want });
        asked += want;
        const doors = map.doors ?? [];
        placed += doors.length;
        expect(validateMap(map).ok).toBe(true);
        const start = map.startPositions[0]!;
        const startTile = Math.floor(start.y) * map.width + Math.floor(start.x);
        const shut = lockedDoors(map, null);
        // Every key can be reached with all doors shut.
        for (const d of doors) {
          expect(distanceField(map, { x: Math.floor(d.key.x), y: Math.floor(d.key.y), w: 1, h: 1 }, shut)[startTile]).toBeGreaterThanOrEqual(0);
        }
        // With all doors shut, something needed is out of reach.
        if (doors.length > 0) {
          const cut = [...map.checkpoints, map.finish].some((z) => distanceField(map, z, shut)[startTile]! < 0);
          expect(cut).toBe(true);
        }
      }
    }
    // Nearly every door asked for fits.
    expect(placed / asked).toBeGreaterThan(0.8);
  });

  it('are fetched by computer players, who finish', () => {
    for (const size of ['tiny', 'small'] as MapSize[]) {
      const map = generateMap({ seed: 'botdoor', size, doors: 2 });
      expect(map.doors?.length).toBeGreaterThan(0);
      const state = racing(map);
      const bot = makeBot(map);
      for (let t = 0; t < 60 * 300 && state.phase === 'racing'; t++) step(state, { p1: bot(state) });
      const p = state.players[0]!;
      expect(p.finished).toBe(true);
      expect(p.keys.every(Boolean)).toBe(true);
    }
  });

  it('survive files and the network', () => {
    const map = generateMap({ seed: 'wire', size: 'tiny', doors: 1 });
    const { generator: _g, ...rest } = map;
    const read = decodeMap(JSON.parse(JSON.stringify(encodeMap(rest))));
    expect(read.ok && read.map.doors).toEqual(map.doors);
    expect(decodeMap({ ...encodeMap(rest), doors: [{ x: 1.5, y: 1, w: 1, h: 2, key: { x: 2, y: 2 } }] }).ok).toBe(false);
    expect(decodeMap({ ...encodeMap(rest), doors: [{ x: 1, y: 1, w: 1, h: 2 }] }).ok).toBe(false);
    expect(mapRef(map)).toEqual({ seed: 'wire', size: 'tiny', doors: 1 });
    const back = resolveMapRef(mapRef(map));
    expect(back.ok && back.map.id).toBe(map.id);
  });
});
