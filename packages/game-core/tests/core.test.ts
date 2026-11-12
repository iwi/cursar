import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type GameEvent, GhostRecorder, MAP_SIZES, type MapSize, NO_INPUT, type PlayerInput, Rng, Tile,
  cloneConfig, computeVisibility, createRace, flipMap, generateMap, isSolid, placeMarker, previewSeconds,
  planRoute, sampleGhost, skipPreview, step, validateMap, visionRange,
} from '../src';
import { makeBot, mapFromText } from './helpers';

const RUNNER = [{ id: 'p1', name: 'Tester', color: 0xffffff }];
const input = (mx: number, my: number, sprint = false): PlayerInput => ({ seq: 1, mx, my, sprint });

/** Runs a race to the start of the racing phase. */
function startRacing(map = OPEN, config = DEFAULT_CONFIG) {
  const state = createRace(map, RUNNER, config);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate); i++) events.push(...step(state, { p1: inp }));
  return events;
}

const OPEN = mapFromText([
  '######################',
  '#S...................#',
  '#....................#',
  '#....................#',
  '#...................F#',
  '######################',
]);

describe('rng', () => {
  it('is repeatable for a seed and differs between seeds', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    const c = new Rng('abd');
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });
});

describe('map generation', () => {
  it('gives the same map for the same seed', () => {
    expect(generateMap({ seed: 'x1', size: 'small' })).toEqual(generateMap({ seed: 'x1', size: 'small' }));
    expect(generateMap({ seed: 'x1', size: 'small' }).tiles).not.toEqual(generateMap({ seed: 'x2', size: 'small' }).tiles);
  });

  it('always produces a valid, finishable map with room for eight runners', () => {
    for (const size of Object.keys(MAP_SIZES) as MapSize[]) {
      for (let i = 0; i < 40; i++) {
        const map = generateMap({ seed: `s${i}`, size });
        const check = validateMap(map);
        expect(check.errors).toEqual([]);
        expect(check.routeLength).toBeGreaterThan(20);
        expect(map.startPositions).toHaveLength(8);
        expect(map.landmarks.length).toBeGreaterThanOrEqual(2);
        expect(map.checkpoints).toHaveLength(MAP_SIZES[size].checkpoints);
        for (let x = 0; x < map.width; x++) {
          expect(isSolid(map, x, 0) && isSolid(map, x, map.height - 1)).toBe(true);
        }
      }
    }
  });

  it('spreads checkpoints out, away from the start and the finish', () => {
    for (let i = 0; i < 10; i++) {
      const map = generateMap({ seed: `c${i}`, size: 'medium' });
      const zones = [...map.checkpoints, map.finish];
      const start = map.startPositions[0]!;
      const plan = planRoute(map);
      map.checkpoints.forEach((zone, index) => {
        expect(plan.fields[index]![Math.floor(start.y) * map.width + Math.floor(start.x)]).toBeGreaterThan(15);
        zones.forEach((_other, j) => {
          if (j !== index) expect(plan.fields[j]![zone.y * map.width + zone.x]).toBeGreaterThan(15);
        });
      });
      expect([...plan.order].sort()).toEqual(map.checkpoints.map((_, index) => index));
    }
  });

  it('stays valid when mirrored', () => {
    const map = generateMap({ seed: 'mirror', size: 'medium' });
    const flipped = flipMap(map, true, true);
    // A tile or two of difference is expected: zones are measured from their first open tile.
    expect(Math.abs(validateMap(flipped).routeLength - validateMap(map).routeLength)).toBeLessThanOrEqual(8);
    expect(flipped.checkpoints).toHaveLength(map.checkpoints.length);
    expect(flipped.tiles).not.toEqual(map.tiles);
  });

  it('rejects broken maps', () => {
    const sealed = mapFromText(['#####', '#S#F#', '#####', '#####', '#####']);
    expect(validateMap(sealed).ok).toBe(false);
    const noStart = mapFromText(['#####', '#..F#', '#####', '#####', '#####']);
    expect(validateMap(noStart).errors.join()).toMatch(/no start/);
  });
});

