import {
  EDITOR_LIMITS,
  type GameMap,
  MAP_SIZES,
  type MapSize,
  TRAP_KINDS,
  Tile,
  type TrapKind,
  blankMap,
  cellGrid,
  contentId,
  decodeMap,
  encodeMap,
  generateMap,
  validateMap,
} from '@cursar/game-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Spot,
  TOOLS,
  type ToolId,
  cycleBarrier,
  cycleLandmark,
  editorWarnings,
  eraseAt,
  extendBeat,
  isOpen,
  landmarkPoint,
  paintCell,
  placeBoulder,
  placeStart,
  setOpen,
  spotAt,
  spotTiles,
  toggleCheckpoint,
  toggleFoe,
  toggleGate,
  toggleTrap,
  toggleTreasure,
} from '../editor/tools';
import { TRAP_STYLE, cssColor } from '../game/effects';
import { loadMaps, saveMap } from '../storage';

interface Props {
  /** The map to open, or null for a new blank one. */
  initial: GameMap | null;
  /** The saved id the map had when opened, so saving replaces it. */
  savedId: string | null;
  onTest: (map: GameMap, savedId: string | null) => void;
  onExit: () => void;
}

const COLORS = {
  wall: '#5d6a80',
  floor: '#262c38',
  mud: '#5b4429',
  ice: '#8ecbe0',
  start: '#ffffff',
  finish: '#e8e8e8',
  checkpoint: '#ff5fa2',
  landmark: '#ffd166',
  treasure: '#ffd23f',
  chaser: '#d9342b',
  turret: '#aab4c8',
  patroller: '#8e5bd6',
  boulder: '#a0754d',
  gate: '#ff9f1c',
  barrier: '#f4f4f4',
  hover: 'rgba(255, 255, 255, 0.25)',
};
const TILE_COLOR: Record<number, string> = { [Tile.Floor]: COLORS.floor, [Tile.Wall]: COLORS.wall, [Tile.Mud]: COLORS.mud, [Tile.Ice]: COLORS.ice };
const LANDMARK_LETTER: Record<string, string> = { fountain: 'F', statue: 'S', tree: 'T', crystal: 'C', brazier: 'B', obelisk: 'O' };

const clone = (map: GameMap): GameMap => structuredClone(map);

