import { DEFAULT_CONFIG, MAP_SIZES, type MapSize, generateMap, previewSeconds } from '@cursar/game-core';
import { useMemo } from 'react';
import { audio } from '../audio/AudioEngine';
import { type Settings, formatTime, loadGhost, randomSeed } from '../storage';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onStart: () => void;
  onMultiplayer: () => void;
}

const SIZE_NOTES: Record<MapSize, string> = {
  small: 'Around 2 minutes',
  medium: 'Around 3 minutes',
  large: 'Around 4–5 minutes',
};

export function Menu({ settings, onChange, onStart, onMultiplayer }: Props) {
  const seed = settings.seed.trim() || 'cursar';
  const map = useMemo(() => generateMap({ seed, size: settings.size }), [seed, settings.size]);
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
        </label>

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
          <input type="checkbox" checked={!settings.muted} onChange={(event) => onChange({ muted: !event.target.checked })} />
          <span>Sound</span>
        </label>

        <button type="submit" className="primary">Start solo race</button>
        <button type="button" className="secondary" onClick={onMultiplayer}>Play with friends</button>
        {best && <p className="hint">In a solo race, your best run on this map races alongside you as a ghost.</p>}

        <table className="keys">
          <tbody>
            <tr><th>Move</th><td><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys</td></tr>
            <tr><th>Sprint</th><td><kbd>Shift</kbd> (uses stamina)</td></tr>
            <tr><th>Waypoints</th><td>Click the map during the preview (up to {DEFAULT_CONFIG.markers.max})</td></tr>
            <tr><th>Start early</th><td><kbd>Enter</kbd> during the preview</td></tr>
            <tr><th>Full map</th><td><kbd>M</kbd> during the race (you stand still while it is open)</td></tr>
            <tr><th>Skills</th><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> take a card at a checkpoint; <kbd>Q</kbd> <kbd>E</kbd> <kbd>F</kbd> use one</td></tr>
            <tr><th>Restart / pause</th><td><kbd>R</kbd> / <kbd>Esc</kbd></td></tr>
          </tbody>
        </table>
      </form>
    </main>
  );
}
