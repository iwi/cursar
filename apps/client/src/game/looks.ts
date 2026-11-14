import { type GameMap, type Landmark, Tile } from '@cursar/game-core';
import type Phaser from 'phaser';

/**
 * How the race is drawn. Both looks paint the map once onto a canvas (used as
 * a texture by the race scene); runners are sprites (pixel art) or drawn each
 * frame (the hand-drawn map). Everything here is drawing only.
 */
export type Look = 'pixel' | 'map';

export const LOOKS: readonly { id: Look; label: string; description: string }[] = [
  { id: 'pixel', label: 'Pixel art', description: 'Pixel-art runners on stone paving, with brick walls.' },
  { id: 'map', label: 'Hand-drawn map', description: 'Ink and watercolour on paper, as if you were running across the map itself.' },
];

export function isLook(value: unknown): value is Look {
  return LOOKS.some((look) => look.id === value);
}

/** Colours the race scene needs from each look. */
export const LOOK_THEME: Record<Look, { background: number; fog: number }> = {
  pixel: { background: 0x0d0c16, fog: 0x0d0c16 },
  map: { background: 0x2b2015, fog: 0x2b2015 },
};

/** Pixels per tile in the pixel-art textures (shown at two screen pixels each at zoom 1). */
export const PIXEL_TILE = 16;

// --- Shared helpers ---------------------------------------------------------

function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const css = (c: number, alpha = 1) => `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${alpha})`;

