import { SAFE_DOORS, colourSafe } from '../palette';

/**
 * Each door and its key share a colour, a name (for notices) and a shape, so
 * they can be matched without telling the colours apart.
 */
export type DoorShape = 'circle' | 'square' | 'triangle' | 'diamond';

export const DOOR_STYLE = [
  { color: 0x4dabff, name: 'blue', shape: 'circle' },
  { color: 0xff7a3d, name: 'orange', shape: 'square' },
  { color: 0x7ee08a, name: 'green', shape: 'triangle' },
  { color: 0xd98cff, name: 'violet', shape: 'diamond' },
] as const satisfies readonly { color: number; name: string; shape: DoorShape }[];

/** A door's colour, name and shape (its colour from the colour-blind friendly palette when that is on). */
export function doorStyle(index: number): { color: number; name: string; shape: DoorShape } {
  const style = DOOR_STYLE[index % DOOR_STYLE.length]!;
  return colourSafe() ? { ...style, color: SAFE_DOORS[index % SAFE_DOORS.length]! } : style;
}

/** How notices name a key or door: "the blue circle key". */
export const doorName = (index: number) => `${doorStyle(index).name} ${doorStyle(index).shape}`;

/** The shape as points round (0, 0), radius 1, for drawing. */
export function shapePoints(shape: DoorShape): { x: number; y: number }[] {
  const ring = (n: number, turn: number) => Array.from({ length: n }, (_, i) => ({ x: Math.cos(turn + (i / n) * Math.PI * 2), y: Math.sin(turn + (i / n) * Math.PI * 2) }));
  switch (shape) {
    case 'circle':
      return ring(20, 0);
    case 'square':
      return ring(4, Math.PI / 4).map((p) => ({ x: p.x * 0.9, y: p.y * 0.9 }));
    case 'triangle':
      return ring(3, -Math.PI / 2).map((p) => ({ x: p.x, y: p.y + 0.15 }));
    case 'diamond':
      return ring(4, 0).map((p) => ({ x: p.x * 0.8, y: p.y }));
  }
}
