import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, type GameEvent, type GameMap, MAP_SIZES, type PlayerInput, SKILLS, SKILL_IDS, type SkillId, applyEffect,
  createRace, damage, effectiveVision, generateMap, inRect, isSolid, maxHearts, pickSkill, skipPreview, step, trapReach, trapSenses,
  wakeRange,
} from '../src';
import { mapFromText } from './helpers';

// Start, a treasure (T in the text is placed by hand below), a checkpoint, the finish.
const LANE = mapFromText([
  '############################',
  '#S.........C...............#',
  '#..........................#',
  '#.........................F#',
  '############################',
]);
const config = DEFAULT_CONFIG;
const still: PlayerInput = { seq: 1, mx: 0, my: 0, sprint: false };
const right: PlayerInput = { seq: 1, mx: 1, my: 0, sprint: false };

function raceOn(map: GameMap) {
  const state = createRace(map, [{ id: 'p1', name: 'Tester', color: 0 }]);
  skipPreview(state);
  while (state.phase !== 'racing') step(state, {});
  return state;
}
function run(state: ReturnType<typeof createRace>, inp: PlayerInput, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * state.config.tickRate) && state.phase === 'racing'; i++) events.push(...step(state, { p1: inp }));
  return events;
}
/** A runner who has taken `skills` (given the points for them). */
function withSkills(skills: SkillId[]) {
  const state = raceOn(LANE);
  const me = state.players[0]!;
  for (const id of skills) {
    me.points += SKILLS[id].cost;
    me.offer = [id];
    pickSkill(state, 'p1', 0, []);
  }
  return { state, me };
}

describe('treasures and the skill pick', () => {
  it('a treasure gives a point once; a checkpoint with points deals three cards', () => {
    const state = raceOn({ ...LANE, treasures: [{ x: 5.5, y: 1.5 }] });
    const me = state.players[0]!;
    const events = run(state, right, 3);
    expect(events.filter((e) => e.type === 'treasure')).toEqual([{ type: 'treasure', playerId: 'p1', index: 0, points: 1 }]);
    const offer = events.find((e) => e.type === 'offer');
    expect(offer && offer.type === 'offer' && offer.cards).toHaveLength(3);
    expect(me.offer!.some((id) => SKILLS[id].cost <= me.points)).toBe(true);
    expect(me.treasures).toEqual([true]);
  });

  it('no points, no cards; the offer waits and is not replaced; picking spends points and adds threat', () => {
    const state = raceOn(LANE);
    const me = state.players[0]!;
    expect(run(state, right, 3).some((e) => e.type === 'offer')).toBe(false);

    const again = raceOn({ ...LANE, checkpoints: [{ x: 5, y: 1, w: 1, h: 1 }, { x: 11, y: 1, w: 1, h: 1 }] });
    const p = again.players[0]!;
    p.points = 3;
    run(again, right, 3);
    const first = [...p.offer!];
    expect(p.offersMade).toBe(1);
    const cheap = first.findIndex((id) => SKILLS[id].cost <= p.points);
    const card = SKILLS[first[cheap]!];
    const events: GameEvent[] = [];
    expect(pickSkill(again, 'p1', cheap, events)).toBe(true);
    expect(events).toEqual([{ type: 'skill', playerId: 'p1', skill: card.id }]);
    expect(p.points).toBe(3 - card.cost);
    expect(p.threat).toBe(card.threat);
    expect(p.offer).toBe(null);
    expect(me.skills).toEqual([]);
  });

  it('cannot take a card it cannot afford, or one not on offer', () => {
    const state = raceOn(LANE);
    const me = state.players[0]!;
    me.points = 1;
    me.offer = ['fleetFoot', 'navigation', 'tough'];
    expect(pickSkill(state, 'p1', 0, [])).toBe(false);
    expect(pickSkill(state, 'p1', 5, [])).toBe(false);
    expect(pickSkill(state, 'p1', 1, [])).toBe(true);
    expect(me.skills).toEqual(['navigation']);
  });

  it('deals the same cards for the same race, and never a skill already taken', () => {
    const deal = () => {
      const s = raceOn({ ...LANE, treasures: [{ x: 5.5, y: 1.5 }] });
      s.players[0]!.skills = ['dash'];
      run(s, right, 3);
      return s.players[0]!.offer;
    };
    expect(deal()).toEqual(deal());
    expect(deal()).not.toContain('dash');
  });
});