/** The map editor: a maze-cell grid you open walls in and place things on, then save, export, or race. */
export function Editor({ initial, savedId: openedId, onTest, onExit }: Props) {
  const [map, setMap] = useState<GameMap>(() => clone(initial ?? blankMap(12, 9)));
  const [savedId, setSavedId] = useState<string | null>(openedId);
  const [undo, setUndo] = useState<GameMap[]>([]);
  const [tool, setTool] = useState<ToolId>('wall');
  const [trapKind, setTrapKind] = useState<TrapKind>('spikes');
  const [beat, setBeat] = useState<{ c: number; r: number }[] | null>(null);
  const [boulderFrom, setBoulderFrom] = useState<{ c: number; r: number } | null>(null);
  const [hover, setHover] = useState<{ fx: number; fy: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newSize, setNewSize] = useState({ cols: 12, rows: 9 });
  const [genSeed, setGenSeed] = useState('');
  const [genSize, setGenSize] = useState<MapSize>('small');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ open: boolean; last: string } | null>(null);
  /** Where the pointer was at the last event while the button is held, so a fast drag misses nothing in between. */
  const lastPos = useRef<{ fx: number; fy: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The latest map, for edits arriving faster than the screen redraws (dragging).
  const latest = useRef(map);
  latest.current = map;

  const grid = cellGrid(map)!;
  const scale = Math.max(6, Math.floor(Math.min(880 / map.width, 600 / map.height)));
  const check = useMemo(() => validateMap(map), [map]);
  const warnings = useMemo(() => editorWarnings(map), [map]);

  /** Applies an edit to a copy of the map, keeping the old one for undo. */
  const change = useCallback(
    (edit: (draft: GameMap) => string | null | void, keepUndo = true) => {
      const base = latest.current;
      const draft = clone(base);
      const error = edit(draft);
      if (error) {
        setMessage(error);
        return;
      }
      setMessage(null);
      if (JSON.stringify(draft) === JSON.stringify(base)) return;
      if (keepUndo) setUndo((u) => [...u.slice(-49), base]);
      latest.current = draft;
      setMap(draft);
      setDirty(true);
    },
    [],
  );

  const replaceMap = (next: GameMap, id: string | null) => {
    setMap(clone(next));
    setSavedId(id);
    setUndo([]);
    setBeat(null);
    setBoulderFrom(null);
    setDirty(false);
    setMessage(null);
  };

  // Ctrl+Z undoes; Esc cancels a beat or boulder being drawn.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setUndo((u) => {
          const prev = u[u.length - 1];
          if (prev) setMap(prev);
          return u.slice(0, -1);
        });
      } else if (event.key === 'Escape') {
        setBeat(null);
        setBoulderFrom(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drawing.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = el.getContext('2d')!;
    const s = scale;
    el.width = map.width * s;
    el.height = map.height * s;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle = TILE_COLOR[map.tiles[y * map.width + x]!] ?? COLORS.floor;
        g.fillRect(x * s, y * s, s, s);
      }
    }
    // Finish: chequered.
    const f = map.finish;
    for (let y = 0; y < f.h * 2; y++) {
      for (let x = 0; x < f.w * 2; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : COLORS.finish;
        g.fillRect((f.x + x / 2) * s, (f.y + y / 2) * s, s / 2, s / 2);
      }
    }
    g.lineWidth = Math.max(2, s / 5);
    for (const z of map.checkpoints) {
      g.strokeStyle = COLORS.checkpoint;
      g.strokeRect(z.x * s + 1, z.y * s + 1, z.w * s - 2, z.h * s - 2);
    }
    g.fillStyle = COLORS.start;
    for (const p of map.startPositions) {
      g.beginPath();
      g.arc(p.x * s, p.y * s, s * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${Math.round(s * 0.8)}px system-ui, sans-serif`;
    for (const l of map.landmarks) {
      g.fillStyle = COLORS.landmark;
      g.beginPath();
      g.arc(l.x * s, l.y * s, s * 0.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.fillText(LANDMARK_LETTER[l.kind] ?? '?', l.x * s, l.y * s + 1);
    }
    for (const t of map.traps ?? []) {
      g.fillStyle = cssColor(TRAP_STYLE[t.kind].color);
      g.fillRect((t.x + 0.2) * s, (t.y + 0.2) * s, s * 0.6, s * 0.6);
    }
    for (const t of map.treasures ?? []) {
      g.fillStyle = COLORS.treasure;
      g.beginPath();
      g.arc(t.x * s, t.y * s, s * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    for (const o of map.obstacles ?? []) {
      if (o.kind === 'boulder') {
        g.strokeStyle = COLORS.boulder;
        g.lineWidth = s * 0.5;
        g.beginPath();
        g.moveTo(o.ax * s, o.ay * s);
        g.lineTo(o.bx * s, o.by * s);
        g.stroke();
        g.fillStyle = COLORS.boulder;
        g.beginPath();
        g.arc(o.ax * s, o.ay * s, s * 0.9, 0, Math.PI * 2);
        g.fill();
      } else if (o.kind === 'gate') {
        g.fillStyle = COLORS.gate;
        g.fillRect(o.x * s, o.y * s, o.w * s, o.h * s);
      } else {
        g.strokeStyle = COLORS.barrier;
        g.lineWidth = 2;
        g.setLineDash([s * 0.4, s * 0.3]);
        g.beginPath();
        g.arc(o.x * s, o.y * s, s * 2, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = COLORS.barrier;
        g.fillText(o.dir === 1 ? '↻' : '↺', o.x * s, (o.y - 2.6) * s);
      }
    }
    const drawBeat = (pts: { x: number; y: number }[], alpha: number) => {
      g.strokeStyle = COLORS.patroller;
      g.globalAlpha = alpha;
      g.lineWidth = s * 0.3;
      g.beginPath();
      pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x * s, p.y * s) : g.lineTo(p.x * s, p.y * s)));
      g.stroke();
      g.globalAlpha = 1;
    };
    for (const e of map.enemies ?? []) {
      if (e.kind === 'patroller') {
        drawBeat(e.path, 0.7);
        const p = e.path[0]!;
        g.fillStyle = COLORS.patroller;
        g.fillRect((p.x - 0.45) * s, (p.y - 0.45) * s, s * 0.9, s * 0.9);
      } else {
        g.fillStyle = e.kind === 'chaser' ? COLORS.chaser : COLORS.turret;
        g.beginPath();
        if (e.kind === 'chaser') g.arc(e.x * s, e.y * s, s * 0.55, 0, Math.PI * 2);
        else g.rect((e.x - 0.5) * s, (e.y - 0.5) * s, s, s);
        g.fill();
      }
    }
    if (beat) drawBeat(beat.map((cell) => ({ x: cell.c * 3 + 2, y: cell.r * 3 + 2 })), 1);
    if (boulderFrom) {
      g.strokeStyle = COLORS.boulder;
      g.lineWidth = 3;
      g.strokeRect((boulderFrom.c * 3 + 1) * s, (boulderFrom.r * 3 + 1) * s, 2 * s, 2 * s);
    }
    // What a click would change.
    if (hover) {
      const spot = spotAt(map, hover.fx, hover.fy);
      g.fillStyle = COLORS.hover;
      if (tool === 'trap' || tool === 'erase') g.fillRect(Math.floor(hover.fx) * s, Math.floor(hover.fy) * s, s, s);
      else if (spot) for (const p of spotTiles(spot)) g.fillRect(p.x * s, p.y * s, s, s);
    }
  }, [map, scale, hover, beat, boulderFrom, tool]);

  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = ((event.clientX - rect.left) / rect.width) * map.width;
    const fy = ((event.clientY - rect.top) / rect.height) * map.height;
    return { fx, fy, spot: spotAt(map, fx, fy) };
  };

  const apply = (fx: number, fy: number, spot: Spot | null, first: boolean) => {
    const cell = spot?.kind === 'cell' ? spot : null;
    switch (tool) {
      case 'wall': {
        if (!spot || spot.kind === 'cell') return;
        const key = `${spot.kind}:${spot.c}:${spot.r}:${spot.kind === 'wall' ? spot.dx : ''}`;
        if (first) drag.current = { open: !isOpen(latest.current, spot), last: '' };
        if (!drag.current || drag.current.last === key) return;
        drag.current.last = key;
        const open = drag.current.open;
        change((d) => setOpen(d, spot, open), first);
        return;
      }
      case 'floor':
      case 'mud':
      case 'ice': {
        if (!cell) return;
        const t = tool === 'floor' ? Tile.Floor : tool === 'mud' ? Tile.Mud : Tile.Ice;
        change((d) => paintCell(d, cell.c, cell.r, t), first);
        return;
      }
    }
    if (!first) return;
    switch (tool) {
      case 'start':
        if (cell) change((d) => placeStart(d, cell.c, cell.r));
        return;
      case 'finish':
        if (cell) change((d) => void (d.finish = { x: cell.c * 3 + 1, y: cell.r * 3 + 1, w: 2, h: 2 }));
        return;
      case 'checkpoint':
        if (cell) change((d) => toggleCheckpoint(d, cell.c, cell.r));
        return;
      case 'landmark': {
        const p = spot ? landmarkPoint(spot) : null;
        if (p) change((d) => cycleLandmark(d, p));
        return;
      }
      case 'trap':
        change((d) => toggleTrap(d, Math.floor(fx), Math.floor(fy), trapKind));
        return;
      case 'treasure':
        if (cell) change((d) => toggleTreasure(d, cell.c, cell.r));
        return;
      case 'chaser':
      case 'turret':
        if (cell) change((d) => toggleFoe(d, cell.c, cell.r, tool));
        return;
      case 'patroller': {
        if (!cell) return;
        const draft = clone(map);
        const result = extendBeat(draft, beat ?? [], cell.c, cell.r);
        setMessage(result.error ?? null);
        setBeat(result.path);
        if (!result.path && !result.error && (draft.enemies?.length ?? 0) !== (map.enemies?.length ?? 0)) change((d) => void (d.enemies = draft.enemies));
        return;
      }
      case 'boulder':
        if (!cell) return;
        if (!boulderFrom) {
          setBoulderFrom({ c: cell.c, r: cell.r });
          setMessage('Now click the other end of the corridor.');
        } else {
          const from = boulderFrom;
          setBoulderFrom(null);
          change((d) => placeBoulder(d, from, cell));
        }
        return;
      case 'gate':
        if (spot) change((d) => toggleGate(d, spot));
        return;
      case 'barrier':
        change((d) => cycleBarrier(d, { x: fx, y: fy }));
        return;
      case 'erase':
        change((d) => void eraseAt(d, fx, fy));
        return;
    }
  };

  const pickTool = (id: ToolId) => {
    setTool(id);
    setBeat(null);
    setBoulderFrom(null);
    setMessage(null);
  };

  const save = () => {
    const named = { ...map, name: map.name.trim() || 'My map' };
    const saved = { ...named, id: contentId(named) };
    saveMap(saved, savedId ?? undefined);
    setMap(saved);
    setSavedId(saved.id);
    setDirty(false);
    setMessage(`Saved “${saved.name}”. It is in the menu’s map list and the multiplayer lobby.`);
    return saved;
  };

  const exportFile = () => {
    const named = { ...map, name: map.name.trim() || 'My map' };
    const blob = new Blob([JSON.stringify(encodeMap({ ...named, id: contentId(named) }))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${named.name.replace(/[^\w -]/g, '').trim() || 'map'}.cursar.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (file: File) => {
    try {
      const result = decodeMap(JSON.parse(await file.text()));
      if (!result.ok) {
        setMessage(`Could not open that file: ${result.error}`);
        return;
      }
      if (!cellGrid(result.map)) {
        setMessage('That map is not laid out on the maze-cell grid, so it cannot be edited here (it can still be raced).');
        return;
      }
      replaceMap(result.map, null);
      setMessage(`Opened “${result.map.name}”. Save it to keep it.`);
    } catch {
      setMessage('Could not open that file: it is not a Cursar map.');
    }
  };

  const confirmLeave = () => !dirty || window.confirm('Leave without saving your changes?');
  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const groups = [...new Set(TOOLS.map((t) => t.group))];
  const counts = `${map.checkpoints.length} checkpoints · ${map.traps?.length ?? 0} traps · ${map.treasures?.length ?? 0} coins · ${map.enemies?.length ?? 0} enemies · ${map.obstacles?.length ?? 0} obstacles`;

  return (
    <main className="editor">
      <header className="editor-bar">
        <h1>Map editor</h1>
        <input
          className="editor-name"
          value={map.name}
          maxLength={40}
          aria-label="Map name"
          onChange={(event) => {
            const name = event.target.value;
            setMap((m) => ({ ...m, name }));
            setDirty(true);
          }}
        />
        <button type="button" className="primary" onClick={save} disabled={!check.ok}>Save</button>
        <button type="button" onClick={() => onTest(dirty ? save() : map, savedId)} disabled={!check.ok}>Race it</button>
        <button type="button" onClick={exportFile} disabled={!check.ok}>Export file</button>
        <button type="button" onClick={() => fileInput.current?.click()}>Open file</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = '';
        }} />
        <button type="button" onClick={() => setUndo((u) => {
          const prev = u[u.length - 1];
          if (prev) setMap(prev);
          return u.slice(0, -1);
        })} disabled={undo.length === 0}>Undo</button>
        <button type="button" onClick={() => confirmLeave() && onExit()}>Back to menu</button>
      </header>

      <div className="editor-body">
        <aside className="editor-tools">
          {groups.map((group) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {TOOLS.filter((t) => t.group === group).map((t) => (
                <button key={t.id} type="button" className={tool === t.id ? 'active' : ''} onClick={() => pickTool(t.id)}>{t.label}</button>
              ))}
            </fieldset>
          ))}
          {tool === 'trap' && (
            <label className="field">
              <span>Trap kind</span>
              <select value={trapKind} onChange={(event) => setTrapKind(event.target.value as TrapKind)}>
                {TRAP_KINDS.map((k) => (
                  <option key={k} value={k}>{k === 'reverse' ? 'Trick tile (reversed)' : k === 'confuse' ? 'Trick tile (confused)' : TRAP_STYLE[k].label}</option>
                ))}
              </select>
            </label>
          )}
        </aside>

        <section className="editor-canvas">
          <p className="editor-hint">{message ?? toolInfo.hint}</p>
          <canvas
            ref={canvas}
            style={{ width: map.width * scale, height: map.height * scale }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const { fx, fy, spot } = pointer(event);
              lastPos.current = { fx, fy };
              apply(fx, fy, spot, true);
            }}
            onPointerMove={(event) => {
              const { fx, fy } = pointer(event);
              setHover({ fx, fy });
              if (!(event.buttons & 1) || !lastPos.current) return;
              // Visit every point along the way, a third of a tile apart.
              const from = lastPos.current;
              const steps = Math.max(1, Math.ceil(Math.hypot(fx - from.fx, fy - from.fy) * 3));
              for (let i = 1; i <= steps; i++) {
                const x = from.fx + ((fx - from.fx) * i) / steps;
                const y = from.fy + ((fy - from.fy) * i) / steps;
                apply(x, y, spotAt(latest.current, x, y), false);
              }
              lastPos.current = { fx, fy };
            }}
            onPointerUp={() => {
              drag.current = null;
              lastPos.current = null;
            }}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(event) => event.preventDefault()}
          />
          <p className="editor-counts">{grid.cols} × {grid.rows} cells · {counts}</p>
          {!check.ok && (
            <ul className="editor-problems">
              {[...new Set(check.errors.map((e) => e.replace(/^Start position \d+/, 'The start')))].map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {check.ok && (
            <p className="editor-ok">Raceable: shortest route about {Math.round(check.routeLength)} tiles.</p>
          )}
          {warnings.length > 0 && (
            <ul className="editor-warnings">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </section>

        <aside className="editor-new">
          <fieldset>
            <legend>New blank map</legend>
            <div className="row">
              <label className="field">
                <span>Cells across</span>
                <input type="number" min={EDITOR_LIMITS.minCols} max={EDITOR_LIMITS.maxCols} value={newSize.cols}
                  onChange={(event) => setNewSize((n) => ({ ...n, cols: Number(event.target.value) }))} />
              </label>
              <label className="field">
                <span>Down</span>
                <input type="number" min={EDITOR_LIMITS.minRows} max={EDITOR_LIMITS.maxRows} value={newSize.rows}
                  onChange={(event) => setNewSize((n) => ({ ...n, rows: Number(event.target.value) }))} />
              </label>
            </div>
            <button type="button" onClick={() => {
              if (!confirmLeave()) return;
              const cols = Math.max(EDITOR_LIMITS.minCols, Math.min(EDITOR_LIMITS.maxCols, Math.round(newSize.cols) || 12));
              const rows = Math.max(EDITOR_LIMITS.minRows, Math.min(EDITOR_LIMITS.maxRows, Math.round(newSize.rows) || 9));
              replaceMap(blankMap(cols, rows), null);
            }}>Start blank</button>
          </fieldset>
          <fieldset>
            <legend>Start from a generated map</legend>
            <label className="field">
              <span>Seed</span>
              <input value={genSeed} placeholder="any word" maxLength={40} spellCheck={false} onChange={(event) => setGenSeed(event.target.value)} />
            </label>
            <label className="field">
              <span>Size</span>
              <select value={genSize} onChange={(event) => setGenSize(event.target.value as MapSize)}>
                {(Object.keys(MAP_SIZES) as MapSize[]).map((size) => <option key={size} value={size}>{MAP_SIZES[size].label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => {
              if (!confirmLeave()) return;
              const seed = genSeed.trim() || 'cursar';
              const { generator: _generator, ...made } = generateMap({ seed, size: genSize });
              replaceMap({ ...made, name: `${seed} (edited)` }, null);
            }}>Open generated map</button>
          </fieldset>
          <MyMaps current={savedId} onOpen={(m) => confirmLeave() && replaceMap(m, m.id)} />
        </aside>
      </div>
    </main>
  );
}

function MyMaps({ current, onOpen }: { current: string | null; onOpen: (map: GameMap) => void }) {
  const maps = loadMaps();
  if (maps.length === 0) return null;
  return (
    <fieldset>
      <legend>My maps</legend>
      <ul className="editor-maps">
        {maps.map((m) => (
          <li key={m.id}>
            <button type="button" className={m.id === current ? 'active' : ''} onClick={() => onOpen(m)} disabled={!cellGrid(m)}>{m.name}</button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
