import type { EffectKind, EnemyKind, TrapKind } from '@cursar/game-core';

/** How each effect is named and coloured, shared by the race drawing and the HUD. */
export const EFFECT_STYLE: Record<EffectKind, { label: string; color: number }> = {
  slow: { label: 'Slowed', color: 0x5b8cff },
  haste: { label: 'Haste', color: 0xffd23f },
  stun: { label: 'Stunned', color: 0xffffff },
  reversed: { label: 'Reversed', color: 0xff5a5f },
  confused: { label: 'Confused', color: 0xc77dff },
  blind: { label: 'Blinded', color: 0x9aa3b5 },
};

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** How each trap is named and coloured. */
export const TRAP_STYLE: Record<TrapKind, { label: string; color: number }> = {
  spikes: { label: 'Spikes', color: 0xff5a6e },
  snare: { label: 'Snare', color: 0xffffff },
  glue: { label: 'Glue', color: 0x5b8cff },
  flash: { label: 'Flash', color: 0xfff3a0 },
  reverse: { label: 'Trick tile', color: 0xff5a5f },
  confuse: { label: 'Trick tile', color: 0xc77dff },
};

/** How each enemy is named (for the notice when one gets you). */
export const ENEMY_LABEL: Record<EnemyKind, string> = {
  patroller: 'Patroller',
  chaser: 'Caught by a chaser',
  turret: 'Turret bolt',
};
