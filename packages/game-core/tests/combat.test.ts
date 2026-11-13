import { describe, expect, it } from 'vitest';
import {
  type ChaserState, DEFAULT_CONFIG, type GameEvent, type GameMap, type PlayerInput, createRace, skipPreview, step,
} from '../src';
import { mapFromText } from './helpers';

const ROOM = mapFromText([
  '##################',
  '#S...............#',
  '#S...............#',
  '#................#',
  '#........C......F#',
  '##################',
]);
const config = DEFAULT_CONFIG;
const still: PlayerInput = { seq: 1, mx: 0, my: 0, sprint: false };
const shove: PlayerInput = { ...still, shove: true };

function race(map: GameMap = ROOM) {
  const state = createRace(map, [
    { id: 'a', name: 'Ana', color: 0, slot: 0 },
    { id: 'b', name: 'Ben', color: 1, slot: 1 },
  ]);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  const [a, b] = state.players as [typeof state.players[0], typeof state.players[0]];
  // Ana at (5, 2.5) facing right; Ben just in front of her.
  a.x = 5;
  a.y = 2.5;
  a.facing = 0;
  b.x = 5.8;
  b.y = 2.5;
  a.safeTime = 0;
  b.safeTime = 0;
  return { state, a, b };
}
function run(state: ReturnType<typeof race>['state'], inputs: Record<string, PlayerInput>, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * config.tickRate); i++) events.push(...step(state, inputs));
  return events;
}

describe('the shove', () => {
  it('knocks a rival in front back and stuns them briefly, without a heart', () => {
    const { state, a, b } = race();
    const events = run(state, { a: shove, b: still }, 1 / 60);
    expect(events).toContainEqual({ type: 'shove', playerId: 'a' });
    expect(events).toContainEqual({ type: 'shoveHit', playerId: 'a', target: 'rival' });
    expect(events).toContainEqual({ type: 'shoved', playerId: 'b', by: 'a' });
    expect(b.effects.map((e) => e.kind)).toEqual(['stun']);
    expect(b.health).toBe(config.health.hearts);
    expect(a.stamina).toBeLessThanOrEqual(config.sprint.staminaMax - config.combat.staminaCost);
    run(state, { a: still, b: still }, 1);
    // Slid away about two tiles.
    expect(b.x - 5.8).toBeGreaterThan(1.5);
  });

  it('misses a rival behind or out of reach, and waits for its cooldown', () => {
    const behind = race();
    behind.b.x = 3.8;
    expect(run(behind.state, { a: shove, b: still }, 1 / 60).some((e) => e.type === 'shoveHit')).toBe(false);

    const far = race();
    far.b.x = 5 + config.player.radius * 2 + config.combat.reach + 0.2;
    expect(run(far.state, { a: shove, b: still }, 1 / 60).some((e) => e.type === 'shoveHit')).toBe(false);

    const { state } = race();
    run(state, { a: shove, b: still }, 1 / 60);
    expect(run(state, { a: shove, b: still }, 1 / 60).some((e) => e.type === 'shove')).toBe(false);
    run(state, { a: still, b: still }, config.combat.cooldownSeconds);
    expect(run(state, { a: shove, b: still }, 1 / 60).some((e) => e.type === 'shove')).toBe(true);
  });

  it('needs the stamina for it', () => {
    const { state, a } = race();
    a.stamina = config.combat.staminaCost - 1;
    expect(run(state, { a: shove, b: still }, 1 / 60).some((e) => e.type === 'shove')).toBe(false);
  });

  it('stuns a chasing chaser, which then goes home to rest', () => {
    const { state, b } = race({ ...ROOM, enemies: [{ kind: 'chaser', x: 14.5, y: 3.5 }] });
    b.x = 14;
    b.y = 4.5;
    b.finished = true;
    const chaser = state.foes[0] as ChaserState;
    chaser.mode = 'chase';
    chaser.target = 'a';
    chaser.x = 5.8;
    chaser.y = 2.5;
    const events = run(state, { a: shove, b: still }, 1 / 60);
    expect(events).toContainEqual({ type: 'shoveHit', playerId: 'a', target: 'chaser' });
    expect(chaser.stun).toBeGreaterThan(0);
    expect(chaser.mode).toBe('return');
    // Dazed: it stands still and does not catch Ana.
    expect(run(state, { a: still, b: still }, config.combat.chaserStunSeconds - 0.1).some((e) => e.type === 'enemyHit')).toBe(false);
    expect(chaser.x).toBeCloseTo(5.8);
  });
});
