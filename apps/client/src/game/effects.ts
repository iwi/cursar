import type { EffectKind } from '@cursar/game-core';

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
