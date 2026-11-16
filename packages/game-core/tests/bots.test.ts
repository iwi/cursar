import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, createAutopilot, createRace, generateMap, skipPreview, step } from '../src';
import type { MapSize } from '../src';

/** Races one computer player; returns whether it finished, its time in seconds and where it went (sampled). */
function race(seed: string, size: MapSize, mistakes: number | undefined) {
  const map = generateMap({ seed, size });
  const state = createRace(map, [{ id: 'bot-1', name: 'Bot', color: 0 }]);
  const pilot = createAutopilot(map);
  skipPreview(state);
  const speed = BOT_LEVELS.normal.speed;
  const path: string[] = [];
  while (state.phase !== 'finished') {
    const p = state.players[0]!;
    const steer = state.phase === 'racing' ? pilot(p, false, { state, speed, mistakes }) : { seq: 0, mx: 0, my: 0, sprint: false };
    step(state, { 'bot-1': { ...steer, mx: steer.mx * speed, my: steer.my * speed } });
    if (state.tick % 30 === 0) path.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  const p = state.players[0]!;
  return { finished: p.finished, time: p.finishTime ?? state.tick / state.config.tickRate, path: path.join(' ') };
}

describe('computer players losing track', () => {
  it('take wrong turns now and then, cost some time, and still finish', () => {
    let slower = 0;
    for (const size of ['small', 'medium'] as const) {
      for (let i = 0; i < 3; i++) {
        const sure = race(`lost-${i}`, size, undefined);
        const lost = race(`lost-${i}`, size, BOT_LEVELS.easy.mistakes);
        expect(lost.finished).toBe(true);
        if (lost.time > sure.time + 1) slower++;
        // Not so many that it loses minutes.
        expect(lost.time).toBeLessThan(sure.time * 1.5);
      }
    }
    expect(slower).toBeGreaterThanOrEqual(3);
  });

  it('go wrong the same way every time on the same map', () => {
    expect(race('lost-same', 'small', 0.1).path).toBe(race('lost-same', 'small', 0.1).path);
  });

  it('never go wrong without the option', () => {
    // The demo mode and tests use the autopilot without mistakes.
    const a = race('lost-off', 'small', undefined);
    const b = race('lost-off', 'small', 0);
    expect(a.path).toBe(b.path);
  });
});
