import { applyEffect } from './effects';
import { damage } from './health';
import { hasSkill, trapReach } from './skills';
import type { GameEvent, PlayerState, RaceState } from './types';

export function trapArmed(state: RaceState, index: number): boolean {
  return (state.traps[index] ?? 0) <= state.raceTime;
}

/**
 * Springs an armed trap under the runner (their centre on its tile, or close
 * to it for a runner with threat: see `trapReach`). A sprung
 * trap is safe for everyone until it re-arms. Nothing springs during the safe
 * time after a respawn.
 *
 * With Trap sense, an armed trap clicks first and springs only if the runner
 * is still on it `trapSenseDelaySeconds` later; stepping off in time leaves it
 * armed.
 */
export function springTraps(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  const traps = state.map.traps;
  if (!traps || traps.length === 0 || p.finished || p.safeTime > 0) {
    p.trapClick = null;
    return;
  }
  // Standing on its tile springs it; with threat, merely coming close does.
  const reach = trapReach(state.config, p);
  const index = traps.findIndex((t, i) => {
    if (!trapArmed(state, i)) return false;
    const nearX = Math.max(t.x, Math.min(p.x, t.x + 1));
    const nearY = Math.max(t.y, Math.min(p.y, t.y + 1));
    const gap = Math.hypot(p.x - nearX, p.y - nearY);
    return reach > 0 ? gap < reach : gap === 0;
  });
  if (index < 0) {
    p.trapClick = null;
    return;
  }
  const { config } = state;
  if (hasSkill(p, 'trapSense')) {
    if (p.trapClick?.index !== index) {
      p.trapClick = { index, at: state.raceTime };
      events.push({ type: 'trapClick', playerId: p.id, index });
      return;
    }
    if (state.raceTime - p.trapClick.at < config.skills.trapSenseDelaySeconds) return;
  }
  p.trapClick = null;
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
      applyEffect(config, p, 'reversed', events, t.reverseSeconds);
      break;
    case 'confuse':
      applyEffect(config, p, 'confused', events, t.confuseSeconds);
      break;
  }
}
