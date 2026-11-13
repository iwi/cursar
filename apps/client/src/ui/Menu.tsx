import { DEFAULT_CONFIG, type GameMap, MAP_SIZES, type MapSize, generateMap, previewSeconds } from '@cursar/game-core';
import { useMemo, useState } from 'react';
import { audio } from '../audio/AudioEngine';
import { type Settings, deleteMap, formatTime, loadGhost, loadMaps, randomSeed } from '../storage';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onStart: () => void;
  onMultiplayer: () => void;
  /** Opens the map editor on a saved map, or on a new blank one (null). */
  onEditor: (map: GameMap | null) => void;
}

const SIZE_NOTES: Record<MapSize, string> = {
  tiny: 'About a minute',
  small: 'Around 2 minutes',
  medium: 'Around 3 minutes',
  large: 'Around 4–5 minutes',
};

export function Menu({ settings, onChange, onStart, onMultiplayer, onEditor }: Props) {
  const seed = settings.seed.trim() || 'cursar';
  const [myMaps, setMyMaps] = useState(() => loadMaps());
  const custom = myMaps.find((m) => m.id === settings.mapId) ?? null;
  const generated = useMemo(() => generateMap({ seed, size: settings.size }), [seed, settings.size]);
  const map = custom ?? generated;
  const best = useMemo(() => loadGhost(map.id), [map.id]);

  return (
    <main className="menu">
      <form
        className="menu-card"
        onSubmit={(event) => {
          event.preventDefault();
          onStart();
        }}
      >
        <header>
          <h1>Cursar</h1>
          <p>Study the map. Then run it from memory: touch every checkpoint, in any order, and reach the finish.</p>
        </header>

        <fieldset>
          <legend>Map</legend>
          <div className="map-source">
            <select value={custom?.id ?? ''} onChange={(event) => onChange({ mapId: event.target.value })} aria-label="Map to race">
              <option value="">A generated map (size and seed below)</option>
              {myMaps.map((m) => <option key={m.id} value={m.id}>{m.name} (my map)</option>)}
            </select>
            <button type="button" onClick={() => onEditor(custom)}>{custom ? 'Edit this map' : 'Map editor'}</button>
            {custom && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete “${custom.name}”? This cannot be undone.`)) return;
                  setMyMaps(deleteMap(custom.id));
                  onChange({ mapId: '' });
                }}
              >
                Delete
              </button>
            )}
          </div>
        </fieldset>

        {!custom && <><fieldset>
          <legend>Map size</legend>
          <div className="sizes">
            {(Object.keys(MAP_SIZES) as MapSize[]).map((size) => (
              <label key={size} className={settings.size === size ? 'size selected' : 'size'}>
                <input type="radio" name="size" checked={settings.size === size} onChange={() => onChange({ size })} />
                <strong>{MAP_SIZES[size].label}</strong>
                <span>{SIZE_NOTES[size]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Map seed</span>
          <div className="seed-row">
            <input value={settings.seed} onChange={(event) => onChange({ seed: event.target.value })} spellCheck={false} maxLength={40} />
            <button
              type="button"
              onClick={() => {
                audio.unlock();
                audio.click();
                onChange({ seed: randomSeed() });
              }}
            >
              New map
            </button>
          </div>
          <small>The same seed always gives the same map, so you can share it or come back to beat your time.</small>
        </label></>}

        <dl className="facts">
          <div>
            <dt>Map</dt>
            <dd>{map.checkpoints.length} checkpoints</dd>
          </div>
          <div>
            <dt>Preview</dt>
            <dd>{previewSeconds(map, DEFAULT_CONFIG)} seconds</dd>
          </div>
          <div>
            <dt>Your best</dt>
            <dd>{best ? formatTime(best.time) : 'Not run yet'}</dd>
          </div>
        </dl>

        <label className="check">
          <input type="checkbox" checked={settings.finishArrow} onChange={(event) => onChange({ finishArrow: event.target.checked })} />
          <span>Show an arrow toward the nearest checkpoint, then the finish <small>(easier)</small></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.vimKeys} onChange={(event) => onChange({ vimKeys: event.target.checked })} />
          <span>Also move with <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> <small>(vim keys)</small></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.mouseMove} onChange={(event) => onChange({ mouseMove: event.target.checked })} />
          <span>Move with the mouse <small>(click or hold to run towards the pointer; right click stops)</small></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={!settings.muted} onChange={(event) => onChange({ muted: !event.target.checked })} />
          <span>Sound</span>
        </label>

        <button type="submit" className="primary">Start solo race</button>
        <button type="button" className="secondary" onClick={onMultiplayer}>Play with friends</button>
        {best && <p className="hint">In a solo race, your best run on this map races alongside you as a ghost.</p>}

        <table className="keys">
          <tbody>
            <tr><th>Move</th><td><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys{settings.vimKeys && <> or <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd></>}{settings.mouseMove && ', or click where to run'}</td></tr>
            <tr><th>Sprint</th><td><kbd>Shift</kbd> (uses stamina)</td></tr>
            <tr><th>Waypoints</th><td>Click the map during the preview (up to {DEFAULT_CONFIG.markers.max})</td></tr>
            <tr><th>Start early</th><td><kbd>Enter</kbd> during the preview</td></tr>
            <tr><th>Shove</th><td><kbd>Space</kbd> pushes a rival or a chaser in front of you (uses stamina)</td></tr>
            <tr><th>Full map</th><td><kbd>M</kbd> during the race (you stand still while it is open)</td></tr>
            <tr><th>Skills</th><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> take a card at a checkpoint</td></tr>
            <tr><th>Restart / pause</th><td><kbd>R</kbd> / <kbd>Esc</kbd></td></tr>
          </tbody>
        </table>
      </form>
    </main>
  );
}
