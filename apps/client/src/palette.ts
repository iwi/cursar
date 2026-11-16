import { PLAYER_COLORS } from '@cursar/game-core';

/**
 * The colour-blind friendly palette option. Runner, plaza and door colours
 * switch to colours that stay apart with the common kinds of colour blindness
 * (after Okabe and Ito), and differ in lightness too. Only the drawing
 * changes: a runner's colour is still sent and stored as the usual one.
 */
let safe = false;

export function setColourSafe(on: boolean): void {
  safe = on;
}

export function colourSafe(): boolean {
  return safe;
}

/** In the order of `PLAYER_COLORS`. */
const SAFE_RUNNERS = [0xe69f00, 0x56b4e9, 0xd55e00, 0x009e73, 0xcc79a7, 0xffffff, 0xf0e442, 0x0072b2];

/** How a runner's colour is drawn. */
export function runnerColor(color: number): number {
  if (!safe) return color;
  const i = PLAYER_COLORS.indexOf(color);
  return i >= 0 ? SAFE_RUNNERS[i]! : color;
}

/** Plaza colours with the option on (the usual ones are in the race scene). */
export const SAFE_PLAZAS = [0x56b4e9, 0xf0e442, 0x009e73, 0xe69f00, 0xcc79a7, 0xffffff, 0x0072b2, 0xd55e00, 0x9a9a9a, 0x8c5a2b];

/** Door colours with the option on, in door order. */
export const SAFE_DOORS = [0x56b4e9, 0xe69f00, 0x009e73, 0xcc79a7];