describe('movement', () => {
  it('reaches top speed quickly and stops quickly', () => {
    const state = startRacing();
    run(state, input(1, 0), 0.5);
    const p = state.players[0]!;
    expect(p.vx).toBeCloseTo(DEFAULT_CONFIG.player.maxSpeed, 5);
    run(state, NO_INPUT, 0.3);
    expect(Math.hypot(p.vx, p.vy)).toBe(0);
  });

  it('is no faster diagonally', () => {
    const state = startRacing();
    run(state, input(1, 1), 0.5);
    const p = state.players[0]!;
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(DEFAULT_CONFIG.player.maxSpeed, 5);
  });

  it('never enters a wall and slides along it', () => {
    const state = startRacing();
    const p = state.players[0]!;
    run(state, input(1, -1), 1);
    expect(p.y).toBeCloseTo(1 + DEFAULT_CONFIG.player.radius, 5);
    expect(p.x).toBeGreaterThan(3);
    run(state, input(-1, 0), 3);
    expect(p.x).toBeCloseTo(1 + DEFAULT_CONFIG.player.radius, 5);
  });

  it('squeezes through a one-tile gap and round corners', () => {
    const map = mapFromText([
      '#########',
      '#S..#...#',
      '#...#...#',
      '#.......#',
      '#...#..F#',
      '#########',
    ]);
    const state = startRacing(map);
    const bot = makeBot(map);
    for (let i = 0; i < 600 && state.phase === 'racing'; i++) step(state, { p1: bot(state) });
    expect(state.players[0]!.finished).toBe(true);
  });

  it('turns the facing smoothly rather than snapping', () => {
    const state = startRacing();
    const p = state.players[0]!;
    run(state, input(1, 0), 0.5);
    expect(p.facing).toBeCloseTo(0, 5);
    step(state, { p1: input(-1, 0) });
    expect(Math.abs(p.facing)).toBeLessThan(0.3);
    run(state, input(-1, 0), 0.5);
    expect(Math.abs(p.facing)).toBeCloseTo(Math.PI, 5);
  });

  it('is slow in mud and slides on ice', () => {
    const lane = (ch: string) => mapFromText(['##########################', `#S${ch.repeat(22)}F#`, '##########################', '#....#', '#....#']);
    const mud = startRacing(lane('m'));
    run(mud, input(1, 0), 1.5);
    expect(mud.players[0]!.vx).toBeLessThan(DEFAULT_CONFIG.player.maxSpeed * 0.6);

    // Reverse direction for a moment: on floor you turn round, on ice you keep sliding.
    const afterReversing = (ch: string) => {
      const state = startRacing(lane(ch));
      run(state, input(1, 0), 1.5);
      run(state, input(-1, 0), 0.3);
      return state.players[0]!.vx;
    };
    expect(afterReversing('.')).toBeLessThan(0);
    expect(afterReversing('i')).toBeGreaterThan(1);
  });
});

describe('stamina', () => {
  it('makes sprinting faster, drains, locks out and recovers', () => {
    const state = startRacing();
    const p = state.players[0]!;
    run(state, input(1, 0, true), 0.5);
    expect(p.vx).toBeCloseTo(DEFAULT_CONFIG.player.maxSpeed * DEFAULT_CONFIG.sprint.speedMul, 5);
    expect(p.stamina).toBeLessThan(100);

    const events = run(state, input(0, 1, true), 0.1).concat(run(state, input(0, -1, true), 4));
    expect(events.some((e) => e.type === 'exhausted')).toBe(true);
    expect(p.exhausted).toBe(true);
    expect(p.sprinting).toBe(false);

    run(state, NO_INPUT, 3);
    expect(p.exhausted).toBe(false);
    expect(p.stamina).toBeGreaterThan(DEFAULT_CONFIG.sprint.recoverThreshold);
  });

  it('does not drain while standing still with sprint held', () => {
    const state = startRacing();
    run(state, input(0, 0, true), 1);
    expect(state.players[0]!.stamina).toBe(100);
  });
});

