import { DEFAULT_CONFIG, type GameMap, decodeGhostFile } from '@cursar/game-core';
import { useEffect, useRef, useState } from 'react';
import { type MapGhosts, addGhost, bestRun, exportGhost, ghostDetail, ghostTitle, loadGhosts, saveGhosts, updateGhosts } from '../recordings';
import { formatTime } from '../storage';

interface Props {
  map: GameMap;
  /** A ghost file was opened: switch the menu to its map (adding a hand-made one to My maps). */
  onOpenMap: (map: GameMap) => void;
}

/** Choosing the ghost to race in solo, managing the ghosts kept for a map, and ghost files. */
export function Ghosts({ map, onOpenMap }: Props) {
  const [lib, setLib] = useState<MapGhosts>(() => loadGhosts(map.id, map.name));
  const [managing, setManaging] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setLib(loadGhosts(map.id, map.name)), [map.id, map.name]);

  const best = bestRun(lib);
  const change = (fn: (l: MapGhosts) => void) => setLib(updateGhosts(map.id, fn));
  const entries = [...lib.entries].sort((a, b) => a.ghost.time - b.ghost.time);
  const chosenValid = lib.chosen === 'none' || lib.chosen === 'best' || lib.entries.some((e) => e.id === lib.chosen);

  const openFile = async (file: File) => {
    setMessage(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setMessage({ text: 'That file could not be read.', bad: true });
      return;
    }
    const result = decodeGhostFile(raw);
    if (!result.ok) {
      setMessage({ text: result.error, bad: true });
      return;
    }
    const { lib: next, entry, saved } = addGhost(result.map, result.ghost, 'file');
    if (!saved) {
      setMessage({ text: 'This browser’s storage is full. Delete some ghosts or maps to make room.', bad: true });
      return;
    }
    next.chosen = entry.id;
    saveGhosts(next);
    onOpenMap(result.map);
    if (result.map.id === map.id) setLib(loadGhosts(map.id, map.name));
    setMessage({ text: `${result.ghost.playerName}’s ghost (${formatTime(result.ghost.time)}) on ${result.map.name} is ready to race.` });
  };

  return (
    <fieldset className="ghosts">
      <legend>Ghost</legend>
      <div className="map-source">
        <select
          value={chosenValid ? lib.chosen : 'best'}
          onChange={(event) => change((l) => (l.chosen = event.target.value))}
          aria-label="Ghost to race against"
        >
          <option value="none">No ghost</option>
          <option value="best">{best ? `Your best run (${formatTime(best.ghost.time)})` : 'Your best run (none yet)'}</option>
          {entries.filter((e) => e !== best).map((e) => (
            <option key={e.id} value={e.id}>{ghostTitle(e, best)} – {formatTime(e.ghost.time)} ({ghostDetail(e)})</option>
          ))}
        </select>
        {lib.entries.length > 0 && (
          <button type="button" onClick={() => setManaging((open) => !open)} aria-expanded={managing}>
            {managing ? 'Done' : `Manage (${lib.entries.length})`}
          </button>
        )}
        <button type="button" onClick={() => fileInput.current?.click()}>Open ghost file</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void openFile(file);
          }}
        />
      </div>
      {message && <p className={message.bad ? 'hint bad' : 'hint'}>{message.text}</p>}
      {lib.entries.length === 0 && !message && (
        <p className="hint">Finish a run and it races alongside you next time. Ghosts from friends come from race results or ghost files.</p>
      )}
      {managing && (
        <ul className="ghost-list">
          {entries.map((e) => (
            <li key={e.id}>
              <div>
                <strong>{ghostTitle(e, best)}</strong> {formatTime(e.ghost.time)}
                {e.pinned && <span className="tag">Kept</span>}
                <small>{ghostDetail(e)}</small>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  title={e.pinned ? 'Let it go when newer runs come in' : 'Keep it even when newer runs come in'}
                  onClick={() => change((l) => { const it = l.entries.find((x) => x.id === e.id); if (it) it.pinned = !it.pinned; })}
                >
                  {e.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt('Name this ghost (leave empty for the usual name)', e.label);
                    if (name === null) return;
                    change((l) => { const it = l.entries.find((x) => x.id === e.id); if (it) it.label = name.trim().slice(0, 40); });
                  }}
                >
                  Rename
                </button>
                <button type="button" onClick={() => exportGhost(map, e.ghost)}>Export</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Delete “${ghostTitle(e, best)}” (${formatTime(e.ghost.time)})? This cannot be undone.`)) return;
                    change((l) => (l.entries = l.entries.filter((x) => x.id !== e.id)));
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          <li className="hint">
            Kept for each map: your best run, your last {DEFAULT_CONFIG.ghost.keepRecent} runs, ghosts from others, and anything pinned.
          </li>
        </ul>
      )}
    </fieldset>
  );
}