/** Lightens (f > 1) or darkens (f < 1) a colour. */
export function shade(c: number, f: number): number {
  const ch = [c >> 16, (c >> 8) & 255, c & 255].map((v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
  return (ch[0]! << 16) | (ch[1]! << 8) | ch[2]!;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function tileAt(map: GameMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Tile.Wall;
  return map.tiles[y * map.width + x]!;
}

/** Wall outlines, merged into straight runs: [x1, y1, x2, y2] in tiles. */
function wallRuns(map: GameMap): [number, number, number, number][] {
  const wall = (x: number, y: number) => tileAt(map, x, y) === Tile.Wall;
  const runs: [number, number, number, number][] = [];
  for (let y = 1; y < map.height; y++) {
    let s = -1;
    for (let x = 0; x <= map.width; x++) {
      const on = x < map.width && wall(x, y - 1) !== wall(x, y);
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        runs.push([s, y, x, y]);
        s = -1;
      }
    }
  }
  for (let x = 1; x < map.width; x++) {
    let s = -1;
    for (let y = 0; y <= map.height; y++) {
      const on = y < map.height && wall(x - 1, y) !== wall(x, y);
      if (on && s < 0) s = y;
      if (!on && s >= 0) {
        runs.push([x, s, x, y]);
        s = -1;
      }
    }
  }
  return runs;
}

/** Inside test for a landmark's shape, in units of the shape's size (about -1..1). */
function landmarkShape(kind: Landmark['kind']): (x: number, y: number) => boolean {
  switch (kind) {
    case 'fountain':
      return (x, y) => Math.hypot(x, y) < 0.5 || (Math.hypot(x, y) > 0.8 && Math.hypot(x, y) < 1);
    case 'statue':
      return (x, y) => Math.abs(x) < 0.72 && Math.abs(y) < 0.72;
    case 'tree':
      return (x, y) => Math.hypot(x + 0.4, y - 0.2) < 0.6 || Math.hypot(x - 0.4, y - 0.2) < 0.6 || Math.hypot(x, y + 0.4) < 0.65;
    case 'crystal':
      return (x, y) => Math.abs(x) / 0.7 + Math.abs(y) / 1.1 < 1;
    case 'brazier':
      return (x, y) => y < 0.7 && y > -1 && Math.abs(x) < ((y + 1) / 1.7) * 0.9;
    case 'obelisk':
      return (x, y) => (Math.abs(x) < 0.3 && Math.abs(y) < 1.1) || (Math.abs(x) < 0.9 && Math.abs(y) < 0.3);
  }
}

// --- Pixel art ----------------------------------------------------------------

const P = {
  outline: 0x1b1a24,
  floorA: 0x4e5c49,
  floorB: 0x55644f,
  floorDark: 0x404c3c,
  floorLight: 0x63745a,
  shadow: 0x37423a,
  wallTop: 0x968e78,
  wallTopHi: 0xb7ad93,
  wallTopDark: 0x847c67,
  wallSide: 0x6f6857,
  wallFront: 0x5c5545,
  wallFrontDark: 0x463f33,
  ice: 0x8ccfe0,
  iceHi: 0xe6f8fc,
  iceDark: 0x5aa3bf,
  mud: 0x6d4b32,
  mudDark: 0x553a29,
  mudHi: 0x87613f,
  start: 0x8a9a7c,
  skin: 0xe1a77d,
  hair: 0x3a2921,
  pants: 0x2c3350,
  shoe: 0x1f2233,
};

/** The whole map as pixel art, PIXEL_TILE pixels per tile. */
export function paintPixelGround(map: GameMap): HTMLCanvasElement {
  const T = PIXEL_TILE;
  const c = canvas(map.width * T, map.height * T);
  const g = c.getContext('2d')!;
  const px = (col: number, x: number, y: number, w = 1, h = 1) => {
    g.fillStyle = css(col);
    g.fillRect(x, y, w, h);
  };
  const at = (x: number, y: number) => tileAt(map, x, y);
  const wall = (x: number, y: number) => at(x, y) === Tile.Wall;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const code = at(x, y);
      const X = x * T;
      const Y = y * T;
      if (code === Tile.Wall) {
        px(P.wallTop, X, Y, T, T);
        for (let i = 0; i < 5; i++) px(P.wallTopDark, X + Math.floor(hash(x, y, i) * 15), Y + Math.floor(hash(x, y, i + 9) * 9));
        if (!wall(x, y - 1)) px(P.wallTopHi, X, Y, T, 1);
        if (!wall(x - 1, y)) px(P.wallSide, X, Y, 1, T);
        if (!wall(x + 1, y)) px(P.wallSide, X + 15, Y, 1, T);
        if (!wall(x, y + 1)) {
          // The wall's front face, in brick.
          px(P.outline, X, Y + 9, T, 1);
          px(P.wallFront, X, Y + 10, T, 6);
          px(P.wallFrontDark, X, Y + 12, T, 1);
          px(P.wallFrontDark, X, Y + 15, T, 1);
          const o = (x % 2) * 4;
          for (let bx = o; bx < 16; bx += 8) {
            px(P.wallFrontDark, X + bx, Y + 10, 1, 2);
            px(P.wallFrontDark, X + ((bx + 4) % 16), Y + 13, 1, 2);
          }
        }
        continue;
      }
      if (code === Tile.Ice) {
        px(P.ice, X, Y, T, T);
        if (at(x, y - 1) !== Tile.Ice) px(P.iceDark, X, Y, T, 1);
        if (at(x, y + 1) !== Tile.Ice) px(P.iceDark, X, Y + 15, T, 1);
        if (at(x - 1, y) !== Tile.Ice) px(P.iceDark, X, Y, 1, T);
        if (at(x + 1, y) !== Tile.Ice) px(P.iceDark, X + 15, Y, 1, T);
        const hx = 3 + Math.floor(hash(x, y, 1) * 8);
        const hy = 5 + Math.floor(hash(x, y, 2) * 8);
        for (let i = 0; i < 3; i++) px(P.iceHi, X + hx + i, Y + hy - i);
        px(P.iceHi, X + ((hx + 6) % 13) + 1, Y + ((hy + 5) % 12) + 2);
      } else if (code === Tile.Mud) {
        px(P.mud, X, Y, T, T);
        for (let i = 0; i < 3; i++) px(P.mudDark, X + 1 + Math.floor(hash(x, y, i) * 13), Y + 1 + Math.floor(hash(x, y, i + 4) * 13), 2, 2);
        for (let i = 0; i < 2; i++) px(P.mudHi, X + Math.floor(hash(x, y, i + 8) * 15), Y + Math.floor(hash(x, y, i + 12) * 15));
        if (at(x, y - 1) !== Tile.Mud) px(P.mudDark, X, Y, T, 1);
        if (at(x, y + 1) !== Tile.Mud) px(P.mudDark, X, Y + 15, T, 1);
      } else {
        px(hash(x, y) < 0.5 ? P.floorA : P.floorB, X, Y, T, T);
        px(P.floorDark, X + 15, Y, 1, T);
        px(P.floorDark, X, Y + 15, T, 1);
        if (hash(x, y, 3) < 0.45) px(P.floorDark, X + 4 + Math.floor(hash(x, y, 4) * 8), Y, 1, 15);
        for (let i = 0; i < 3; i++) px(i ? P.floorDark : P.floorLight, X + Math.floor(hash(x, y, i + 20) * 14), Y + Math.floor(hash(x, y, i + 30) * 14));
      }
      // Walls cast a short shadow onto the ground below them.
      if (wall(x, y - 1)) {
        px(P.shadow, X, Y, T, 3);
        for (let i = 0; i < 16; i += 2) px(P.shadow, X + i, Y + 3);
      }
    }
  }
  // Start spots: a ring of pale stones.
  for (const s of map.startPositions) {
    const cx = s.x * T;
    const cy = s.y * T;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      px(P.start, Math.round(cx + Math.cos(a) * 5.5 - 0.5), Math.round(cy + Math.sin(a) * 5.5 - 0.5));
    }
  }
  // Finish: a chequered floor with a dark rim.
  const f = map.finish;
  for (let y = f.y * T; y < (f.y + f.h) * T; y++) {
    for (let x = f.x * T; x < (f.x + f.w) * T; x++) px(((x >> 2) + (y >> 2)) & 1 ? 0xeeeeea : 0x1b1d24, x, y);
  }
  g.strokeStyle = css(0x7ee08a);
  g.lineWidth = 1;
  g.strokeRect(f.x * T + 0.5, f.y * T + 0.5, f.w * T - 1, f.h * T - 1);
  return c;
}