describe('visibility', () => {
  const vision = DEFAULT_CONFIG.vision;

  it('reaches furthest ahead, less to the side, least behind', () => {
    expect(visionRange(vision, 0)).toBeCloseTo(8);
    expect(visionRange(vision, Math.PI / 2)).toBeCloseTo(4);
    expect(visionRange(vision, Math.PI)).toBeCloseTo(2);
  });

  it('follows the facing direction', () => {
    const map = mapFromText(Array.from({ length: 25 }, (_, y) => (y === 0 || y === 24 ? '#'.repeat(25) : `#${'.'.repeat(23)}#`)));
    const out = new Uint8Array(25 * 25);
    const seen = (x: number, y: number) => out[y * 25 + x] === 1;
    computeVisibility(map, 12.5, 12.5, 0, vision, out);
    expect(seen(19, 12)).toBe(true);
    expect(seen(5, 12)).toBe(false);
    expect(seen(11, 12)).toBe(true);
    computeVisibility(map, 12.5, 12.5, Math.PI, vision, out);
    expect(seen(19, 12)).toBe(false);
    expect(seen(5, 12)).toBe(true);
  });

  it('is blocked by walls but shows the wall itself', () => {
    const map = mapFromText([
      '###########',
      '#....#....#',
      '#....#....#',
      '#....#....#',
      '###########',
    ]);
    const out = new Uint8Array(11 * 5);
    computeVisibility(map, 2.5, 2.5, 0, vision, out);
    expect(out[2 * 11 + 4]).toBe(1);
    expect(out[2 * 11 + 5]).toBe(1);
    expect(out[2 * 11 + 6]).toBe(0);
    expect(out[2 * 11 + 8]).toBe(0);
  });
});

describe('race lifecycle', () => {
  it('scales the preview with map size', () => {
    const small = previewSeconds(generateMap({ seed: 'a', size: 'small' }), DEFAULT_CONFIG);
    const large = previewSeconds(generateMap({ seed: 'a', size: 'large' }), DEFAULT_CONFIG);
    expect(small).toBeGreaterThanOrEqual(8);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(DEFAULT_CONFIG.race.previewMaxSeconds);
  });

  it('runs preview, countdown, racing and finish in order, ignoring input before the start', () => {
    const state = createRace(OPEN, RUNNER);
    const start = { x: state.players[0]!.x, y: state.players[0]!.y };
    const seen: string[] = [];
    const counts: number[] = [];
    for (let i = 0; i < 60 * 60 && state.phase !== 'racing'; i++) {
      for (const e of step(state, { p1: input(1, 0) })) {
        if (e.type === 'phase') seen.push(e.phase);
        if (e.type === 'countdown') counts.push(e.n);
      }
    }
    expect(seen).toEqual(['countdown', 'racing']);
    expect(counts).toEqual([3, 2, 1]);
    expect(state.players[0]).toMatchObject(start);
    expect(state.raceTime).toBe(0);
  });

  it('lets a bot finish generated maps inside the target race length', () => {
    for (const size of ['small', 'medium', 'large'] as MapSize[]) {
      for (const seed of ['alpha', 'beta', 'gamma']) {
        const map = generateMap({ seed, size });
        const state = startRacing(map);
        const bot = makeBot(map);
        let finish: GameEvent | undefined;
        while (state.phase === 'racing') {
          finish = step(state, { p1: bot(state) }).find((e) => e.type === 'finish') ?? finish;
        }
        expect(finish, `${size}/${seed}`).toBeDefined();
        expect(state.players[0]!.finishTime!).toBeLessThan(DEFAULT_CONFIG.race.timeLimitSeconds);
      }
    }
  });

  it('only counts the finish once every checkpoint has been touched, in any order', () => {
    const map = mapFromText([
      '###########',
      '#C...S...C#',
      '#....F....#',
      '###########',
      '#.........#',
    ]);
    expect(planRoute(map).length).toBe(4 + 8 + 5);
    const state = startRacing(map);
    const p = state.players[0]!;
    // Straight onto the finish: refused.
    let events = run(state, input(0, 1), 0.5);
    expect(events.find((e) => e.type === 'finishLocked')).toMatchObject({ remaining: 2 });
    expect(p.finished).toBe(false);
    // Right-hand checkpoint first (the second one in the map), then the left one.
    events = run(state, input(0, -1), 0.5).concat(run(state, input(1, 0), 1.5));
    expect(events.filter((e) => e.type === 'checkpoint')).toEqual([{ type: 'checkpoint', playerId: 'p1', index: 1, remaining: 1 }]);
    events = run(state, input(-1, 0), 2.5);
    expect(events.filter((e) => e.type === 'checkpoint')).toEqual([{ type: 'checkpoint', playerId: 'p1', index: 0, remaining: 0 }]);
    expect(p.checkpoints).toEqual([true, true]);
    // Back to the finish: now it counts.
    const bot = makeBot(map);
    while (state.phase === 'racing') events = step(state, { p1: bot(state) });
    expect(p.finished).toBe(true);
    expect(events.some((e) => e.type === 'finish')).toBe(true);
  });

  it('ends the race at the time limit', () => {
    const config = cloneConfig();
    config.race.timeLimitSeconds = 2;
    const state = startRacing(OPEN, config);
    run(state, NO_INPUT, 3);
    expect(state.phase).toBe('finished');
    expect(state.players[0]!.finished).toBe(false);
    expect(state.raceTime).toBeCloseTo(2, 5);
  });

  it('places waypoints only in the preview, on open tiles, up to the limit, and reaches them in order', () => {
    const state = createRace(OPEN, RUNNER);
    expect(placeMarker(state, 'p1', 0.5, 0.5)).toBe(false);
    expect(placeMarker(state, 'p1', 6.2, 1.7)).toBe(true);
    expect(placeMarker(state, 'p1', 12.2, 1.7)).toBe(true);
    expect(placeMarker(state, 'p1', 14.2, 1.7)).toBe(true);
    expect(placeMarker(state, 'p1', 16.2, 1.7)).toBe(false);
    skipPreview(state);
    while (state.phase !== 'racing') step(state, {});
    expect(placeMarker(state, 'p1', 3.5, 3.5)).toBe(false);
    const reached = run(state, input(1, 0), 3).filter((e) => e.type === 'marker').map((e) => (e as { index: number }).index);
    expect(reached).toEqual([0, 1, 2]);
  });

  it('emits footsteps and leaves footprints that fade', () => {
    const config = cloneConfig();
    config.footprints.lifetimeSeconds = 1;
    const state = startRacing(OPEN, config);
    const steps = run(state, input(1, 0), 1).filter((e) => e.type === 'footstep');
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(state.players[0]!.footprints.length).toBeGreaterThan(0);
    run(state, NO_INPUT, 2);
    expect(state.players[0]!.footprints).toHaveLength(0);
  });

  it('reports a wall bump when running into a wall', () => {
    const state = startRacing();
    expect(run(state, input(0, -1), 0.5).some((e) => e.type === 'bump')).toBe(true);
  });
});

