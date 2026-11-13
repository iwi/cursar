import { MAP_SIZES, type MapSize } from '@cursar/game-core';
import { useState } from 'react';
import { type MapRecord, clearStats, loadStats } from '../stats';
import { formatTime } from '../storage';

interface Props {
  /** Race a map from the list: a generated one by seed and size, a hand-made one by id. */
  onRace: (id: string, record: MapRecord) => void;
  onBack: () => void;
}

function sizeLabel(size: string): string {
  return size in MAP_SIZES ? MAP_SIZES[size as MapSize].label : 'Hand-made';
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${Math.floor(seconds % 60)} s`;
}

/** Your totals, and your record on every map you have raced. */
export function Statistics({ onRace, onBack }: Props) {
  const [stats, setStats] = useState(loadStats);
  const t = stats.totals;
  const favourite = Object.entries(t.bySize).sort((a, b) => b[1] - a[1])[0];
  const maps = Object.entries(stats.maps).sort((a, b) => b[1].lastPlayed.localeCompare(a[1].lastPlayed));
  const races = t.soloRuns + t.netRaces;

  const totals: [string, string][] = [
    ['Solo runs', `${t.soloRuns} (${t.soloFinishes} finished)`],
    ['Races with friends', `${t.netRaces} (${t.netFinishes} finished, ${t.netWins} won)`],
    ['Time racing', duration(t.seconds)],
    ['Distance', `${Math.round(t.distance).toLocaleString('en-GB')} tiles`],
    ['Hearts lost (solo)', String(t.heartsLost)],
    ['Traps sprung (solo)', String(t.trapsSprung)],
    ['Full map open (solo)', duration(t.mapSeconds)],
    ['Favourite size', favourite ? `${sizeLabel(favourite[0])} (${favourite[1]} races)` : '–'],
  ];

  return (
    <main className="menu">
      <div className="menu-card stats">
        <header>
          <h1>Statistics</h1>
          <p>Kept in this browser. Runs that end by restarting or leaving are not counted.</p>
        </header>

        {races === 0 ? (
          <p className="hint">Nothing yet: finish a race and it will show up here.</p>
        ) : (
          <>
            <dl className="facts totals">
              {totals.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            <table className="map-records">
              <thead>
                <tr>
                  <th>Map</th>
                  <th>Size</th>
                  <th>Runs</th>
                  <th>Best</th>
                  <th>Average</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {maps.map(([id, r]) => (
                  <tr key={id}>
                    <td>{r.name}</td>
                    <td>{sizeLabel(r.size)}</td>
                    <td>{r.finishes}/{r.runs}</td>
                    <td>{r.best !== null ? formatTime(r.best) : '–'}</td>
                    <td>{r.finishes > 0 ? formatTime(r.totalTime / r.finishes) : '–'}</td>
                    <td>
                      <button type="button" onClick={() => onRace(id, r)}>Choose</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="actions">
          <button type="button" className="primary" onClick={onBack} autoFocus>Back to menu</button>
          {races > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Clear all statistics? Your ghosts and maps are kept. This cannot be undone.')) return;
                clearStats();
                setStats(loadStats());
              }}
            >
              Clear statistics
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