/** A landmark as a mosaic set into the paving: 5 tiles across, centred. */
export function paintPixelLandmark(mark: Landmark, tint: number): HTMLCanvasElement {
  const T = PIXEL_TILE;
  const size = 5 * T;
  const c = canvas(size, size);
  const g = c.getContext('2d')!;
  const mid = size / 2;
  const inside = landmarkShape(mark.kind);
  const unit = T * 0.8;
  const fill = new Map<number, number>();
  const shapeAt = (x: number, y: number) => inside((x + 0.5 - mid) / unit, (y + 0.5 - mid) / unit);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - mid, y + 0.5 - mid);
      let col: number | null = null;
      if (d < 34) col = ((x >> 2) + (y >> 2)) & 1 ? shade(tint, 0.42) : shade(tint, 0.36);
      if (d >= 26 && d < 34 && ((x >> 2) + (y >> 2)) & 1) col = shade(tint, 0.6);
      if (d >= 21 && d < 23) col = shade(tint, 0.75);
      if (shapeAt(x, y)) col = shade(tint, 1.08);
      else if (shapeAt(x + 1, y) || shapeAt(x - 1, y) || shapeAt(x, y + 1) || shapeAt(x, y - 1)) col = shade(tint, 0.25);
      if (col !== null) fill.set(y * size + x, col);
    }
  }
  for (const [i, col] of fill) {
    g.fillStyle = css(col, 0.9);
    g.fillRect(i % size, Math.floor(i / size), 1, 1);
  }
  return c;
}

/**
 * A runner as five 16-pixel frames facing right: four of the run cycle, then
 * standing. The shirt carries the player's colour.
 */
