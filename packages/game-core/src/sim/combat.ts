import { goHome } from './enemies';
import { knock } from './obstacles';
import type { GameEvent, PlayerInput, PlayerState, RaceState } from './types';

/**
 * Starts a shove if the runner pressed the key, the start's grace time is
 * over, they are off cooldown, not stunned and have the stamina: spends it and reports a `shove`. Runs in
 * `stepPlayer`, so a page predicts its own shove; what it hits is decided
 * by `resolveShoves`, on the server only.
 */
export function startShove(state: RaceState, p: PlayerState, input: PlayerInput, dt: number, events: GameEvent[]): void {
  const cfg = state.config.combat;
  p.shoveCooldown = Math.max(0, p.shoveCooldown - dt);
  p.shoveTime = Math.max(0, p.shoveTime - dt);
  if (!input.shove || p.shoveCooldown > 0 || p.finished || p.stamina < cfg.staminaCost) return;
  // Not in the first seconds of the race, while everyone leaves the start together.
  if (state.raceTime < cfg.startGraceSeconds) return;
  if (p.effects.some((e) => e.kind === 'stun')) return;
  p.stamina -= cfg.staminaCost;
  p.regenDelay = state.config.sprint.regenDelay;
  p.shoveCooldown = cfg.cooldownSeconds;
  p.shoveTime = cfg.activeSeconds;
  events.push({ type: 'shove', playerId: p.id });
}

/** Whether (x, y) with radius `r` is inside the shove's cone in front of `p`. */
function inCone(state: RaceState, p: PlayerState, x: number, y: number, r: number): { nx: number; ny: number } | null {
  const { combat, player } = state.config;
  const dx = x - p.x;
  const dy = y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > player.radius + r + combat.reach) return null;
  if (d < 1e-6) return { nx: Math.cos(p.facing), ny: Math.sin(p.facing) };
  let diff = Math.atan2(dy, dx) - p.facing;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  // Something overlapping you is hit whatever the angle.
  if (Math.abs(diff) > combat.arc && d > player.radius + r) return null;
  return { nx: dx / d, ny: dy / d };
}

/**
 * What the shoves under way hit this tick. A shove stays active for
 * `activeSeconds`, hitting whatever enters its cone: rivals are knocked back
 * and briefly stunned (no heart; not during their safe time or just after a
 * knock, which also stops one shove hitting twice), awake chasers are dazed
 * and then go home to rest. Patrollers and turrets cannot be shoved.
 */
export function resolveShoves(state: RaceState, events: GameEvent[]): void {
  const { config } = state;
  for (const p of state.players) {
    if (p.finished || p.shoveTime <= 0) continue;
    for (const rival of state.players) {
      if (rival === p || rival.finished || rival.safeTime > 0 || rival.hitGuard > 0) continue;
      const n = inCone(state, p, rival.x, rival.y, config.player.radius);
      if (!n) continue;
      events.push({ type: 'shoveHit', playerId: p.id, target: 'rival' });
      events.push({ type: 'shoved', playerId: rival.id, by: p.id });
      knock(state, rival, rival.x, rival.y, n.nx, n.ny, 0, config.combat.rivalStunSeconds, events, config.combat.knockSpeed);
    }
    state.foes.forEach((foe) => {
      if (!foe || foe.kind !== 'chaser' || foe.stun > 0 || foe.mode === 'sleep') return;
      if (!inCone(state, p, foe.x, foe.y, config.enemies.chaser.radius)) return;
      events.push({ type: 'shoveHit', playerId: p.id, target: 'chaser' });
      foe.stun = config.combat.chaserStunSeconds;
      goHome(foe, config.enemies.chaser.restSeconds);
    });
  }
}
