import type { GameConfig } from '../config';
import { clearEffects } from './effects';
import type { GameEvent, PlayerState } from './types';

/**
 * Takes hearts from a runner (hazards, traps and enemies call this). Nothing
 * happens during the safe time after a respawn. Running out of hearts sends
 * the runner straight back to their respawn point with full health; the
 * checkpoints they have touched still count.
 *
 * Returns whether the damage was taken.
 */
export function damage(config: GameConfig, p: PlayerState, amount: number, events: GameEvent[]): boolean {
  if (p.finished || p.safeTime > 0 || !(amount > 0)) return false;
  p.health = Math.max(0, p.health - amount);
  events.push({ type: 'hurt', playerId: p.id, amount, health: p.health });
  if (p.health === 0) respawn(config, p, events);
  return true;
}

/** Puts the runner back at their respawn point with full health, effects cleared and a short safe time. */
export function respawn(config: GameConfig, p: PlayerState, events: GameEvent[]): void {
  p.x = p.respawnX;
  p.y = p.respawnY;
  p.vx = 0;
  p.vy = 0;
  p.sprinting = false;
  p.health = config.health.hearts;
  p.safeTime = config.health.respawnSafeSeconds;
  clearEffects(p);
  events.push({ type: 'respawn', playerId: p.id, x: p.x, y: p.y });
}
