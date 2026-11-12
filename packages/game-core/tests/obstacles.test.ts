import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type GameEvent, type GameMap, MAP_SIZES, type Obstacle, type PlayerInput, barrierEnds, boulderPosition,
  createAutopilot, createRace, flipMap, gateClosed, generateMap, inRect, isSolid, obstacleTime, skipPreview, step,
} from '../src';
import { mapFromText } from './helpers';

const ROOM = mapFromText([
  '####################',
  '#S.................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#.................F#',
  '####################',
]);

const input = (mx: number, my: number): PlayerInput => ({ seq: 1, mx, my, sprint: false });

/** A race on `map` with `obstacles`, run to the racing phase. */
function raceWith(obstacles: Obstacle[], map: GameMap = ROOM) {
  const state = createRace({ ...map, obstacles }, [{ id: 'p1', name: 'Tester', color: 0xffffff }]);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate); i++) events.push(...step(state, { p1: inp }));
  return events;
}
const config = DEFAULT_CONFIG;

describe('obstacle motion', () => {
  it('a boulder rolls from one end to the other and back at its speed', () => {
    const o = { kind: 'boulder', ax: 2, ay: 3, bx: 14, by: 3, phase: 0 } as const;
    const oneWay = 12 / config.obstacles.boulder.speed;
    expect(boulderPosition(config, o, 0)).toEqual({ x: 2, y: 3 });
    expect(boulderPosition(config, o, oneWay / 2).x).toBeCloseTo(8);
    expect(boulderPosition(config, o, oneWay).x).toBeCloseTo(14);
    expect(boulderPosition(config, o, oneWay * 1.5).x).toBeCloseTo(8);
    expect(boulderPosition(config, o, oneWay * 2).x).toBeCloseTo(2);
    expect(boulderPosition(config, { ...o, phase: 0.25 }, 0).x).toBeCloseTo(8);
  });

  it('a barrier turns once per turn time, in its direction', () => {
    const o = { kind: 'barrier', x: 5, y: 5, dir: 1, phase: 0 } as const;
    const [, tip] = barrierEnds(config, o, config.obstacles.barrier.turnSeconds / 4);
    expect(tip.x).toBeCloseTo(5);
    expect(tip.y).toBeCloseTo(5 + config.obstacles.barrier.armLength);
    const [, back] = barrierEnds(config, { ...o, dir: -1 }, config.obstacles.barrier.turnSeconds / 4);
    expect(back.y).toBeCloseTo(5 - config.obstacles.barrier.armLength);
  });

  it('a gate is open, then closed, every cycle', () => {
    const o = { kind: 'gate', x: 0, y: 0, w: 1, h: 2, phase: 0 } as const;
    const { openSeconds, closedSeconds } = config.obstacles.gate;
    expect(gateClosed(config, o, 0.1)).toBe(false);
    expect(gateClosed(config, o, openSeconds + 0.1)).toBe(true);
    expect(gateClosed(config, o, openSeconds + closedSeconds + 0.1)).toBe(false);
  });
});

