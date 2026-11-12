import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type GameEvent, type PlayerInput, applyEffect, createRace, damage, generateMap, isSolid, skipPreview, step,
} from '../src';
import { mapFromText } from './helpers';

// Start on the left, one checkpoint in the middle, finish on the right.
const LANE = mapFromText([
  '##################',
  '#S.......C.......#',
  '#...............F#',
  '##################',
]);

const input = (mx: number, my: number): PlayerInput => ({ seq: 1, mx, my, sprint: false });

function startRacing() {
  const state = createRace(LANE, [{ id: 'p1', name: 'Tester', color: 0xffffff }]);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate); i++) events.push(...step(state, { p1: inp }));
  return events;
}
function hurt(state: ReturnType<typeof createRace>, amount = 1): GameEvent[] {
  const events: GameEvent[] = [];
  damage(state.config, state.players[0]!, amount, events);
  return events;
}

describe('health and respawning', () => {
  it('starts with full hearts and loses them to damage', () => {
    const state = startRacing();
    const me = state.players[0]!;
    expect(me.health).toBe(DEFAULT_CONFIG.health.hearts);
    expect(hurt(state)).toEqual([{ type: 'hurt', playerId: 'p1', amount: 1, health: 2 }]);
    expect(me.health).toBe(2);
  });

  it('out of hearts before any checkpoint: back to the start, full health, effects cleared', () => {
    const state = startRacing();
    const me = state.players[0]!;
    const start = { x: me.x, y: me.y };
    run(state, input(1, 0), 0.6);
    expect(me.x).toBeGreaterThan(start.x + 2);
    applyEffect(state.config, me, 'slow', []);
    hurt(state);
    hurt(state);
    const events = hurt(state);
    expect(events.map((e) => e.type)).toEqual(['hurt', 'respawn']);
    expect([me.x, me.y]).toEqual([start.x, start.y]);
    expect([me.vx, me.vy]).toEqual([0, 0]);
    expect(me.health).toBe(DEFAULT_CONFIG.health.hearts);
    expect(me.effects).toEqual([]);
  });

  it('a big hit can take several hearts at once', () => {
    const state = startRacing();
    expect(hurt(state, 5).map((e) => e.type)).toEqual(['hurt', 'respawn']);
    expect(state.players[0]!.health).toBe(DEFAULT_CONFIG.health.hearts);
  });

  it('a new checkpoint restores full health and becomes the respawn point, and still counts after respawning', () => {
    const state = startRacing();
    const me = state.players[0]!;
    hurt(state, 2);
    const events = run(state, input(1, 0), 2);
    expect(events.some((e) => e.type === 'checkpoint')).toBe(true);
    expect(me.health).toBe(DEFAULT_CONFIG.health.hearts);
    run(state, input(1, 0), 0.5);
    hurt(state, 3);
    expect([me.x, me.y]).toEqual([9.5, 1.5]);
    expect(me.checkpoints).toEqual([true]);
  });

  it('is safe from damage and harmful effects for a moment after respawning', () => {
    const state = startRacing();
    const me = state.players[0]!;
    hurt(state, 3);
    expect(me.safeTime).toBe(DEFAULT_CONFIG.health.respawnSafeSeconds);
    expect(hurt(state)).toEqual([]);
    expect(applyEffect(state.config, me, 'stun', [])).toBe(false);
    expect(applyEffect(state.config, me, 'haste', [])).toBe(true);
    run(state, input(0, 0), DEFAULT_CONFIG.health.respawnSafeSeconds + 0.05);
    expect(me.safeTime).toBe(0);
    expect(hurt(state)).toHaveLength(1);
  });

  it('every generated checkpoint is a safe place to come back to', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      for (let i = 0; i < 6; i++) {
        const map = generateMap({ seed: `respawn-${i}`, size });
        for (const zone of map.checkpoints) {
          expect(isSolid(map, Math.floor(zone.x + zone.w / 2), Math.floor(zone.y + zone.h / 2))).toBe(false);
        }
      }
    }
  });
});
