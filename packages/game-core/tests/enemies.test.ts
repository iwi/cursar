import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type ChaserState, type EnemySpawn, type GameEvent, type GameMap, MAP_SIZES, type PlayerInput, type TurretState,
  createAutopilot, createRace, generateMap, hearFoe, inRect, isSolid, patrollerPose, patrollerPosition, skipPreview, step,
} from '../src';
import { mapFromText } from './helpers';

const HALL = mapFromText([
  '##############################',
  '#S...........................#',
  '#............................#',
  '#............................#',
  '#............................#',
  '#...........................F#',
  '##############################',
]);
// Two rooms joined by a gap, to break line of sight.
const ROOMS = mapFromText([
  '##############################',
  '#S............#..............#',
  '#.............#..............#',
  '#............................#',
  '#.............#..............#',
  '#.............#.............F#',
  '##############################',
]);
const config = DEFAULT_CONFIG;
const still: PlayerInput = { seq: 1, mx: 0, my: 0, sprint: false };
const go = (mx: number, my: number): PlayerInput => ({ seq: 1, mx, my, sprint: false });

function raceWith(enemies: EnemySpawn[], map: GameMap = HALL, x = 3.5, y = 3.5) {
  const state = createRace({ ...map, enemies }, [{ id: 'p1', name: 'Tester', color: 0 }]);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  state.players[0]!.x = x;
  state.players[0]!.y = y;
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate) && state.phase === 'racing'; i++) events.push(...step(state, { p1: inp }));
  return events;
}

describe('patrollers', () => {
  it('walk their beat back and forth on the clock, turning its corners', () => {
    const e = { kind: 'patroller' as const, path: [{ x: 2, y: 3 }, { x: 10, y: 3 }, { x: 10, y: 7 }], phase: 0 };
    const oneWay = 12 / config.enemies.patroller.speed;
    expect(patrollerPosition(config, e, 0)).toEqual({ x: 2, y: 3 });
    const corner = patrollerPosition(config, e, (oneWay * 8) / 12);
    expect(corner.x).toBeCloseTo(10);
    expect(corner.y).toBeCloseTo(3);
    const end = patrollerPose(config, e, oneWay);
    expect(end.x).toBeCloseTo(10);
    expect(end.y).toBeCloseTo(7);
    // Facing the way it walks: right at first, then down, then left on the way back.
    expect(patrollerPose(config, e, 0.1).heading).toBeCloseTo(0);
    expect(patrollerPose(config, e, oneWay * 0.9).heading).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(patrollerPose(config, e, oneWay * 1.5).heading)).toBeCloseTo(Math.PI);
    expect(patrollerPosition(config, e, oneWay * 2).x).toBeCloseTo(2);
  });

  it('cost a heart and a shove when touched, without a stun', () => {
    const state = raceWith([]);
    const me = state.players[0]!;
    state.map.enemies = [{ kind: 'patroller', path: [{ x: me.x + 0.3, y: me.y }], phase: 0 }];
    const events = run(state, still, 1 / 60);
    expect(events[0]).toEqual({ type: 'enemyHit', playerId: 'p1', kind: 'patroller' });
    expect(me.health).toBe(config.health.hearts - 1);
    expect(me.effects).toEqual([]);
    expect(me.x).toBeLessThan(me.x + 1);
  });

  it('leave room to squeeze past by hugging the corridor wall', () => {
    // Patroller on the middle line of a two-tile corridor; a runner at the wall clears it.
    const reach = config.enemies.patroller.radius + config.player.radius;
    expect(1 - config.player.radius).toBeGreaterThanOrEqual(reach);
  });
});