describe('obstacles in a race', () => {
  it('a boulder costs a heart, shoves the runner clear and stuns them, then passes through for a moment', () => {
    const state = raceWith([]);
    const me = state.players[0]!;
    me.x = 8;
    me.y = 4;
    // A boulder sitting still just right of the runner (both ends at the same place).
    const bx = me.x + 0.5;
    state.map.obstacles = [{ kind: 'boulder', ax: bx, ay: me.y, bx, by: me.y, phase: 0 }];
    const events = run(state, input(0, 0), 1 / 60);
    expect(events.map((e) => e.type)).toEqual(['obstacleHit', 'hurt', 'effect']);
    expect(me.health).toBe(config.health.hearts - 1);
    expect(me.effects.map((e) => e.kind)).toEqual(['stun']);
    expect(bx - me.x).toBeGreaterThanOrEqual(config.obstacles.boulder.radius + config.player.radius);
    // Pushed back onto it: no second hit while the guard lasts.
    me.x += 0.5;
    expect(run(state, input(0, 0), config.obstacles.hitGuardSeconds - 0.1).some((e) => e.type === 'obstacleHit')).toBe(false);
    expect(run(state, input(0, 0), 0.2).some((e) => e.type === 'obstacleHit')).toBe(true);
  });

  it('a turning barrier hits a runner standing in its sweep, but not one outside it', () => {
    const inside = raceWith([]);
    const a = inside.players[0]!;
    inside.map.obstacles = [{ kind: 'barrier', x: a.x + 1.5, y: a.y + 1, dir: 1, phase: 0 }];
    expect(run(inside, input(0, 0), config.obstacles.barrier.turnSeconds).some((e) => e.type === 'obstacleHit')).toBe(true);

    const outside = raceWith([]);
    const b = outside.players[0]!;
    const reach = config.obstacles.barrier.armLength + config.obstacles.barrier.thickness / 2 + config.player.radius;
    outside.map.obstacles = [{ kind: 'barrier', x: b.x + reach + 0.1, y: b.y, dir: 1, phase: 0 }];
    expect(run(outside, input(0, 0), config.obstacles.barrier.turnSeconds).some((e) => e.type === 'obstacleHit')).toBe(false);
  });

  it('no hits during the safe time after a respawn', () => {
    const state = raceWith([]);
    const me = state.players[0]!;
    me.safeTime = 1;
    state.map.obstacles = [{ kind: 'boulder', ax: me.x, ay: me.y, bx: me.x, by: me.y, phase: 0 }];
    expect(run(state, input(0, 0), 0.5).some((e) => e.type === 'obstacleHit')).toBe(false);
  });

  it('a closed gate blocks the way, an open one does not', () => {
    // A wall across the room with a one-tile-wide, two-tile-tall gap at x = 8.
    const map = mapFromText([
      '####################',
      '#S......#..........#',
      '#.......#..........#',
      '#..................#',
      '#..................#',
      '#.......#..........#',
      '#.......#.........F#',
      '####################',
    ]);
    const state = raceWith([], map);
    const me = state.players[0]!;
    me.x = 6.5;
    me.y = 4;
    const { openSeconds, closedSeconds } = config.obstacles.gate;
    const period = openSeconds + closedSeconds;
    // Choose the phase so the gate has just closed.
    const now = obstacleTime(state);
    const phase = (((openSeconds + 0.05 - now) / period) % 1 + 1) % 1;
    state.map.obstacles = [{ kind: 'gate', x: 8, y: 3, w: 1, h: 2, phase }];
    run(state, input(1, 0), closedSeconds - 0.3);
    expect(me.x).toBeLessThan(8 - config.player.radius + 0.01);
    // Walking into a closed gate blocks without hurting.
    expect(me.health).toBe(config.health.hearts);
    // Once it opens, through we go.
    run(state, input(1, 0), 1.5);
    expect(me.x).toBeGreaterThan(9.5);
  });

  it('a gate closing on a runner costs a heart and throws them out to the nearer side', () => {
    const map = mapFromText([
      '####################',
      '#S......#..........#',
      '#.......#..........#',
      '#..................#',
      '#..................#',
      '#.......#..........#',
      '#.......#.........F#',
      '####################',
    ]);
    const state = raceWith([], map);
    const me = state.players[0]!;
    // Standing in the gap, a little right of its middle.
    me.x = 8.6;
    me.y = 4;
    const { openSeconds, closedSeconds } = config.obstacles.gate;
    const now = obstacleTime(state);
    const phase = (((openSeconds - 0.1 - now) / (openSeconds + closedSeconds)) % 1 + 1) % 1;
    state.map.obstacles = [{ kind: 'gate', x: 8, y: 3, w: 1, h: 2, phase }];
    const events = run(state, input(0, 0), 0.3);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['obstacleHit', 'hurt', 'effect']));
    expect(events.find((e) => e.type === 'obstacleHit')).toMatchObject({ kind: 'gate' });
    expect(me.health).toBe(config.health.hearts - 1);
    expect(me.x).toBeGreaterThanOrEqual(9 + config.player.radius);
  });
});