export function paintPixelRunner(shirt: number): HTMLCanvasElement {
  const S = 16;
  const c = canvas(S * 5, S);
  const g = c.getContext('2d')!;
  const dark = shade(shirt, 0.72);
  for (let frame = 0; frame < 5; frame++) {
    const grid: (number | null)[][] = Array.from({ length: S }, () => new Array<number | null>(S).fill(null));
    const set = (x: number, y: number, col: number) => {
      if (x >= 0 && y >= 0 && x < S && y < S) grid[y]![x] = col;
    };
    const L = frame < 4 ? [2, 0, -2, 0][frame]! : 0;
    for (let x = Math.min(7, 7 + L); x <= Math.max(8, 8 + L); x++) {
      set(x, 6, P.pants);
      set(x, 7, P.pants);
    }
    for (let x = Math.min(7, 7 - L); x <= Math.max(8, 8 - L); x++) {
      set(x, 9, P.pants);
      set(x, 10, P.pants);
    }
    if (L) {
      const front = 8 + L + (L > 0 ? 1 : -1);
      const back = 8 - L + (L > 0 ? -2 : 1);
      set(front, 6, P.shoe);
      set(front, 7, P.shoe);
      set(back, 9, P.shoe);
      set(back, 10, P.shoe);
    }
    set(7 - L, 3, P.skin);
    set(8 - L, 3, P.skin);
    set(7 + L, 12, P.skin);
    set(8 + L, 12, P.skin);
    for (let y = 4; y <= 11; y++) {
      for (let x = 6; x <= 9; x++) {
        if ((y === 4 || y === 11) && (x === 6 || x === 9)) continue;
        set(x, y, x === 6 ? dark : shirt);
      }
    }
    for (let y = 6; y <= 9; y++) {
      for (let x = 7; x <= 10; x++) {
        if ((y === 6 || y === 9) && (x === 7 || x === 10)) continue;
        set(x, y, P.hair);
      }
    }
    set(10, 7, P.skin);
    set(10, 8, P.skin);
    set(8, 6, shade(P.hair, 1.35));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const col = grid[y]![x];
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy!]?.[x + dx!] != null);
        if (col == null && !edge) continue;
        g.fillStyle = css(col ?? P.outline);
        g.fillRect(frame * S + x, y, 1, 1);
      }
    }
  }
  return c;
}

// --- Hand-drawn map ---------------------------------------------------------

export const INK = 0x33241a;
export const RED_INK = 0xa3332a;
const PAPER = 0xe9ddc1;

/** Pixels per tile for the hand-drawn textures: sharp when zoomed in, within texture limits. */
export function inkTileSize(map: GameMap): number {
  return Math.max(16, Math.min(64, Math.floor(4096 / Math.max(map.width, map.height))));
}

function sketch(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, rnd: () => number, amp: number): void {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const o = amp * (0.5 + rnd());
  x1 -= ux * o;
  y1 -= uy * o;
  x2 += ux * o;
  y2 += uy * o;
  const n = Math.max(2, Math.ceil(len / (amp * 14)));
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const j = (rnd() - 0.5) * 2 * amp;
    const x = x1 + (x2 - x1) * f - uy * j;
    const y = y1 + (y2 - y1) * f + ux * j;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
}

