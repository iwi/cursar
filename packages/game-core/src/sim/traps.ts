import { applyEffect } from './effects';
import { damage } from './health';
import type { GameEvent, PlayerState, RaceState } from './types';

export function trapArmed(state: RaceState, index: number): boolean {
  return (state.traps[index] ?? 0) <= state.raceTime;
}

/**
 * Springs an armed trap under the runner (their centre on its tile). A sprung
 * trap is safe for everyone until it re-arms. Nothing springs during the safe
 * time after a respawn.
 */
export function springTraps(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  const traps = state.map.traps;
  if (!traps || traps.length === 0 || p.finished || p.safeTime > 0) return;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const index = traps.findIndex((t, i) => t.x === tx && t.y === ty && trapArmed(state, i));
  if (index < 0) return;
  const { config } = state;
  const t = config.traps;
  const trap = traps[index]!;
  state.traps[index] = state.raceTime + t.rearmSeconds;
  events.push({ type: 'trap', playerId: p.id, index, kind: trap.kind });
  switch (trap.kind) {
    case 'spikes':
      damage(config, p, t.spikesDamage, events);
      break;
    case 'snare':
      applyEffect(config, p, 'stun', events, t.snareStunSeconds);
      break;
    case 'glue':
      applyEffect(config, p, 'slow', events, t.glueSlowSeconds);
      break;
    case 'flash':
      applyEffect(config, p, 'blind', events, t.flashBlindSeconds);
      break;
    case 'reverse':
      applyEffect(config, p, 'reversed', events, t.trickSeconds);
      break;
    case 'confuse':
      applyEffect(config, p, 'confused', events, t.trickSeconds);
      break;
  }
}