describe('what the skills do', () => {
  it('senses: longer memory, traps seen and heard further, wider vision', () => {
    const { state, me } = withSkills(['navigation', 'trapSense', 'wideEyes']);
    expect(effectiveVision(state.config, me).memorySeconds).toBe(config.skills.navigationMemorySeconds);
    expect(effectiveVision(state.config, me).ahead).toBeCloseTo(config.vision.ahead * config.skills.wideEyesMul);
    expect(trapSenses(state.config, me)).toEqual({ reveal: config.skills.trapSenseReveal, tell: config.skills.trapSenseTell });
  });

  it('body: faster, longer sprint, a fourth heart, shorter loss of control', () => {
    const plain = withSkills([]);
    const quick = withSkills(['fleetFoot']);
    const x0 = plain.me.x;
    run(plain.state, right, 1);
    run(quick.state, right, 1);
    expect((quick.me.x - x0) / (plain.me.x - x0)).toBeCloseTo(config.skills.fleetFootSpeedMul, 1);

    const lungs = withSkills(['deepLungs']);
    const base = withSkills([]);
    run(lungs.state, { ...right, sprint: true }, 1.5);
    run(base.state, { ...right, sprint: true }, 1.5);
    expect(lungs.me.stamina).toBeGreaterThan(base.me.stamina);

    const tough = withSkills(['tough']);
    expect(tough.me.health).toBe(config.health.hearts + 1);
    expect(maxHearts(tough.state.config, tough.me)).toBe(config.health.hearts + 1);

    const steady = withSkills(['steady']);
    applyEffect(steady.state.config, steady.me, 'reversed', []);
    expect(steady.me.effects[0]!.time).toBeCloseTo(config.effects.reversed.seconds * config.skills.steadyMul);
  });

  it('dash: a burst of speed on its key, then a cooldown', () => {
    const { state, me } = withSkills(['dash']);
    const events = run(state, { ...right, use: 'dash' }, 1 / 60);
    expect(events).toContainEqual({ type: 'skillUsed', playerId: 'p1', skill: 'dash' });
    expect(me.dashTime).toBeGreaterThan(0);
    // Using it again straight away does nothing.
    expect(run(state, { ...right, use: 'dash' }, 1 / 60).some((e) => e.type === 'skillUsed')).toBe(false);
    run(state, right, config.skills.dash.cooldownSeconds);
    expect(run(state, { ...right, use: 'dash' }, 1 / 60).some((e) => e.type === 'skillUsed')).toBe(true);
  });

  it('only skills the runner has can be used', () => {
    const { state } = withSkills([]);
    expect(run(state, { ...still, use: 'decoy' }, 1 / 60).some((e) => e.type === 'skillUsed')).toBe(false);
    expect(state.decoys).toEqual([]);
  });

  it('decoy: chasers go after it instead of the runner, and it runs out', () => {
    const map: GameMap = { ...LANE, enemies: [{ kind: 'chaser', x: 8.5, y: 2.5 }] };
    const state = raceOn(map);
    const me = state.players[0]!;
    me.skills = ['decoy'];
    me.x = 5.5;
    me.y = 2.5;
    run(state, { ...still, use: 'decoy' }, 1 / 60);
    expect(state.decoys).toHaveLength(1);
    me.x = 2.5;
    me.y = 3.5;
    const events = run(state, still, 1.5);
    expect(events.some((e) => e.type === 'enemyHit')).toBe(false);
    run(state, still, config.skills.decoy.seconds);
    expect(state.decoys).toEqual([]);
  });
});