function sketchCircle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rnd: () => number, amp: number): void {
  g.beginPath();
  const n = 36;
  const start = rnd() * Math.PI * 2;
  for (let i = 0; i <= n + 2; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const rr = r + (rnd() - 0.5) * 2 * amp;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
}

/** The whole map in ink and watercolour on paper, `T` pixels per tile. */
export function paintInkGround(map: GameMap, T: number): HTMLCanvasElement {
  const w = map.width * T;
  const h = map.height * T;
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const rnd = rng(map.width * 7919 + map.height);
  // Paper: stains, specks and darker edges.
  g.fillStyle = css(PAPER);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < (map.width * map.height) / 30; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (1 + rnd() * 3) * T;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(150,110,60,0.07)');
    gr.addColorStop(1, 'rgba(150,110,60,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < (w * h) / 900; i++) {
    g.fillStyle = `rgba(90,60,30,${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(110,70,30,0)');
  v.addColorStop(1, 'rgba(110,70,30,0.25)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);

  g.lineCap = 'round';
  g.lineJoin = 'round';
  const tilesOf = (code: number) => {
    const list: [number, number][] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.tiles[y * map.width + x] === code) list.push([x, y]);
    return list;
  };
  const union = (list: [number, number][]) => {
    g.beginPath();
    for (const [x, y] of list) g.rect(x * T - 0.5, y * T - 0.5, T + 1, T + 1);
  };
  const ice = tilesOf(Tile.Ice);
  const mud = tilesOf(Tile.Mud);
  const walls = tilesOf(Tile.Wall);

  union(ice);
  g.fillStyle = 'rgba(120,175,205,0.45)';
  g.fill();
  g.strokeStyle = 'rgba(43,79,140,0.55)';
  g.lineWidth = T * 0.03;
  for (const [x, y] of ice) {
    for (let i = 0; i < 2; i++) {
      const sx = (x + 0.2 + rnd() * 0.4) * T;
      const sy = (y + 0.25 + rnd() * 0.5) * T;
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + T * 0.12, sy - T * 0.08, sx + T * 0.24, sy);
      g.quadraticCurveTo(sx + T * 0.34, sy + T * 0.08, sx + T * 0.44, sy);
      g.stroke();
    }
  }
  union(mud);
  g.fillStyle = 'rgba(125,90,50,0.42)';
  g.fill();
  g.fillStyle = 'rgba(51,36,26,0.55)';
  for (const [x, y] of mud) {
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.arc((x + rnd()) * T, (y + rnd()) * T, T * (0.012 + rnd() * 0.018), 0, Math.PI * 2);
      g.fill();
    }
  }

  // Walls: a wash, hatching, then the outline in ink, drawn twice for a sketched line.
  union(walls);
  g.fillStyle = 'rgba(120,85,45,0.2)';
  g.fill();
  g.save();
  union(walls);
  g.clip();
  g.strokeStyle = 'rgba(51,36,26,0.3)';
  g.lineWidth = Math.max(1, T * 0.022);
  for (let k = -h; k < w; k += T * 0.19) sketch(g, k, 0, k + h, h, rnd, T * 0.012);
  g.restore();
  const runs = wallRuns(map);
  g.strokeStyle = css(INK);
  g.lineWidth = T * 0.05;
  for (const [x1, y1, x2, y2] of runs) sketch(g, x1 * T, y1 * T, x2 * T, y2 * T, rnd, T * 0.03);
  g.lineWidth = T * 0.022;
  g.strokeStyle = css(INK, 0.6);
  for (const [x1, y1, x2, y2] of runs) sketch(g, x1 * T, y1 * T, x2 * T, y2 * T, rnd, T * 0.045);
  g.lineWidth = T * 0.06;
  g.strokeStyle = css(INK);
  const m = T * 0.06;
  sketch(g, m, m, w - m, m, rnd, T * 0.03);
  sketch(g, w - m, m, w - m, h - m, rnd, T * 0.03);
  sketch(g, w - m, h - m, m, h - m, rnd, T * 0.03);
  sketch(g, m, h - m, m, m, rnd, T * 0.03);

  // Start spots: small inked circles.
  g.lineWidth = T * 0.03;
  g.strokeStyle = css(INK, 0.55);
  for (const s of map.startPositions) sketchCircle(g, s.x * T, s.y * T, T * 0.36, rnd, T * 0.02);

  // Finish: an inked chequer, framed in green ink.
  const f = map.finish;
  const cell = T / 2;
  for (let cy = 0; cy < f.h * 2; cy++) {
    for (let cx = 0; cx < f.w * 2; cx++) {
      if ((cx + cy) % 2) continue;
      g.fillStyle = css(INK, 0.7);
      g.fillRect(f.x * T + cx * cell + 1, f.y * T + cy * cell + 1, cell - 2, cell - 2);
    }
  }
  g.strokeStyle = css(0x2f7a3c);
  g.lineWidth = T * 0.06;
  const fx = f.x * T;
  const fy = f.y * T;
  sketch(g, fx, fy, fx + f.w * T, fy, rnd, T * 0.03);
  sketch(g, fx + f.w * T, fy, fx + f.w * T, fy + f.h * T, rnd, T * 0.03);
  sketch(g, fx + f.w * T, fy + f.h * T, fx, fy + f.h * T, rnd, T * 0.03);
  sketch(g, fx, fy + f.h * T, fx, fy, rnd, T * 0.03);
  return c;
}

/** A landmark drawn on the map like a map symbol: 5 tiles across, centred, `T` pixels per tile. */
export function paintInkLandmark(mark: Landmark, tint: number, T: number): HTMLCanvasElement {
  const size = 5 * T;
  const c = canvas(size, size);
  const g = c.getContext('2d')!;
  const rnd = rng(Math.round(mark.x * 131 + mark.y * 17));
  const x = size / 2;
  const y = size / 2;
  const r = T * 0.8;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.fillStyle = css(tint, 0.16);
  g.beginPath();
  g.arc(x, y, T * 1.9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = css(INK, 0.6);
  g.lineWidth = T * 0.03;
  g.setLineDash([T * 0.05, T * 0.11]);
  g.beginPath();
  g.arc(x, y, T * 1.75, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  sketchCircle(g, x, y, T * 1.35, rnd, T * 0.025);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r0 = T * 1.35;
    const r1 = T * (i % 4 === 0 ? 1.6 : 1.48);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    g.stroke();
  }
  g.fillStyle = css(tint, 0.6);
  g.strokeStyle = css(INK);
  g.lineWidth = T * 0.05;
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * r, y + py * r) : g.moveTo(x + px * r, y + py * r)));
    g.closePath();
    g.fill();
    g.stroke();
  };
  const disc = (dx: number, dy: number, rr: number) => {
    g.beginPath();
    g.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  switch (mark.kind) {
    case 'fountain':
      disc(0, 0, 1);
      g.fillStyle = css(0x78afcd, 0.7);
      disc(0, 0, 0.45);
      break;
    case 'statue':
      poly([[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]]);
      g.strokeRect(x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
      break;
    case 'tree':
      for (const [dx, dy, rr] of [[-0.4, 0.2, 0.6], [0.4, 0.2, 0.6], [0, -0.4, 0.65]] as const) disc(dx, dy, rr);
      break;
    case 'crystal':
      poly([[0, -1.1], [0.7, 0], [0, 1.1], [-0.7, 0]]);
      g.beginPath();
      g.moveTo(x, y - r * 1.1);
      g.lineTo(x, y + r * 1.1);
      g.stroke();
      break;
    case 'brazier':
      poly([[0, -1], [0.9, 0.7], [-0.9, 0.7]]);
      break;
    case 'obelisk':
      poly([[-0.3, -1.1], [0.3, -1.1], [0.3, -0.3], [0.9, -0.3], [0.9, 0.3], [0.3, 0.3], [0.3, 1.1], [-0.3, 1.1], [-0.3, 0.3], [-0.9, 0.3], [-0.9, -0.3], [-0.3, -0.3]]);
      break;
  }
  return c;
}

/**
 * A runner in ink, seen from above, drawn into Phaser graphics: legs and arms
 * swinging with `phase`, a body in the player's colour and a scarf trailing
 * behind. `size` is the length of a tile in world pixels.
 */
export function drawInkRunner(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  facing: number,
  phase: number,
  color: number,
  size: number,
  moving: boolean,
  time: number,
  alpha = 1,
): void {
  const s = moving ? Math.sin(phase) : 0;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const at = (fx: number, fy: number) => ({ x: x + (fx * cos - fy * sin) * size, y: y + (fx * sin + fy * cos) * size });
  const line = (a: [number, number], b: [number, number]) => {
    const p = at(...a);
    const q = at(...b);
    g.lineBetween(p.x, p.y, q.x, q.y);
  };
  g.fillStyle(0x46301a, 0.18 * alpha).fillEllipse(x + size * 0.03, y + size * 0.06, size * 0.5, size * 0.42);
  // Scarf, in the player's colour.
  const scarf = Array.from({ length: 7 }, (_, i) => at(-0.06 - i * 0.075, 0.06 + Math.sin(time * 11 - i * 0.9) * 0.035 * (i / 6)));
  g.lineStyle(size * 0.07, color, alpha).strokePoints(scarf, false);
  g.lineStyle(size * 0.055, INK, alpha);
  line([0, -0.08], [s * 0.3, -0.1]);
  line([0, 0.08], [-s * 0.3, 0.1]);
  g.lineStyle(size * 0.045, INK, alpha);
  line([0, -0.2], [-s * 0.22, -0.27]);
  line([0, 0.2], [s * 0.22, 0.27]);
  const body = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    return at(Math.cos(a) * 0.13, Math.sin(a) * 0.22);
  });
  g.fillStyle(color, 0.92 * alpha).fillPoints(body, true);
  g.lineStyle(size * 0.035, INK, alpha).strokePoints(body, true, true);
  const head = at(0.03, 0);
  g.fillStyle(INK, alpha).fillCircle(head.x, head.y, size * 0.11);
  const shine = at(0, -0.035);
  g.fillStyle(PAPER, 0.35 * alpha).fillCircle(shine.x, shine.y, size * 0.04);
}
