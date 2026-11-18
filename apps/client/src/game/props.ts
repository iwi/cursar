import type { TrapKind } from '@cursar/game-core';
import { TRAP_STYLE } from './effects';
import { type DoorShape, shapePoints } from './doors';
import { INK, type Look, shade } from './looks';

/**
 * Sprites for the things on the map, in each look: checkpoint flags, coins,
 * boulders, patrollers, chasers, turrets and their bolts, gates, barriers,
 * doors and their keys, traps and waypoint flags. Each is a strip of frames,
 * drawn facing right (+x) where it has a facing, so the scene can turn it.
 * Doors, keys and waypoints are painted in a colour carried in the name (see
 * `doorProp`, `keyProp`, `waypointProp`).
 */
export type PropName =
  | 'flag'
  | 'coin'
  | 'boulder'
  | 'patroller'
  | 'chaser'
  | 'turret'
  | 'gate'
  | 'barrier'
  | `trap-${TrapKind}`
  | `door-${string}-${DoorShape}`
  | `key-${string}-${DoorShape}`
  | `waypoint-${string}`;

export const doorProp = (color: number, shape: DoorShape): PropName => `door-${color.toString(16)}-${shape}`;
export const keyProp = (color: number, shape: DoorShape): PropName => `key-${color.toString(16)}-${shape}`;
export const waypointProp = (color: number): PropName => `waypoint-${color.toString(16)}`;

export interface PropSheet {
  canvas: HTMLCanvasElement;
  /** Width and height of one frame, in pixels. */
  frame: number;
  frames: number;
  /** How many tiles one frame covers. */
  tiles: number;
}

/** Flag frames: two waving, then the lowered flag of a checkpoint already touched. */
export const FLAG_DONE = 2;
/** Chaser frames. */
export const CHASER_FRAME = { asleep: 0, awake: 1, dazed: 2 } as const;
/** Turret frames: the base (never turns), the head at rest and while charging (turned to its aim), and a bolt. */
export const TURRET_FRAME = { base: 0, head: 1, charging: 2, bolt: 3 } as const;
/**
 * Gate frames, one tile each, for a gate lying along x (it blocks a runner
 * crossing it in y): closed, open, and the post at either end.
 */
export const GATE_FRAME = { closed: 0, open: 1, post: 2 } as const;
/**
 * Barrier frames, one tile each, lying along x: a length of arm, the arm's
 * end (its tip to the right) and the hub it turns on.
 */
export const BARRIER_FRAME = { arm: 0, tip: 1, hub: 2 } as const;
/**
 * Door frames, one tile each, lying along x like a gate: the shut door, the
 * open doorway, and the plate with the door's shape (shut and open), drawn
 * once at its middle.
 */
export const DOOR_FRAME = { shut: 0, open: 1, plate: 2, plateOpen: 3 } as const;
/** Waypoint frames: the first, second and third waypoint (one to three notches). */
export const WAYPOINT_FRAMES = 3;

const PINK = 0xff4f9a;
const SHEETS: Record<string, { frames: number; tiles: number }> = {
  flag: { frames: 3, tiles: 1 },
  coin: { frames: 4, tiles: 1 },
  boulder: { frames: 1, tiles: 2 },
  patroller: { frames: 2, tiles: 1 },
  chaser: { frames: 3, tiles: 1 },
  turret: { frames: 4, tiles: 1 },
  gate: { frames: 3, tiles: 1 },
  trap: { frames: 1, tiles: 1 },
  barrier: { frames: 3, tiles: 1 },
  door: { frames: 4, tiles: 1 },
  key: { frames: 1, tiles: 1 },
  waypoint: { frames: WAYPOINT_FRAMES, tiles: 1 },
};

/** What a painter needs beyond the frame: the trap kind, or the colour and shape of a door, key or waypoint. */
interface Vars {
  trap: TrapKind | null;
  color: number;
  shape: DoorShape;
}

export function paintProp(look: Look, name: PropName): PropSheet {
  const [base, a, b] = name.split('-') as [string, string?, string?];
  const { frames, tiles } = SHEETS[base]!;
  const vars: Vars = {
    trap: base === 'trap' ? (a as TrapKind) : null,
    color: base === 'trap' || a === undefined ? 0xffffff : parseInt(a, 16),
    shape: (b as DoorShape | undefined) ?? 'circle',
  };
  return look === 'pixel' ? pixelProp(base, vars, frames, tiles) : inkProp(base, vars, frames, tiles);
}

const css = (c: number, alpha = 1) => `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${alpha})`;

function sheetCanvas(frame: number, frames: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = frame * frames;
  c.height = frame;
  return c;
}

// --- Pixel art (16 pixels a tile) -------------------------------------------

type Pen = {
  set: (x: number, y: number, c: number) => void;
  disc: (cx: number, cy: number, r: number, c: number) => void;
  rect: (x: number, y: number, w: number, h: number, c: number) => void;
  line: (x0: number, y0: number, x1: number, y1: number, c: number) => void;
  has: (x: number, y: number) => boolean;
  /** Fills a polygon (pixel centres inside it). */
  poly: (pts: { x: number; y: number }[], c: number) => void;
};