describe('threat', () => {
  it('chasers wake further off and go for the highest-threat runner; traps catch on a brush', () => {
    const state = raceOn(LANE);
    const me = state.players[0]!;
    expect(wakeRange(state.config, me)).toBe(config.enemies.chaser.wakeRange);
    expect(trapReach(state.config, me)).toBe(0);
    me.threat = 4;
    expect(wakeRange(state.config, me)).toBe(config.enemies.chaser.wakeRange + 4 * config.threat.wakeRangePerThreat);
    expect(trapReach(state.config, me)).toBeCloseTo(4 * config.threat.trapReachPerThreat);
    me.threat = 99;
    expect(trapReach(state.config, me)).toBe(config.threat.trapReachMax);
  });

  it('a trap next to a high-threat runner springs; next to a calm one it does not', () => {
    const calm = raceOn({ ...LANE, traps: [{ kind: 'glue', x: 6, y: 2 }] });
    calm.players[0]!.x = 5.85;
    calm.players[0]!.y = 2.5;
    expect(run(calm, still, 0.1).some((e) => e.type === 'trap')).toBe(false);
    const bold = raceOn({ ...LANE, traps: [{ kind: 'glue', x: 6, y: 2 }] });
    bold.players[0]!.x = 5.85;
    bold.players[0]!.y = 2.5;
    bold.players[0]!.threat = 6;
    expect(run(bold, still, 0.1).some((e) => e.type === 'trap')).toBe(true);
  });

  it('enemies prefer the runner with more threat', () => {
    const map: GameMap = { ...LANE, enemies: [{ kind: 'turret', x: 12.5, y: 2.5 }] };
    const state = createRace(map, [{ id: 'a', name: 'A', color: 0, slot: 0 }]);
    // Two runners at equal distance either side; the far-threat one is picked.
    state.players.push({ ...state.players[0]!, id: 'b', name: 'B', effects: [], cooldowns: {}, skills: [], treasures: [], checkpoints: [false], markers: [], footprints: [] });
    skipPreview(state);
    while (state.phase !== 'racing') step(state, {});
    const [a, b] = state.players;
    a!.x = 9.5;
    a!.y = 2.5;
    b!.x = 15.5;
    b!.y = 2.5;
    b!.threat = 3;
    step(state, { a: still, b: still });
    expect((state.foes[0] as { target: string }).target).toBe('b');
  });

  it('damage still respawns with the right number of hearts for Tough', () => {
    const { state, me } = withSkills(['tough']);
    damage(state.config, me, 99, []);
    expect(me.health).toBe(config.health.hearts + 1);
  });
});

describe('treasures on generated maps', () => {
  it('places the size’s count on open ground, away from the start, finish and checkpoints', () => {
    for (const size of Object.keys(MAP_SIZES) as (keyof typeof MAP_SIZES)[]) {
      for (let i = 0; i < 6; i++) {
        const map = generateMap({ seed: `treasure-${i}`, size });
        expect(map.treasures).toHaveLength(MAP_SIZES[size].treasures);
        for (const t of map.treasures!) {
          expect(isSolid(map, Math.floor(t.x), Math.floor(t.y))).toBe(false);
          expect([map.finish, ...map.checkpoints].some((z) => inRect(z, t.x, t.y))).toBe(false);
          expect(map.startPositions.some((s) => Math.hypot(s.x - t.x, s.y - t.y) < 4)).toBe(false);
        }
      }
    }
  });

  it('every skill is in the deck, with a cost of 1 to 3', () => {
    expect(SKILL_IDS).toHaveLength(10);
    for (const id of SKILL_IDS) {
      expect(SKILLS[id].cost).toBeGreaterThanOrEqual(1);
      expect(SKILLS[id].cost).toBeLessThanOrEqual(3);
    }
  });
});
