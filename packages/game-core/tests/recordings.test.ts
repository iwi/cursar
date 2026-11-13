import { describe, expect, it } from 'vitest';
import {
  GhostRecorder, RunTally, checkGhost, decodeMap, encodeMap, createRace, decodeGhostFile, encodeGhostFile, generateMap, ghostFromRoute,
  mapRef, packSamples, resolveMapRef, routeDistance, sampleGhost, skipPreview, step, unpackSamples,
} from '../src';
import { makeBot } from './helpers';

/** A raceable hand-made map: a generated layout read back as if it came from the editor. */
function handMade() {
  const { generator: _g, ...rest } = generateMap({ seed: 'handmade', size: 'tiny' });
  const read = decodeMap(encodeMap({ ...rest, name: 'Mine' }));
  if (!read.ok) throw new Error(read.error);
  return read.map;
}

/** A bot's finished run on a small generated map, with its ghost, route and tally. */
function botRun(seed = 'records') {
  const map = generateMap({ seed, size: 'tiny' });
  const state = createRace(map, [{ id: 'p1', name: 'Tester', color: 0xffffff }]);
  skipPreview(state);
  const bot = makeBot(map);
  const recorder = new GhostRecorder(state, 'p1');
  const tally = new RunTally('p1');
  const route: number[] = [];
  let ticks = 0;
  while (state.phase !== 'finished' && ticks++ < 60 * 400) {
    const events = step(state, { p1: bot(state) });
    recorder.capture();
    tally.update(state, events, false);
    const p = state.players[0]!;
    if (state.phase === 'racing' && state.raceTicks % state.config.ghost.routeEveryTicks === 0 && (!p.finished || p.finishTime === state.raceTime)) {
      route.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
    }
  }
  return { map, state, ghost: recorder.finish()!, tally: tally.summary, route };
}

describe('recordings', () => {
  const run = botRun();

  it('records checkpoint splits in the ghost and the tally', () => {
    expect(run.ghost).not.toBeNull();
    expect(run.ghost.splits).toHaveLength(run.map.checkpoints.length);
    expect(run.tally.splits).toEqual(run.ghost.splits);
    const splits = run.ghost.splits!;
    expect([...splits].sort((a, b) => a - b)).toEqual(splits);
    expect(splits.at(-1)!).toBeLessThan(run.ghost.time);
  });

  it('tallies distance close to the route length', () => {
    expect(run.tally.distance).toBeGreaterThan(10);
    expect(Math.abs(run.tally.distance - routeDistance(run.route)) / run.tally.distance).toBeLessThan(0.1);
  });

  it('counts the time spent on the full map', () => {
    const map = generateMap({ seed: 'peek', size: 'tiny' });
    const state = createRace(map, [{ id: 'p1', name: 'Tester', color: 0xffffff }]);
    skipPreview(state);
    while (state.phase !== 'racing') step(state, {});
    const tally = new RunTally('p1');
    for (let i = 0; i < 120; i++) tally.update(state, step(state, {}), true);
    expect(tally.summary.mapSeconds).toBeCloseTo(2, 5);
    expect(tally.summary.distance).toBe(0);
  });

  it('turns a results route into a ghost that follows it', () => {
    const ghost = ghostFromRoute(run.route, {
      mapId: run.map.id, mapVersion: run.map.version, playerName: 'Rival', time: run.ghost.time,
      intervalMs: (1000 * run.state.config.ghost.routeEveryTicks) / run.state.config.tickRate,
    })!;
    expect(ghost).not.toBeNull();
    expect(ghost.intervalMs).toBe(100);
    expect(ghost.samples.length).toBe((run.route.length / 2) * 3);
    for (const t of [1, 5, 10, run.ghost.time - 1]) {
      const a = sampleGhost(ghost, t)!;
      const b = sampleGhost(run.ghost, t)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.3);
    }
  });

  it('packs samples into a much shorter string and back', () => {
    const packed = packSamples(run.ghost.samples);
    expect(packed.length).toBeLessThan(JSON.stringify(run.ghost.samples).length / 2);
    const back = unpackSamples(packed)!;
    expect(back).toHaveLength(run.ghost.samples.length);
    back.forEach((v, i) => expect(Math.abs(v - run.ghost.samples[i]!)).toBeLessThanOrEqual(0.0051));
    expect(unpackSamples('1,2,<script>')).toBeNull();
    expect(unpackSamples('')).toBeNull();
  });

  it('writes and reads ghost files for generated maps', () => {
    const file = JSON.parse(JSON.stringify(encodeGhostFile(run.ghost, run.map)));
    expect(file.map).toEqual({ seed: 'records', size: 'tiny' });
    const read = decodeGhostFile(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.map.id).toBe(run.map.id);
    expect(read.ghost.time).toBe(run.ghost.time);
    expect(read.ghost.splits).toEqual(run.ghost.splits);
  });

  it('writes and reads ghost files for hand-made maps', () => {
    const map = handMade();
    const ghost = { ...run.ghost, mapId: map.id };
    const file = JSON.parse(JSON.stringify(encodeGhostFile(ghost, map)));
    expect('map' in file.map).toBe(true);
    const read = decodeGhostFile(file);
    expect(read.ok && read.map.id).toBe(map.id);
  });

  it('refuses ghost files that do not fit their map or are damaged', () => {
    const good = JSON.parse(JSON.stringify(encodeGhostFile(run.ghost, run.map)));
    expect(decodeGhostFile({ ...good, map: { seed: 'other', size: 'tiny' } }).ok).toBe(false);
    expect(decodeGhostFile({ ...good, kind: 'map' }).ok).toBe(false);
    expect(decodeGhostFile({ ...good, ghost: { ...good.ghost, time: -1 } }).ok).toBe(false);
    expect(decodeGhostFile({ ...good, ghost: { ...good.ghost, samples: 'zz,zz' } }).ok).toBe(false);
    expect(decodeGhostFile({ ...good, map: { seed: 'x', size: 'enormous' } }).ok).toBe(false);
    expect(decodeGhostFile(null).ok).toBe(false);
  });

  it('cleans names and rejects broken ghosts', () => {
    expect(checkGhost({ ...run.ghost, playerName: '\u0007' + 'x'.repeat(50) })!.playerName).toBe('x'.repeat(24));
    expect(checkGhost({ ...run.ghost, samples: [1, 2] })).toBeNull();
    expect(checkGhost({ ...run.ghost, samples: [1, 2, NaN] })).toBeNull();
    expect(checkGhost({ ...run.ghost, splits: ['a'] })).toBeNull();
    expect(checkGhost({ ...run.ghost, format: 2 })).toBeNull();
  });

  it('refers to generated maps by seed and others whole', () => {
    expect(mapRef(run.map)).toEqual({ seed: 'records', size: 'tiny' });
    const custom = handMade();
    const ref = mapRef(custom);
    expect('map' in ref).toBe(true);
    const back = resolveMapRef(ref);
    expect(back.ok && back.map.id).toBe(custom.id);
  });
});