describe('chasers', () => {
  it('sleep until a runner comes close and in sight, then chase, catch (a heart and a stun) and go home', () => {
    const state = raceWith([{ kind: 'chaser', x: 12.5, y: 3.5 }]);
    const me = state.players[0]!;
    const chaser = () => state.foes[0] as ChaserState;
    expect(run(state, still, 0.5).some((e) => e.type === 'foeCue' && e.sound === 'wake')).toBe(false);
    me.x = 12.5 - config.enemies.chaser.wakeRange + 1;
    const events: GameEvent[] = [];
    for (let i = 0; i < 300 && !events.some((e) => e.type === 'enemyHit'); i++) events.push(...step(state, { p1: still }));
    expect(events).toContainEqual({ type: 'foeCue', index: 0, sound: 'wake' });
    expect(events).toContainEqual({ type: 'enemyHit', playerId: 'p1', kind: 'chaser' });
    expect(me.health).toBe(config.health.hearts - 1);
    expect(events).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'stun', seconds: config.enemies.chaser.stunSeconds });
    expect(chaser().mode).toBe('return');
    // Resting: even with the runner still in reach, it does not catch them again at once.
    expect(run(state, still, config.enemies.chaser.restSeconds - 0.2).some((e) => e.type === 'enemyHit')).toBe(false);
    // It walks home and falls asleep again (move the runner well away first).
    me.x = 27.5;
    run(state, still, 8);
    expect(chaser().mode).toBe('sleep');
    expect(Math.hypot(chaser().x - 12.5, chaser().y - 3.5)).toBeLessThan(0.5);
  });

  it('do not wake for a runner behind a wall, and give up once they lose sight', () => {
    const state = raceWith([{ kind: 'chaser', x: 17.5, y: 1.5 }], ROOMS, 12.5, 1.5);
    const chaser = () => state.foes[0] as ChaserState;
    run(state, still, 1);
    expect(chaser().mode).toBe('sleep');
    // Seen through the gap: it wakes.
    const me = state.players[0]!;
    me.x = 14.5;
    me.y = 3.5;
    run(state, still, 0.2);
    expect(chaser().mode).toBe('chase');
    // Out of sight round the wall: after the give-up time it heads home.
    me.x = 3.5;
    me.y = 1.5;
    run(state, still, config.enemies.chaser.giveUpSeconds + 0.5);
    expect(chaser().mode).toBe('return');
  });

  it('ignore runners in their safe time', () => {
    const state = raceWith([{ kind: 'chaser', x: 6.5, y: 3.5 }]);
    state.players[0]!.safeTime = 2;
    run(state, still, 1);
    expect((state.foes[0] as ChaserState).mode).toBe('sleep');
  });
});

describe('turrets', () => {
  it('turn to a runner in range, whir, then fire a bolt that slows', () => {
    const state = raceWith([{ kind: 'turret', x: 10.5, y: 3.5 }]);
    const events = run(state, still, 3);
    const sounds = events.filter((e) => e.type === 'foeCue').map((e) => (e as { sound: string }).sound);
    expect(sounds.slice(0, 2)).toEqual(['whir', 'fire']);
    expect(events).toContainEqual({ type: 'enemyHit', playerId: 'p1', kind: 'turret' });
    expect(events).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'slow', seconds: config.enemies.turret.slowSeconds });
    expect(state.players[0]!.health).toBe(config.health.hearts);
  });

  it('cannot shoot through walls, and bolts stop at them', () => {
    const state = raceWith([{ kind: 'turret', x: 20.5, y: 1.5 }], ROOMS, 6.5, 1.5);
    expect(run(state, still, 4).some((e) => e.type === 'foeCue')).toBe(false);
    expect((state.foes[0] as TurretState).target).toBe(null);
    state.bolts.push({ id: 99, x: 13.5, y: 1.5, vx: 6, vy: 0, life: 3 });
    run(state, still, 0.5);
    expect(state.bolts).toEqual([]);
  });

  it('a runner can dodge a bolt by stepping aside', () => {
    const state = raceWith([{ kind: 'turret', x: 14.5, y: 3.5 }], HALL, 4.5, 3.5);
    const me = state.players[0]!;
    // Wait for the shot, then run sideways.
    for (let i = 0; i < 600 && state.bolts.length === 0; i++) step(state, { p1: still });
    const events = run(state, go(0, 1), 2);
    expect(events.some((e) => e.type === 'enemyHit')).toBe(false);
    expect(me.y).toBeGreaterThan(4.5);
  });
});

