import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type GameEvent, MAP_SIZES, type PlayerInput, TRAP_KINDS, type Trap, type TrapKind, createAutopilot,
  createRace, generateMap, inRect, skipPreview, step, tileAt, Tile, trapArmed,
} from '../src';
import { mapFromText } from './helpers';

const ROOM = mapFromText([
  '####################',
  '#S.................#',
  '#..................#',
  '#..................#',
  '#.................F#',
  '####################',
]);
const config = DEFAULT_CONFIG;
const still: PlayerInput = { seq: 1, mx: 0, my: 0, sprint: false };

/** A race with traps, at the racing phase, with the runner standing at (x, y). */
function raceWith(traps: Trap[], x = 5.5, y = 2.5) {
  const state = createRace({ ...ROOM, traps }, [{ id: 'p1', name: 'Tester', color: 0 }]);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  state.players[0]!.x = x;
  state.players[0]!.y = y;
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate); i++) events.push(...step(state, { p1: inp }));
  return events;
}

describe('traps', () => {
  const expected: Record<TrapKind, (events: GameEvent[], s: ReturnType<typeof raceWith>) => void> = {
    spikes: (_e, s) => expect(s.players[0]!.health).toBe(config.health.hearts - config.traps.spikesDamage),
    snare: (e) => expect(e).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'stun', seconds: config.traps.snareStunSeconds }),
    glue: (e) => expect(e).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'slow', seconds: config.traps.glueSlowSeconds }),
    flash: (e) => expect(e).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'blind', seconds: config.traps.flashBlindSeconds }),
    reverse: (e) => expect(e).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'reversed', seconds: config.traps.reverseSeconds }),
    confuse: (e) => expect(e).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'confused', seconds: config.traps.confuseSeconds }),
  };

  for (const kind of TRAP_KINDS) {
    it(`${kind}: springs under the runner and does its job`, () => {
      const state = raceWith([{ kind, x: 5, y: 2 }]);
      const events = run(state, still, 1 / 60);
      expect(events[0]).toEqual({ type: 'trap', playerId: 'p1', index: 0, kind });
      expected[kind](events, state);
    });
  }

  it('is safe once sprung and arms again after the re-arm time', () => {
    const state = raceWith([{ kind: 'glue', x: 5, y: 2 }]);
    run(state, still, 1 / 60);
    expect(trapArmed(state, 0)).toBe(false);
    // Standing on it: nothing more while it is sprung.
    expect(run(state, still, config.traps.rearmSeconds - 0.2).some((e) => e.type === 'trap')).toBe(false);
    expect(run(state, still, 0.4).some((e) => e.type === 'trap')).toBe(true);
  });

  it('does not spring next to the runner, or during the safe time after a respawn', () => {
    const beside = raceWith([{ kind: 'spikes', x: 6, y: 2 }]);
    expect(run(beside, still, 0.2).some((e) => e.type === 'trap')).toBe(false);
    const safe = raceWith([{ kind: 'spikes', x: 5, y: 2 }]);
    safe.players[0]!.safeTime = 1;
    expect(run(safe, still, 0.5).some((e) => e.type === 'trap')).toBe(false);
  });
});

describe('traps on generated maps', () => {
  const sizes = Object.keys(MAP_SIZES) as (keyof typeof MAP_SIZES)[];

  it('places the size’s count on plain floor, every kind appearing, the same for the same seed', () => {
    for (const size of sizes) {
      const kinds = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const map = generateMap({ seed: `traps-${i}`, size });
        expect(map.traps).toHaveLength(MAP_SIZES[size].traps);
        for (const t of map.traps!) {
          kinds.add(t.kind);
          expect(tileAt(map, t.x, t.y)).toBe(Tile.Floor);
        }
        expect(generateMap({ seed: `traps-${i}`, size }).traps).toEqual(map.traps);
      }
      expect([...kinds].sort()).toEqual([...TRAP_KINDS].sort());
    }
  });

  it('keeps traps off the start, finish, checkpoints, plazas and obstacles, and apart from each other', () => {
    for (const size of sizes) {
      for (let i = 0; i < 8; i++) {
        const map = generateMap({ seed: `trap-clear-${i}`, size });
        const zones = [map.finish, ...map.checkpoints];
        for (const t of map.traps!) {
          const cx = t.x + 0.5;
          const cy = t.y + 0.5;
          expect(zones.some((z) => inRect(z, cx, cy))).toBe(false);
          expect(map.startPositions.some((p) => Math.hypot(p.x - cx, p.y - cy) < 3)).toBe(false);
          expect(map.landmarks.some((l) => Math.hypot(l.x - cx, l.y - cy) < 3)).toBe(false);
          for (const o of map.obstacles!) {
            if (o.kind === 'gate') expect(Math.hypot(o.x - t.x, o.y - t.y)).toBeGreaterThan(2);
            if (o.kind === 'barrier') expect(Math.hypot(o.x - cx, o.y - cy)).toBeGreaterThan(2.5);
          }
          for (const other of map.traps!) {
            if (other !== t) expect(Math.hypot(other.x - t.x, other.y - t.y)).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  it('careful computer players step round the traps they know about', () => {
    let sprung = 0;
    for (const size of sizes) {
      const map = generateMap({ seed: 'trap-bots', size });
      const state = createRace(map, [{ id: 'p1', name: 'Bot', color: 0 }]);
      const pilot = createAutopilot(map);
      skipPreview(state);
      while (state.phase !== 'finished') {
        const steer = state.phase === 'racing' ? pilot(state.players[0]!, false, { state, speed: 0.6 }) : { seq: 0, mx: 0, my: 0, sprint: false };
        sprung += step(state, { p1: { ...steer, mx: steer.mx * 0.6, my: steer.my * 0.6 } }).filter((e) => e.type === 'trap').length;
      }
      expect(state.players[0]!.finished).toBe(true);
    }
    expect(sprung).toBeLessThanOrEqual(1);
  });
});