describe('ghost', () => {
  it('records a run and plays it back at the same positions', () => {
    const map = generateMap({ seed: 'ghost', size: 'small' });
    const state = startRacing(map);
    const bot = makeBot(map);
    const recorder = new GhostRecorder(state, 'p1');
    const track: { t: number; x: number; y: number }[] = [];
    while (state.phase === 'racing') {
      step(state, { p1: bot(state) });
      recorder.capture();
      track.push({ t: state.raceTime, x: state.players[0]!.x, y: state.players[0]!.y });
    }
    const ghost = recorder.finish()!;
    expect(ghost.time).toBe(state.players[0]!.finishTime);
    expect(ghost.intervalMs).toBe(50);
    expect(ghost.mapId).toBe(map.id);
    for (const point of track.filter((_, i) => i % 37 === 0)) {
      const g = sampleGhost(ghost, point.t)!;
      expect(Math.hypot(g.x - point.x, g.y - point.y)).toBeLessThan(0.15);
    }
    expect(sampleGhost(ghost, ghost.time + 5)).toBeNull();
    expect(JSON.stringify(ghost).length).toBeLessThan(400_000);
  });

  it('returns nothing for an unfinished run', () => {
    const state = startRacing();
    const recorder = new GhostRecorder(state, 'p1');
    run(state, NO_INPUT, 0.2);
    recorder.capture();
    expect(recorder.finish()).toBeNull();
  });
});

describe('tile codes', () => {
  it('match the terrain table', () => {
    expect([Tile.Floor, Tile.Wall, Tile.Mud, Tile.Ice]).toEqual([0, 1, 2, 3]);
  });
});