describe('hearing enemies', () => {
  it('gives a direction and loudness within range, and says when it is after you', () => {
    const state = raceWith([{ kind: 'chaser', x: 8.5, y: 3.5 }]);
    const me = state.players[0]!;
    const near = hearFoe(state, { type: 'foeCue', index: 0, sound: 'growl' }, me)!;
    expect(near.pan).toBeGreaterThan(0);
    expect(near.closeness).toBeGreaterThan(0.4);
    expect(near.aimed).toBe(false);
    (state.foes[0] as ChaserState).target = 'p1';
    expect(hearFoe(state, { type: 'foeCue', index: 0, sound: 'growl' }, me)!.aimed).toBe(true);
    me.x = 27.5;
    expect(hearFoe(state, { type: 'foeCue', index: 0, sound: 'snore' }, me)).toBe(null);
  });
});

describe('enemies on generated maps', () => {
  const sizes = Object.keys(MAP_SIZES) as (keyof typeof MAP_SIZES)[];

  it('places the size’s count, every kind appearing, the same for the same seed', () => {
    for (const size of sizes) {
      const kinds = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const map = generateMap({ seed: `enemies-${i}`, size });
        expect(map.enemies).toHaveLength(MAP_SIZES[size].enemies + MAP_SIZES[size].chasers);
        expect(map.enemies!.filter((e) => e.kind === 'chaser').length).toBeGreaterThanOrEqual(MAP_SIZES[size].chasers);
        for (const e of map.enemies!) {
          if (e.kind !== 'patroller') continue;
          // Every beat turns a corner, and each step is to a neighbouring cell through an opening.
          expect(e.path.length).toBeGreaterThanOrEqual(4);
          expect(e.path.some((pt, i) => i >= 2 && pt.x !== e.path[i - 2]!.x && pt.y !== e.path[i - 2]!.y)).toBe(true);
          for (let i = 1; i < e.path.length; i++) {
            const a = e.path[i - 1]!;
            const b = e.path[i]!;
            expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(3);
            for (let k = 0; k <= 6; k++) expect(isSolid(map, Math.floor(a.x + ((b.x - a.x) * k) / 6), Math.floor(a.y + ((b.y - a.y) * k) / 6))).toBe(false);
          }
        }
        for (const e of map.enemies!) kinds.add(e.kind);
        expect(generateMap({ seed: `enemies-${i}`, size }).enemies).toEqual(map.enemies);
      }
      expect([...kinds].sort()).toEqual(['chaser', 'patroller', 'turret']);
    }
  });

  it('keeps enemies on open ground, away from the start, finish and checkpoints', () => {
    for (const size of sizes) {
      for (let i = 0; i < 8; i++) {
        const map = generateMap({ seed: `enemy-clear-${i}`, size });
        const zones = [map.finish, ...map.checkpoints];
        for (const e of map.enemies!) {
          const points = e.kind === 'patroller' ? e.path : [{ x: e.x, y: e.y }];
          for (const pt of points) {
            expect(isSolid(map, Math.floor(pt.x), Math.floor(pt.y))).toBe(false);
            expect(zones.some((z) => inRect(z, pt.x, pt.y))).toBe(false);
            expect(map.startPositions.some((s) => Math.hypot(s.x - pt.x, s.y - pt.y) < 4)).toBe(false);
          }
        }
      }
    }
  });

  it('computer players still finish races with enemies about', () => {
    for (const size of sizes) {
      for (let i = 0; i < 2; i++) {
        const map = generateMap({ seed: `enemy-bots-${i}`, size });
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
});