describe('obstacles on generated maps', () => {
  const sizes = Object.keys(MAP_SIZES) as (keyof typeof MAP_SIZES)[];

  it('places the size’s count, a mix of kinds, the same for the same seed', () => {
    for (const size of sizes) {
      const kinds = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const map = generateMap({ seed: `obstacles-${i}`, size });
        expect(map.obstacles).toHaveLength(MAP_SIZES[size].obstacles);
        for (const o of map.obstacles!) kinds.add(o.kind);
        expect(generateMap({ seed: `obstacles-${i}`, size }).obstacles).toEqual(map.obstacles);
      }
      expect([...kinds].sort()).toEqual(['barrier', 'boulder', 'gate']);
    }
  });

  it('keeps obstacles on open ground and away from the start, finish and checkpoints', () => {
    for (const size of sizes) {
      for (let i = 0; i < 8; i++) {
        const map = generateMap({ seed: `clear-${i}`, size });
        const zones = [map.finish, ...map.checkpoints];
        const start = map.startPositions;
        const nearStart = (x: number, y: number) => start.some((p) => Math.hypot(p.x - x, p.y - y) < 3);
        for (const o of map.obstacles!) {
          const points =
            o.kind === 'boulder'
              ? Array.from({ length: 11 }, (_, k) => ({ x: o.ax + ((o.bx - o.ax) * k) / 10, y: o.ay + ((o.by - o.ay) * k) / 10 }))
              : o.kind === 'barrier'
                ? [{ x: o.x, y: o.y }]
                : [{ x: o.x + 0.5, y: o.y + 0.5 }, { x: o.x + o.w - 0.5, y: o.y + o.h - 0.5 }];
          for (const pt of points) {
            expect(isSolid(map, Math.floor(pt.x), Math.floor(pt.y))).toBe(false);
            expect(zones.some((z) => inRect(z, pt.x, pt.y))).toBe(false);
            expect(nearStart(pt.x, pt.y)).toBe(false);
          }
          if (o.kind === 'barrier') expect(map.landmarks.some((l) => l.x === o.x && l.y === o.y)).toBe(true);
        }
      }
    }
  });

  it('gives every cell along a boulder’s corridor a side passage to duck into', () => {
    for (const size of sizes) {
      for (let i = 0; i < 6; i++) {
        const map = generateMap({ seed: `dodge-${i}`, size });
        for (const o of map.obstacles!) {
          if (o.kind !== 'boulder') continue;
          const cells = Math.round(Math.hypot(o.bx - o.ax, o.by - o.ay) / 3) + 1;
          const dx = Math.sign(o.bx - o.ax);
          const dy = Math.sign(o.by - o.ay);
          for (let n = 0; n < cells; n++) {
            const cx = o.ax + dx * 3 * n;
            const cy = o.ay + dy * 3 * n;
            // The wall tiles either side of the corridor at this cell: at least one side is open.
            const sides = dx !== 0
              ? [[cx - 1, cy - 2], [cx - 1, cy + 1]]
              : [[cx - 2, cy - 1], [cx + 1, cy - 1]];
            expect(sides.some(([x, y]) => !isSolid(map, x!, y!))).toBe(true);
          }
        }
      }
    }
  });

  it('careful computer players get round the obstacles and finish, even slow ones', () => {
    for (const size of sizes) {
      for (let i = 0; i < 2; i++) {
        const map = generateMap({ seed: `bots-${i}`, size });
        const state = createRace(map, [{ id: 'p1', name: 'Bot', color: 0 }]);
        const pilot = createAutopilot(map);
        skipPreview(state);
        const speed = 0.45;
        while (state.phase !== 'finished') {
          const steer = state.phase === 'racing' ? pilot(state.players[0]!, false, { state, speed }) : { seq: 0, mx: 0, my: 0, sprint: false };
          step(state, { p1: { ...steer, mx: steer.mx * speed, my: steer.my * speed } });
        }
        expect(state.players[0]!.finished).toBe(true);
      }
    }
  });

  it('mirrors obstacles with the map', () => {
    const map = generateMap({ seed: 'mirror', size: 'small' });
    const flipped = flipMap(map, true, false);
    map.obstacles!.forEach((o, i) => {
      const f = flipped.obstacles![i]!;
      if (o.kind === 'boulder' && f.kind === 'boulder') expect(f.ax).toBeCloseTo(map.width - o.ax);
      if (o.kind === 'barrier' && f.kind === 'barrier') expect(f.dir).toBe(-o.dir);
      if (o.kind === 'gate' && f.kind === 'gate') expect(f.x).toBe(map.width - o.x - o.w);
    });
  });
});
