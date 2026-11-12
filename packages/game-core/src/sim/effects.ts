import type { GameConfig } from '../config';
import type { EffectKind, GameEvent, PlayerInput, PlayerState } from './types';

export const EFFECT_KINDS: readonly EffectKind[] = ['slow', 'haste', 'stun', 'reversed', 'confused', 'blind'];

/** Effects that take control away. They come one at a time, with a guard after each. */
export const LOSS_OF_CONTROL: ReadonlySet<EffectKind> = new Set<EffectKind>(['stun', 'reversed', 'confused']);

export function hasEffect(p: PlayerState, kind: EffectKind): boolean {
  return p.effects.some((e) => e.kind === kind);
}

function losingControl(p: PlayerState): boolean {
  return p.effects.some((e) => LOSS_OF_CONTROL.has(e.kind));
}

/**
 * Starts an effect on a runner, for `seconds` or the kind's usual length.
 *
 * - The same kind again does not stack: the longer of the two times is kept.
 * - Different kinds run side by side (slowed and blinded at once is fine).
 * - Loss of control (stun, reversed, confused) comes one at a time: none can
 *   start while another is running, nor during the guard after one ends, so a
 *   row of traps cannot keep a runner helpless.
 *
 * Returns whether the effect took hold.
 */
export function applyEffect(
  config: GameConfig,
  p: PlayerState,
  kind: EffectKind,
  events: GameEvent[],
  seconds: number = config.effects[kind].seconds,
): boolean {
  if (p.finished || !(seconds > 0)) return false;
  if (LOSS_OF_CONTROL.has(kind) && (p.controlGuard > 0 || losingControl(p))) {
    events.push({ type: 'effectResisted', playerId: p.id, kind });
    return false;
  }
  const running = p.effects.find((e) => e.kind === kind);
  if (running) {
    if (seconds > running.time) {
      running.time = seconds;
      running.total = seconds;
    }
  } else {
    p.effects.push({ kind, time: seconds, total: seconds });
  }
  events.push({ type: 'effect', playerId: p.id, kind, seconds });
  return true;
}

/** Counts effects down by one tick and ends the ones that have run out. */
export function tickEffects(config: GameConfig, p: PlayerState, dt: number, events: GameEvent[]): void {
  p.controlGuard = Math.max(0, p.controlGuard - dt);
  if (p.effects.length === 0) return;
  const hadControlLoss = losingControl(p);
  for (const e of p.effects) e.time -= dt;
  const ended = p.effects.filter((e) => e.time <= 1e-9);
  if (ended.length === 0) return;
  p.effects = p.effects.filter((e) => e.time > 1e-9);
  for (const e of ended) events.push({ type: 'effectEnd', playerId: p.id, kind: e.kind });
  if (hadControlLoss && !losingControl(p)) p.controlGuard = config.effects.controlGuardSeconds;
}

/** Removes every effect, for example when a runner finishes. */
export function clearEffects(p: PlayerState): void {
  p.effects = [];
  p.controlGuard = 0;
}

/** What the runner's controls actually do while effects are running. */
export function controlledInput(p: PlayerState, input: PlayerInput): PlayerInput {
  if (p.effects.length === 0) return input;
  if (hasEffect(p, 'stun')) return { ...input, mx: 0, my: 0, sprint: false };
  let { mx, my } = input;
  // A quarter turn clockwise on screen (+y is down): right becomes down, up becomes right.
  if (hasEffect(p, 'confused')) [mx, my] = [-my, mx];
  if (hasEffect(p, 'reversed')) [mx, my] = [-mx, -my];
  return mx === input.mx && my === input.my ? input : { ...input, mx, my };
}

/** Multiplier on top speed from slow and haste (they combine). */
export function effectSpeedMul(config: GameConfig, p: PlayerState): number {
  let mul = 1;
  for (const e of p.effects) {
    if (e.kind === 'slow') mul *= config.effects.slow.speedMul;
    else if (e.kind === 'haste') mul *= config.effects.haste.speedMul;
  }
  return mul;
}

/** The runner's vision right now: smaller while blinded. Used for drawing and by the server alike. */
export function effectiveVision(config: GameConfig, p: PlayerState): GameConfig['vision'] {
  if (!hasEffect(p, 'blind')) return config.vision;
  const mul = config.effects.blind.visionMul;
  const { ahead, side, back, memorySeconds } = config.vision;
  return { ahead: ahead * mul, side: side * mul, back: back * mul, memorySeconds };
}