function pixelProp(base: string, vars: Vars, frames: number, tiles: number): PropSheet {
  const S = 16 * tiles;
  const c = sheetCanvas(S, frames);
  const g = c.getContext('2d')!;
  for (let f = 0; f < frames; f++) {
    const grid: (number | null)[][] = Array.from({ length: S }, () => new Array<number | null>(S).fill(null));
    const set = (x: number, y: number, col: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x >= 0 && y >= 0 && x < S && y < S) grid[y]![x] = col;
    };
    const pen: Pen = {
      set,
      disc: (cx, cy, r, col) => {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) set(x, y, col);
      },
      rect: (x, y, w, h, col) => {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, col);
      },
      line: (x0, y0, x1, y1, col) => {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let i = 0; i <= n; i++) set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col);
      },
      has: (x, y) => grid[y]?.[x] != null,
      poly: (pts, col) => {
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const qx = x + 0.5;
            const qy = y + 0.5;
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
              const a = pts[i]!;
              const b = pts[j]!;
              if (a.y > qy !== b.y > qy && qx < ((b.x - a.x) * (qy - a.y)) / (b.y - a.y) + a.x) inside = !inside;
            }
            if (inside) set(x, y, col);
          }
        }
      },
    };
    const outline = PIXEL_PAINT[base]!(f, pen, vars);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const col = grid[y]![x];
        const edge = outline !== null && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy!]?.[x + dx!] != null);
        if (col == null && !edge) continue;
        g.fillStyle = css(col ?? outline!);
        g.fillRect(f * S + x, y, 1, 1);
      }
    }
  }
  return { canvas: c, frame: S, frames, tiles };
}

