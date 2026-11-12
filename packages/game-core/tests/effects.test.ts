import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type EffectKind, type GameEvent, type PlayerInput, applyEffect, cloneConfig, computeVisibility,
  createRace, effectiveVision, resumeRace, skipPreview, step,
} from '../src';
import { mapFromText } from './helpers';

const OPEN = mapFromText([
  '##############################',
  '#............................#',
  '#............................#',
  '#............................#',
  '#.............S..............#',
  '#............................#',
  '#............................#',
  '#............................#',
  '#...........................F#',
  '##############################',
]);

const input = (mx: number, my: number, sprint = false): PlayerInput => ({ seq: 1, mx, my, sprint });

function startRacing(config = DEFAULT_CONFIG) {
  const state = createRace(OPEN, [{ id: 'p1', name: 'Tester', color: 0xffffff }], config);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate); i++) events.push(...step(state, { p1: inp }));
  return events;
}
function apply(state: ReturnType<typeof createRace>, kind: EffectKind, seconds?: number): GameEvent[] {
  const events: GameEvent[] = [];
  applyEffect(state.config, state.players[0]!, kind, events, seconds);
  return events;
}
/** Distance covered in `seconds` running right, from a standstill. */
function distanceRight(state: ReturnType<typeof createRace>, seconds: number): number {
  const x = state.players[0]!.x;
  run(state, input(1, 0), seconds);
  return state.players[0]!.x - x;
}

describe('effects', () => {
  it('slow and haste change top speed, and combine', () => {
    const plain = distanceRight(startRacing(), 1);
    const slowed = startRacing();
    apply(slowed, 'slow');
    expect(distanceRight(slowed, 1) / plain).toBeCloseTo(DEFAULT_CONFIG.effects.slow.speedMul, 1);
    const hasted = startRacing();
    apply(hasted, 'haste');
    expect(distanceRight(hasted, 1) / plain).toBeCloseTo(DEFAULT_CONFIG.effects.haste.speedMul, 1);
    const both = startRacing();
    apply(both, 'slow');
    apply(both, 'haste');
    expect(distanceRight(both, 1) / plain).toBeCloseTo(DEFAULT_CONFIG.effects.slow.speedMul * DEFAULT_CONFIG.effects.haste.speedMul, 1);
  });

  it('a stunned runner cannot move or sprint, then moves again', () => {
    const state = startRacing();
    const me = state.players[0]!;
    const started = apply(state, 'stun');
    expect(started).toContainEqual({ type: 'effect', playerId: 'p1', kind: 'stun', seconds: DEFAULT_CONFIG.effects.stun.seconds });
    const x = me.x;
    const during = run(state, input(1, 0, true), DEFAULT_CONFIG.effects.stun.seconds - 0.05);
    expect(me.x).toBeCloseTo(x, 5);
    expect(me.stamina).toBe(DEFAULT_CONFIG.sprint.staminaMax);
    expect(during.some((e) => e.type === 'effectEnd')).toBe(false);
    const after = run(state, input(1, 0), 0.5);
    expect(after).toContainEqual({ type: 'effectEnd', playerId: 'p1', kind: 'stun' });
    expect(me.x).toBeGreaterThan(x + 1);
    expect(me.effects).toEqual([]);
  });

  it('reversed flips the controls and confused turns them a quarter turn', () => {
    const reversed = startRacing();
    const r = reversed.players[0]!;
    const rx = r.x;
    apply(reversed, 'reversed');
    run(reversed, input(1, 0), 0.5);
    expect(r.x).toBeLessThan(rx - 1);

    const confused = startRacing();
    const c = confused.players[0]!;
    const [cx, cy] = [c.x, c.y];
    apply(confused, 'confused');
    run(confused, input(1, 0), 0.5);
    expect(c.y).toBeGreaterThan(cy + 1);
    expect(Math.abs(c.x - cx)).toBeLessThan(0.1);
  });

  it('the same effect again keeps the longer time instead of stacking', () => {
    const state = startRacing();
    const me = state.players[0]!;
    apply(state, 'slow', 3);
    apply(state, 'slow', 1);
    expect(me.effects).toEqual([{ kind: 'slow', time: 3, total: 3 }]);
    apply(state, 'slow', 5);
    expect(me.effects).toEqual([{ kind: 'slow', time: 5, total: 5 }]);
  });

  it('loss of control comes one at a time, with a guard after it ends', () => {
    const config = cloneConfig();
    const state = startRacing(config);
    const me = state.players[0]!;
    apply(state, 'stun');
    // Nothing else that takes control while stunned, not even another stun.
    expect(apply(state, 'reversed')).toEqual([{ type: 'effectResisted', playerId: 'p1', kind: 'reversed' }]);
    expect(apply(state, 'stun')[0]!.type).toBe('effectResisted');
    // Other effects are not affected by the guard.
    expect(apply(state, 'slow')[0]!.type).toBe('effect');

    run(state, input(0, 0), config.effects.stun.seconds + 0.02);
    expect(me.effects.map((e) => e.kind)).toEqual(['slow']);
    expect(me.controlGuard).toBeGreaterThan(config.effects.controlGuardSeconds - 0.05);
    expect(apply(state, 'confused')[0]!.type).toBe('effectResisted');

    run(state, input(0, 0), config.effects.controlGuardSeconds);
    expect(apply(state, 'confused')[0]!.type).toBe('effect');
  });

  it('blinded runners see less', () => {
    const state = startRacing();
    const me = state.players[0]!;
    const count = () => {
      const out = new Uint8Array(OPEN.width * OPEN.height);
      computeVisibility(OPEN, me.x, me.y, me.facing, effectiveVision(state.config, me), out);
      return out.reduce((sum, v) => sum + v, 0);
    };
    const normal = count();
    apply(state, 'blind');
    expect(effectiveVision(state.config, me).ahead).toBeCloseTo(DEFAULT_CONFIG.vision.ahead * DEFAULT_CONFIG.effects.blind.visionMul);
    expect(count()).toBeLessThan(normal / 2);
  });

  it('effects stand still during the count after a pause and are cleared at the finish', () => {
    const state = startRacing();
    const me = state.players[0]!;
    apply(state, 'slow', 2);
    resumeRace(state);
    run(state, input(0, 0), DEFAULT_CONFIG.race.resumeCountdownSeconds - 0.1);
    expect(me.effects[0]!.time).toBe(2);

    expect(applyEffect(state.config, { ...me, finished: true }, 'stun', [])).toBe(false);
    run(state, input(0, 0), 0.2);
    // Walk to the finish (bottom right).
    for (let i = 0; i < 60 * 20 && !me.finished; i++) step(state, { p1: input(Math.sign(28.5 - me.x), Math.sign(8.5 - me.y)) });
    expect(me.finished).toBe(true);
    expect(me.effects).toEqual([]);
  });
});