/** Each painter draws one frame and returns its outline colour (or null for none). */
const PIXEL_PAINT: Record<string, (f: number, p: Pen, v: Vars) => number | null> = {
  flag: (f, p) => {
    p.line(4, 2, 4, 13, 0xe8e4dc);
    p.rect(3, 14, 3, 1, 0x6a6470);
    if (f === FLAG_DONE) {
      // Lowered and grey once touched.
      p.rect(5, 7, 2, 6, 0x8a93a6);
      p.rect(7, 8, 1, 4, 0x6c7486);
      return 0x1b1a24;
    }
    for (let y = 2; y <= 8; y++) {
      const len = Math.round(9 * (1 - Math.abs(y - 5) / 4.2));
      for (let i = 0; i < len; i++) {
        const x = 5 + i;
        const wave = f === 1 && x >= 9 ? 1 : f === 0 && x >= 11 ? -1 : 0;
        p.set(x, y + wave, y >= 6 ? shade(PINK, 0.78) : PINK);
      }
    }
    p.set(5, 3, shade(PINK, 1.4));
    return 0x1b1a24;
  },
  coin: (f, p) => {
    const half = [5, 3.2, 1, 3.2][f]!;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = (x + 0.5 - 8) / half;
        const dy = (y + 0.5 - 8) / 5.5;
        if (dx * dx + dy * dy > 1) continue;
        p.set(x, y, dx < -0.45 ? 0xfff0a0 : dx > 0.5 ? 0xd99a0a : 0xffc21a);
      }
    }
    if (half >= 3) p.rect(7, 6, 2, 4, 0xd99a0a);
    return 0x6a4200;
  },
  boulder: (_f, p) => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = x + 0.5 - 16;
        const dy = y + 0.5 - 16;
        if (Math.hypot(dx, dy) > 13.5) continue;
        const light = dx + dy;
        p.set(x, y, light < -8 ? 0xb8987a : light > 9 ? 0x76593e : (x * 7 + y * 13) % 11 === 0 ? 0x8a6c4e : 0x9b7b5a);
      }
    }
    // Cracks, so it can be seen to roll.
    p.line(9, 12, 14, 15, 0x4a3826);
    p.line(14, 15, 13, 20, 0x4a3826);
    p.line(19, 8, 22, 12, 0x4a3826);
    p.line(18, 21, 23, 20, 0x4a3826);
    return 0x3a2a1c;
  },
  patroller: (f, p) => {
    const L = f === 0 ? 2 : -2;
    p.rect(7 + L, 3, 2, 2, 0x4a2f6e);
    p.rect(7 - L, 11, 2, 2, 0x4a2f6e);
    p.disc(7.5, 8, 5, 0x8e5bd6);
    p.disc(6.5, 6.5, 2.2, 0xb08ae8);
    // A pointed hood towards the front, and its lamp.
    p.rect(12, 6, 1, 4, 0x8e5bd6);
    p.rect(13, 7, 1, 2, 0x8e5bd6);
    p.rect(10, 7, 2, 2, 0xffe066);
    return 0x2a1640;
  },
  chaser: (f, p) => {
    const body = [0x7a2a26, 0xd9342b, 0xa0605a][f]!;
    p.disc(7.5, 8, 6, body);
    p.disc(5.5, 8, 4, shade(body, 0.8));
    // Spines along its back.
    for (const [x, y] of [[2, 4], [1, 8], [2, 12]] as const) p.set(x, y, shade(body, 0.6));
    if (f === CHASER_FRAME.awake) {
      for (const y of [5, 10]) {
        p.rect(10, y, 2, 2, 0xfff3a0);
        p.set(11, y, 0x2b0907);
      }
      p.set(13, 7, 0xffffff);
      p.set(13, 9, 0xffffff);
    } else if (f === CHASER_FRAME.asleep) {
      p.rect(10, 6, 2, 1, 0xffb3a8);
      p.rect(10, 10, 2, 1, 0xffb3a8);
    } else {
      for (const y of [5, 10]) {
        p.set(10, y, 0xfff3a0);
        p.set(12, y + 2, 0xfff3a0);
        p.set(12, y, 0xfff3a0);
        p.set(10, y + 2, 0xfff3a0);
        p.set(11, y + 1, 0xfff3a0);
      }
    }
    return 0x2b0907;
  },
  turret: (f, p) => {
    if (f === TURRET_FRAME.base) {
      // A riveted iron plinth with chamfered corners.
      p.rect(3, 2, 10, 12, 0x3a4252);
      p.rect(2, 3, 12, 10, 0x3a4252);
      p.rect(3, 3, 10, 1, 0x4d5668);
      p.rect(3, 12, 10, 1, 0x2a303c);
      for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]] as const) p.set(x, y, 0x7a8496);
      return 0x10131a;
    }
    if (f === TURRET_FRAME.bolt) {
      p.disc(8, 8, 5.5, 0xff9f1c);
      p.disc(8, 8, 3.5, 0xffd27a);
      p.disc(7.5, 7.5, 1.8, 0xfff6dc);
      return null;
    }
    // The head: a dome with a barrel to the right, glowing while it charges.
    const hot = f === TURRET_FRAME.charging;
    p.rect(9, 6, 5, 3, hot ? 0xffb347 : 0xaab4c8);
    p.rect(14, 6, 1, 3, hot ? 0xfff0c2 : 0x5d6a80);
    p.disc(7.5, 7.5, 3.8, hot ? 0xff9f1c : 0x5d6a80);
    p.disc(6.5, 6.5, 1.6, hot ? 0xffd27a : 0x8a96ac);
    return 0x10131a;
  },
  gate: (f, p) => {
    if (f === GATE_FRAME.post) {
      p.rect(4, 4, 8, 8, 0x5a6272);
      p.rect(5, 5, 6, 1, 0x8a93a6);
      p.rect(5, 10, 6, 1, 0x3a4050);
      p.rect(7, 7, 2, 2, 0xc9d2e3);
      return 0x10131a;
    }
    if (f === GATE_FRAME.open) {
      // Only the slot the bars drop out of, with their tips showing.
      p.rect(0, 7, 16, 2, 0x15161d);
      for (const x of [1, 4, 7, 10, 13]) p.rect(x, 7, 2, 1, 0x6c7486);
      return null;
    }
    // Closed: an iron lattice between two rails.
    p.rect(0, 4, 16, 8, 0x22252f);
    for (let x = -8; x < 16; x += 8) {
      p.line(x, 11, x + 7, 4, 0xaab4c8);
      p.line(x + 1, 4, x + 8, 11, 0xaab4c8);
    }
    p.rect(0, 3, 16, 2, 0xc9d2e3);
    p.rect(0, 11, 16, 2, 0x8a93a6);
    return 0x10131a;
  },
  barrier: (f, p) => {
    if (f === BARRIER_FRAME.hub) {
      // An iron hub with a bolt in the middle.
      p.disc(8, 8, 4.6, 0x3a4252);
      p.disc(7.4, 7.4, 2.6, 0x5d6a80);
      p.rect(7, 7, 2, 2, 0xc9d2e3);
      return 0x10131a;
    }
    // A pole in hazard stripes (period 8, so lengths join up), 5 pixels thick.
    const end = f === BARRIER_FRAME.tip ? 13 : 16;
    for (let y = 6; y <= 10; y++) {
      for (let x = 0; x < end; x++) {
        const stripe = ((x + y) >> 2) & 1;
        p.set(x, y, stripe ? 0x2a2630 : 0xe8b04a);
      }
    }
    if (f === BARRIER_FRAME.tip) {
      // A rounded end with a red reflector.
      p.rect(13, 7, 1, 3, 0xe8b04a);
      p.rect(11, 7, 2, 3, 0xe0483a);
    }
    for (let x = 0; x < end; x++) p.set(x, 6, ((x + 6) >> 2) & 1 ? 0x4a4450 : 0xffd27a);
    return 0x10131a;
  },
  door: (f, p, { color, shape }) => {
    if (f === DOOR_FRAME.open) {
      // The empty doorway: its frame in the door's colour on either side.
      p.rect(0, 0, 16, 2, shade(color, 0.55));
      p.rect(0, 14, 16, 2, shade(color, 0.55));
      for (const x of [0, 5, 10, 15]) {
        p.set(x, 1, 0x10131a);
        p.set(x, 14, 0x10131a);
      }
      return null;
    }
    if (f === DOOR_FRAME.plate || f === DOOR_FRAME.plateOpen) {
      const pts = shapePoints(shape).map((q) => ({ x: 8 + q.x * 4.6, y: 8 + q.y * 4.6 }));
      if (f === DOOR_FRAME.plateOpen) {
        // Only the shape's outline, in the slot.
        p.poly(pts, color);
        p.poly(shapePoints(shape).map((q) => ({ x: 8 + q.x * 2.6, y: 8 + q.y * 2.6 })), 0x15161d);
        return 0x10131a;
      }
      // An iron plate carrying the door's shape, with a keyhole below it.
      p.disc(8, 8, 7.2, 0x2a2f3a);
      p.disc(7.4, 7.4, 6.2, 0x3a4252);
      p.poly(pts, shade(color, 1.25));
      return 0x10131a;
    }
    // Shut: boards running across the doorway, bound with two iron bands.
    for (let x = 0; x < 16; x++) {
      const board = Math.floor(x / 4);
      const seam = x % 4 === 3;
      const col = seam ? shade(color, 0.45) : shade(color, [0.95, 0.82, 1, 0.88][board]!);
      p.rect(x, 0, 1, 16, col);
    }
    for (let x = 0; x < 16; x += 4) p.set(x + 1, 2 + (x % 8 ? 9 : 4), shade(color, 1.25));
    for (const y of [3, 11]) {
      p.rect(0, y, 16, 2, 0x3a4050);
      p.rect(0, y, 16, 1, 0x5a6272);
      for (const x of [2, 6, 10, 14]) p.set(x, y + 1, 0x9aa4b8);
    }
    p.rect(0, 0, 16, 1, 0x10131a);
    p.rect(0, 15, 16, 1, 0x10131a);
    return null;
  },
  key: (_f, p, { color, shape }) => {
    // The bow in the door's shape (with a hole), a shaft and two teeth.
    const bow = shapePoints(shape);
    p.poly(bow.map((q) => ({ x: 5 + q.x * 4.4, y: 8 + q.y * 4.4 })), color);
    p.poly(bow.map((q) => ({ x: 5 + q.x * 1.6, y: 8 + q.y * 1.6 })), shade(color, 0.4));
    p.rect(9, 8, 6, 1, color);
    p.set(12, 9, color);
    p.rect(14, 9, 1, 2, color);
    p.set(3, 6, shade(color, 1.45));
    return 0x10131a;
  },
  waypoint: (f, p, { color }) => {
    // A stake with a pennant in your colour, notched once per waypoint number. Its foot is the waypoint.
    p.line(8, 1, 8, 14, 0xe8e4dc);
    p.set(8, 15, 0x8a8478);
    for (let y = 1; y <= 8; y++) {
      const len = Math.round(7 * (1 - Math.abs(y - 4.5) / 4));
      for (let i = 1; i <= len; i++) p.set(8 + i, y, y >= 5 ? shade(color, 0.75) : color);
    }
    for (let n = 0; n <= f; n++) p.rect(9 + n * 2, 4, 1, 2, 0x10131a);
    p.rect(6, 15, 5, 1, 0x3a3640);
    return 0x10131a;
  },
  trap: (_f, p, { trap }) => {
    const col = TRAP_STYLE[trap!].color;
    // A stone plate with a rim in the trap's colour.
    p.rect(2, 2, 12, 12, 0x2b2d38);
    p.rect(3, 3, 10, 1, 0x3a3d4c);
    for (let i = 3; i < 13; i++) {
      p.set(i, 2, col);
      p.set(i, 13, col);
      p.set(2, i, col);
      p.set(13, i, col);
    }
    switch (trap) {
      case 'spikes':
        // Three spikes, each a column with a two-pixel base, with gaps between.
        for (const c of [4, 7, 10]) {
          p.rect(c, 4, 1, 3, col);
          p.rect(c, 7, 2, 4, col);
        }
        break;
      case 'snare':
        for (let a = 0; a < 24; a++) p.set(7.5 + Math.cos((a / 24) * Math.PI * 2) * 3.4 - 0.5, 7.5 + Math.sin((a / 24) * Math.PI * 2) * 3.4 - 0.5, col);
        p.set(7, 7, col);
        p.set(8, 8, col);
        break;
      case 'glue':
        p.disc(6.5, 8.5, 2.6, col);
        p.disc(9.5, 6.5, 2, col);
        p.disc(10, 10.5, 1.3, col);
        break;
      case 'flash':
        p.line(4, 8, 11, 8, col);
        p.line(8, 4, 8, 11, col);
        p.line(5, 5, 10, 10, col);
        p.line(5, 10, 10, 5, col);
        break;
      case 'reverse':
        p.line(4, 6, 10, 6, col);
        p.line(9, 5, 11, 6, col);
        p.line(9, 7, 11, 6, col);
        p.line(5, 10, 11, 10, col);
        p.line(4, 10, 6, 9, col);
        p.line(4, 10, 6, 11, col);
        break;
      case 'confuse':
        for (let a = 0; a < 18; a++) p.set(7.5 + Math.cos((a / 24) * Math.PI * 2) * 3.6 - 0.5, 7.5 + Math.sin((a / 24) * Math.PI * 2) * 3.6 - 0.5, col);
        for (let a = 12; a < 30; a++) p.set(7.5 + Math.cos((a / 24) * Math.PI * 2) * 1.6 - 0.5, 7.5 + Math.sin((a / 24) * Math.PI * 2) * 1.6 - 0.5, col);
        break;
    }
    return 0x15161d;
  },
};

// --- Hand-drawn map (64 pixels a tile) ----------------------------------------

const S_INK = 64;

function inkProp(base: string, vars: Vars, frames: number, tiles: number): PropSheet {
  const S = S_INK * tiles;
  const c = sheetCanvas(S, frames);
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let f = 0; f < frames; f++) {
    g.save();
    g.beginPath();
    g.rect(f * S, 0, S, S);
    g.clip();
    g.translate(f * S, 0);
    // Drawn in tile units: one unit is one tile.
    g.scale(S_INK, S_INK);
    INK_PAINT[base]!(f, g, vars);
    g.restore();
  }
  return { canvas: c, frame: S, frames, tiles };
}

const ink = (a = 1) => css(INK, a);
const W = 1 / S_INK;

function blob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, wobble: number, seed: number): void {
  g.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = r * (1 + wobble * Math.sin(a * 3 + seed) * 0.5 + wobble * Math.sin(a * 5 + seed * 2) * 0.3);
    if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

const INK_PAINT: Record<string, (f: number, g: CanvasRenderingContext2D, v: Vars) => void> = {
  flag: (f, g) => {
    g.strokeStyle = ink();
    g.lineWidth = 3 * W;
    g.beginPath();
    g.moveTo(0.3, 0.9);
    g.lineTo(0.3, 0.1);
    g.stroke();
    g.beginPath();
    g.ellipse(0.3, 0.9, 0.12, 0.04, 0, 0, Math.PI * 2);
    g.stroke();
    if (f === FLAG_DONE) {
      g.fillStyle = 'rgba(138,147,166,0.55)';
      g.beginPath();
      g.moveTo(0.3, 0.42);
      g.quadraticCurveTo(0.42, 0.55, 0.36, 0.8);
      g.lineTo(0.3, 0.72);
      g.closePath();
      g.fill();
      g.lineWidth = 2 * W;
      g.stroke();
      return;
    }
    const wave = f === 0 ? 0.05 : -0.05;
    g.fillStyle = css(PINK, 0.7);
    g.beginPath();
    g.moveTo(0.3, 0.12);
    g.quadraticCurveTo(0.55, 0.12 + wave, 0.84, 0.26);
    g.quadraticCurveTo(0.6, 0.34 - wave, 0.3, 0.46);
    g.closePath();
    g.fill();
    g.lineWidth = 2.5 * W;
    g.stroke();
    g.strokeStyle = css(PINK, 0.9);
    g.lineWidth = 1.5 * W;
    g.beginPath();
    g.moveTo(0.36, 0.2);
    g.lineTo(0.6, 0.24);
    g.stroke();
  },
  coin: (f, g) => {
    const rx = [0.28, 0.18, 0.05, 0.18][f]!;
    g.fillStyle = 'rgba(242,192,58,0.9)';
    g.beginPath();
    g.ellipse(0.5, 0.5, rx, 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ink();
    g.lineWidth = 2.5 * W;
    g.stroke();
    if (rx > 0.1) {
      g.lineWidth = 1.5 * W;
      g.beginPath();
      g.ellipse(0.5, 0.5, rx * 0.62, 0.19, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,250,220,0.6)';
      g.beginPath();
      g.ellipse(0.5 - rx * 0.4, 0.4, rx * 0.15, 0.06, 0, 0, Math.PI * 2);
      g.fill();
    }
  },
  boulder: (_f, g) => {
    blob(g, 1, 1, 0.84, 0.06, 1.3);
    g.fillStyle = 'rgba(155,123,90,0.75)';
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = ink(0.35);
    g.lineWidth = 1.5 * W;
    for (let k = 0.9; k < 2.4; k += 0.09) {
      g.beginPath();
      g.moveTo(k, 2);
      g.lineTo(k + 0.6, 1.4);
      g.stroke();
    }
    g.restore();
    blob(g, 1, 1, 0.84, 0.06, 1.3);
    g.strokeStyle = ink();
    g.lineWidth = 3.5 * W;
    g.stroke();
    g.lineWidth = 2 * W;
    g.beginPath();
    g.moveTo(0.55, 0.8);
    g.lineTo(0.85, 0.95);
    g.lineTo(0.8, 1.25);
    g.moveTo(1.2, 0.55);
    g.lineTo(1.4, 0.8);
    g.moveTo(1.15, 1.35);
    g.lineTo(1.45, 1.3);
    g.stroke();
  },
  patroller: (f, g) => {
    const L = f === 0 ? 0.12 : -0.12;
    g.strokeStyle = ink();
    g.lineWidth = 3 * W;
    g.beginPath();
    g.moveTo(0.45, 0.32);
    g.lineTo(0.45 + L, 0.24);
    g.moveTo(0.45, 0.68);
    g.lineTo(0.45 - L, 0.76);
    g.stroke();
    // A hooded figure: round body, the hood pointing forward.
    g.fillStyle = 'rgba(142,91,214,0.75)';
    g.beginPath();
    g.arc(0.46, 0.5, 0.26, Math.PI * 0.32, Math.PI * 1.68);
    g.lineTo(0.84, 0.5);
    g.closePath();
    g.fill();
    g.lineWidth = 2.5 * W;
    g.stroke();
    g.fillStyle = 'rgba(255,224,102,0.45)';
    g.beginPath();
    g.arc(0.66, 0.5, 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,214,60,1)';
    g.beginPath();
    g.arc(0.66, 0.5, 0.055, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 1.5 * W;
    g.stroke();
  },
  chaser: (f, g) => {
    const body = [0x7a2a26, 0xd9342b, 0xa0605a][f]!;
    // A spiny blob.
    g.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const back = Math.cos(a) < -0.2 && i % 2 === 0;
      const r = back ? 0.4 : 0.32;
      if (i) g.lineTo(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r);
      else g.moveTo(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = css(body, 0.8);
    g.fill();
    g.strokeStyle = ink();
    g.lineWidth = 2.5 * W;
    g.stroke();
    for (const side of [-1, 1]) {
      const ex = 0.66;
      const ey = 0.5 + side * 0.13;
      if (f === CHASER_FRAME.awake) {
        g.fillStyle = 'rgba(255,243,160,1)';
        g.beginPath();
        g.arc(ex, ey, 0.065, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 1.5 * W;
        g.stroke();
        g.fillStyle = ink();
        g.beginPath();
        g.arc(ex + 0.025, ey, 0.025, 0, Math.PI * 2);
        g.fill();
      } else if (f === CHASER_FRAME.asleep) {
        g.lineWidth = 2 * W;
        g.beginPath();
        g.arc(ex, ey - 0.02, 0.05, 0.2 * Math.PI, 0.8 * Math.PI);
        g.stroke();
      } else {
        g.lineWidth = 2 * W;
        g.beginPath();
        g.moveTo(ex - 0.045, ey - 0.045);
        g.lineTo(ex + 0.045, ey + 0.045);
        g.moveTo(ex - 0.045, ey + 0.045);
        g.lineTo(ex + 0.045, ey - 0.045);
        g.stroke();
      }
    }
    if (f === CHASER_FRAME.awake) {
      // Teeth.
      g.lineWidth = 1.5 * W;
      g.beginPath();
      g.moveTo(0.8, 0.42);
      for (let i = 1; i <= 4; i++) g.lineTo(i % 2 ? 0.74 : 0.8, 0.42 + i * 0.04);
      g.stroke();
    }
  },
  turret: (f, g) => {
    g.strokeStyle = ink();
    if (f === TURRET_FRAME.base) {
      // A square plinth, washed grey and hatched.
      g.beginPath();
      g.roundRect(0.14, 0.14, 0.72, 0.72, 0.12);
      g.fillStyle = 'rgba(90,100,120,0.45)';
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = ink(0.3);
      g.lineWidth = 1.5 * W;
      for (let k = -0.2; k < 1.2; k += 0.1) {
        g.beginPath();
        g.moveTo(k, 1);
        g.lineTo(k + 0.6, 0.4);
        g.stroke();
      }
      g.restore();
      g.beginPath();
      g.roundRect(0.14, 0.14, 0.72, 0.72, 0.12);
      g.lineWidth = 2.5 * W;
      g.stroke();
      return;
    }
    if (f === TURRET_FRAME.bolt) {
      g.fillStyle = 'rgba(255,159,28,0.45)';
      g.beginPath();
      g.arc(0.5, 0.5, 0.36, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,240,194,1)';
      g.beginPath();
      g.arc(0.5, 0.5, 0.2, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2 * W;
      g.stroke();
      g.lineWidth = 1.5 * W;
      g.beginPath();
      for (let n = 0; n < 4; n++) {
        const a = Math.PI / 4 + (n * Math.PI) / 2;
        g.moveTo(0.5 + Math.cos(a) * 0.26, 0.5 + Math.sin(a) * 0.26);
        g.lineTo(0.5 + Math.cos(a) * 0.38, 0.5 + Math.sin(a) * 0.38);
      }
      g.stroke();
      return;
    }
    const hot = f === TURRET_FRAME.charging;
    g.lineWidth = 2 * W;
    g.fillStyle = hot ? 'rgba(255,179,71,0.9)' : 'rgba(170,180,200,0.85)';
    g.beginPath();
    g.rect(0.5, 0.43, 0.42, 0.14);
    g.fill();
    g.stroke();
    g.fillStyle = hot ? 'rgb(255,159,28)' : 'rgb(93,106,128)';
    g.beginPath();
    g.arc(0.5, 0.5, 0.19, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 2.5 * W;
    g.stroke();
    if (hot) {
      // Whirring: strokes behind the head.
      g.lineWidth = 1.5 * W;
      for (const [a0, a1] of [[2.3, 2.9], [3.4, 4.0]] as const) {
        g.beginPath();
        g.arc(0.5, 0.5, 0.28, a0, a1);
        g.stroke();
      }
    }
  },
  gate: (f, g) => {
    g.strokeStyle = ink();
    if (f === GATE_FRAME.post) {
      g.fillStyle = 'rgba(90,98,114,0.7)';
      g.beginPath();
      g.rect(0.3, 0.3, 0.4, 0.4);
      g.fill();
      g.lineWidth = 2.5 * W;
      g.stroke();
      g.lineWidth = 1.5 * W;
      g.beginPath();
      g.moveTo(0.3, 0.3);
      g.lineTo(0.7, 0.7);
      g.moveTo(0.7, 0.3);
      g.lineTo(0.3, 0.7);
      g.stroke();
      return;
    }
    if (f === GATE_FRAME.open) {
      // The line it closes along, dashed.
      g.lineWidth = 2 * W;
      g.setLineDash([0.1, 0.08]);
      g.beginPath();
      g.moveTo(0.04, 0.5);
      g.lineTo(0.96, 0.5);
      g.stroke();
      g.setLineDash([]);
      return;
    }
    // Closed: a lattice between two rails, washed steel blue.
    g.fillStyle = 'rgba(201,210,227,0.6)';
    g.fillRect(0, 0.3, 1, 0.4);
    g.save();
    g.beginPath();
    g.rect(0, 0.3, 1, 0.4);
    g.clip();
    g.lineWidth = 2 * W;
    g.beginPath();
    for (let x = -0.5; x < 1.2; x += 0.25) {
      g.moveTo(x, 0.7);
      g.lineTo(x + 0.4, 0.3);
      g.moveTo(x, 0.3);
      g.lineTo(x + 0.4, 0.7);
    }
    g.stroke();
    g.restore();
    g.lineWidth = 3 * W;
    g.beginPath();
    for (const y of [0.3, 0.7]) {
      g.moveTo(0, y);
      g.lineTo(1, y);
    }
    g.stroke();
  },
  barrier: (f, g) => {
    g.strokeStyle = ink();
    if (f === BARRIER_FRAME.hub) {
      g.fillStyle = 'rgba(90,100,120,0.85)';
      g.beginPath();
      g.arc(0.5, 0.5, 0.26, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2.5 * W;
      g.stroke();
      g.lineWidth = 2 * W;
      g.beginPath();
      g.arc(0.5, 0.5, 0.08, 0, Math.PI * 2);
      g.stroke();
      return;
    }
    // A pole washed amber, striped across in ink (period 0.25, so lengths join up), between two inked edges.
    const end = f === BARRIER_FRAME.tip ? 0.84 : 1;
    g.fillStyle = 'rgba(232,176,74,0.75)';
    g.beginPath();
    if (f === BARRIER_FRAME.tip) {
      g.moveTo(0, 0.35);
      g.lineTo(end - 0.15, 0.35);
      g.arc(end - 0.15, 0.5, 0.15, -Math.PI / 2, Math.PI / 2);
      g.lineTo(0, 0.65);
    } else g.rect(0, 0.35, 1, 0.3);
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = ink(0.7);
    g.lineWidth = 7 * W;
    g.beginPath();
    for (let x = -0.25; x < 1.1; x += 0.25) {
      g.moveTo(x, 0.65);
      g.lineTo(x + 0.18, 0.35);
    }
    g.stroke();
    g.restore();
    g.lineWidth = 2.5 * W;
    g.beginPath();
    if (f === BARRIER_FRAME.tip) {
      g.moveTo(0, 0.35);
      g.lineTo(end - 0.15, 0.35);
      g.arc(end - 0.15, 0.5, 0.15, -Math.PI / 2, Math.PI / 2);
      g.lineTo(0, 0.65);
    } else {
      g.moveTo(0, 0.35);
      g.lineTo(1, 0.35);
      g.moveTo(0, 0.65);
      g.lineTo(1, 0.65);
    }
    g.stroke();
  },
  door: (f, g, { color, shape }) => {
    g.strokeStyle = ink();
    const pts = shapePoints(shape);
    const trace = (cx: number, cy: number, r: number) => {
      g.beginPath();
      pts.forEach((q, i) => (i ? g.lineTo(cx + q.x * r, cy + q.y * r) : g.moveTo(cx + q.x * r, cy + q.y * r)));
      g.closePath();
    };
    if (f === DOOR_FRAME.open) {
      // The doorway's two jambs, dashed, in the door's colour.
      g.strokeStyle = css(color, 0.85);
      g.lineWidth = 3 * W;
      g.setLineDash([0.12, 0.08]);
      g.beginPath();
      for (const y of [0.08, 0.92]) {
        g.moveTo(0, y);
        g.lineTo(1, y);
      }
      g.stroke();
      g.setLineDash([]);
      return;
    }
    if (f === DOOR_FRAME.plate || f === DOOR_FRAME.plateOpen) {
      if (f === DOOR_FRAME.plateOpen) {
        trace(0.5, 0.5, 0.24);
        g.strokeStyle = css(color, 0.9);
        g.lineWidth = 4 * W;
        g.stroke();
        return;
      }
      // A round plate of parchment carrying the door's shape.
      g.fillStyle = 'rgba(244,236,214,0.95)';
      g.beginPath();
      g.arc(0.5, 0.5, 0.4, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2.5 * W;
      g.stroke();
      trace(0.5, 0.5, 0.26);
      g.fillStyle = css(color, 1);
      g.fill();
      g.lineWidth = 2 * W;
      g.stroke();
      return;
    }
    // Shut: boards washed in the door's colour, two bands across and inked edges.
    g.fillStyle = css(color, 0.6);
    g.fillRect(0, 0.04, 1, 0.92);
    g.lineWidth = 1.5 * W;
    g.strokeStyle = ink(0.45);
    g.beginPath();
    for (const x of [0.25, 0.5, 0.75]) {
      g.moveTo(x, 0.06);
      g.lineTo(x + 0.01, 0.94);
    }
    g.stroke();
    g.strokeStyle = ink(0.8);
    g.lineWidth = 3.5 * W;
    g.beginPath();
    for (const y of [0.24, 0.76]) {
      g.moveTo(0, y);
      g.lineTo(1, y);
    }
    g.stroke();
    g.strokeStyle = ink();
    g.lineWidth = 2.5 * W;
    g.beginPath();
    for (const y of [0.04, 0.96]) {
      g.moveTo(0, y);
      g.lineTo(1, y);
    }
    g.stroke();
  },
  key: (_f, g, { color, shape }) => {
    g.strokeStyle = ink();
    const pts = shapePoints(shape);
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(0.3 + q.x * 0.22, 0.5 + q.y * 0.22) : g.moveTo(0.3 + q.x * 0.22, 0.5 + q.y * 0.22)));
    g.closePath();
    g.fillStyle = css(color, 0.9);
    g.fill();
    g.lineWidth = 2.5 * W;
    g.stroke();
    g.beginPath();
    g.arc(0.3, 0.5, 0.06, 0, Math.PI * 2);
    g.stroke();
    // Shaft and teeth: the colour under an inked line.
    g.strokeStyle = css(color, 1);
    g.lineWidth = 6 * W;
    g.beginPath();
    g.moveTo(0.5, 0.5);
    g.lineTo(0.92, 0.5);
    g.moveTo(0.72, 0.5);
    g.lineTo(0.72, 0.64);
    g.moveTo(0.86, 0.5);
    g.lineTo(0.86, 0.68);
    g.stroke();
    g.strokeStyle = ink();
    g.lineWidth = 2 * W;
    g.stroke();
  },
  waypoint: (f, g, { color }) => {
    // A stake with a pennant in your colour, notched once per waypoint number. Its foot is the waypoint.
    g.strokeStyle = ink();
    g.lineWidth = 3 * W;
    g.beginPath();
    g.moveTo(0.5, 0.92);
    g.lineTo(0.5, 0.08);
    g.stroke();
    g.lineWidth = 2 * W;
    g.beginPath();
    g.moveTo(0.38, 0.92);
    g.lineTo(0.62, 0.92);
    g.stroke();
    g.fillStyle = css(color, 0.8);
    g.beginPath();
    g.moveTo(0.5, 0.08);
    g.lineTo(0.94, 0.27);
    g.lineTo(0.5, 0.46);
    g.closePath();
    g.fill();
    g.lineWidth = 2.5 * W;
    g.stroke();
    g.lineWidth = 3 * W;
    g.beginPath();
    for (let n = 0; n <= f; n++) {
      g.moveTo(0.58 + n * 0.09, 0.22);
      g.lineTo(0.58 + n * 0.09, 0.32);
    }
    g.stroke();
  },
  trap: (_f, g, { trap }) => {
    const col = TRAP_STYLE[trap!].color;
    // A plate drawn on the ground, washed in the trap's colour, with its sign in ink.
    g.fillStyle = css(col === 0xffffff ? 0xb8b0a0 : col, 0.35);
    g.strokeStyle = ink(0.85);
    g.lineWidth = 2 * W;
    g.beginPath();
    g.roundRect(0.12, 0.12, 0.76, 0.76, 0.12);
    g.fill();
    g.stroke();
    g.lineWidth = 3 * W;
    g.fillStyle = ink(0.85);
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    switch (trap) {
      case 'spikes':
        for (const ox of [0.3, 0.5, 0.7]) {
          g.beginPath();
          g.moveTo(ox - 0.07, 0.68);
          g.lineTo(ox, 0.32);
          g.lineTo(ox + 0.07, 0.68);
          g.closePath();
          g.fill();
        }
        break;
      case 'snare':
        g.beginPath();
        g.arc(0.5, 0.5, 0.2, 0, Math.PI * 2);
        g.stroke();
        for (let n = 0; n < 6; n++) {
          const a = (n * Math.PI) / 3;
          line(0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2, 0.5 + Math.cos(a) * 0.1, 0.5 + Math.sin(a) * 0.1);
        }
        break;
      case 'glue':
        for (const [x, y, r] of [[0.42, 0.55, 0.14], [0.6, 0.42, 0.11], [0.63, 0.66, 0.07]] as const) {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.stroke();
        }
        break;
      case 'flash':
        line(0.26, 0.5, 0.74, 0.5);
        line(0.5, 0.26, 0.5, 0.74);
        line(0.33, 0.33, 0.67, 0.67);
        line(0.33, 0.67, 0.67, 0.33);
        break;
      case 'reverse':
        line(0.28, 0.4, 0.7, 0.4);
        line(0.62, 0.33, 0.72, 0.4);
        line(0.62, 0.47, 0.72, 0.4);
        line(0.3, 0.62, 0.72, 0.62);
        line(0.38, 0.55, 0.28, 0.62);
        line(0.38, 0.69, 0.28, 0.62);
        break;
      case 'confuse':
        g.beginPath();
        g.arc(0.5, 0.5, 0.22, 0, Math.PI * 1.5);
        g.stroke();
        g.beginPath();
        g.arc(0.5, 0.5, 0.1, Math.PI, Math.PI * 2.6);
        g.stroke();
        break;
    }
  },
};
