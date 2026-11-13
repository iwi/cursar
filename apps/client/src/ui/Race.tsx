import { type GameConfig, type GameMap, PLAYER_COLORS } from '@cursar/game-core';
import { useMemo, useState } from 'react';
import { LocalDriver, type LocalResult } from '../game/driver';
import { addGhost, bestRun, chosenGhost, ghostTitle, loadGhosts } from '../recordings';
import { type MapRecord, recordSolo } from '../stats';
import { type Settings, formatTime } from '../storage';
import { RaceView } from './RaceView';
import { Tuning } from './Tuning';

interface Props {
  map: GameMap;
  config: GameConfig;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onRetry: () => void;
  /** Absent for a hand-made map. */
  onNewMap?: () => void;
  onMenu: () => void;
  /** What the menu button says (for example, back to the editor). */
  menuLabel?: string;
}

interface Outcome extends LocalResult {
  previousBest: number | null;
  /** Checkpoint times of the previous best run, if known. */
  bestSplits: number[] | null;
  newBest: boolean;
  /** False if the browser would not store the run (storage full). */
  saved: boolean;
  record: MapRecord | null;
}

/** A single-player race against the clock and a ghost (your best run, unless you chose another). */
export function Race({ map, config, settings, onChange, onRetry, onNewMap, onMenu, menuLabel = 'Menu' }: Props) {
  const { ghost, best, ghostName } = useMemo(() => {
    const lib = loadGhosts(map.id, map.name);
    const bestEntry = bestRun(lib);
    const chosen = chosenGhost(lib);
    return { ghost: chosen, best: bestEntry, ghostName: chosen ? ghostTitle(chosen, bestEntry) : '' };
  }, [map.id, map.name]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showTuning, setShowTuning] = useState(false);

  const createDriver = () =>
    new LocalDriver(
      map,
      config,
      ghost?.ghost ?? null,
      best?.ghost.time ?? null,
      (result) => {
        const before = recordSolo(map, result);
        const previousBest = best?.ghost.time ?? before?.best ?? null;
        const bestSplits = best?.ghost.splits ?? before?.bestSplits ?? null;
        const newBest = result.finished && result.time !== null && (previousBest === null || result.time < previousBest);
        let saved = true;
        if (result.finished && result.recording) {
          const name = settings.name.trim() || 'Solo runner';
          saved = addGhost(map, { ...result.recording, playerName: name }, 'mine').saved;
        }
        setOutcome({ ...result, previousBest, bestSplits, newBest, saved, record: before });
      },
      { color: PLAYER_COLORS.includes(settings.color) ? settings.color : PLAYER_COLORS[0]! },
    );

  return (
    <RaceView
      map={map}
      createDriver={createDriver}
      settings={settings}
      onChange={onChange}
      title={map.name}
      subtitle={[best ? `Best ${formatTime(best.ghost.time)}` : 'No best time yet', ghost ? `ghost: ${ghostName} ${formatTime(ghost.ghost.time)}` : ''].filter(Boolean).join(' · ')}
      quiet={outcome !== null}
      onRestartKey={onRetry}
      buttons={
        <>
          <button type="button" onClick={() => setShowTuning((open) => !open)}>Tuning</button>
          <button type="button" onClick={onMenu}>Menu</button>
        </>
      }
    >
      {(hud, bridge) => (
        <>
          {hud?.paused && !outcome && (
            <div className="overlay">
              <div className="panel">
                <h2>Paused</h2>
                <div className="actions">
                  <button type="button" className="primary" onClick={() => bridge.emit('setPaused', false)}>Resume</button>
                  <button type="button" onClick={onRetry}>Restart</button>
                  <button type="button" onClick={onMenu}>Menu</button>
                </div>
              </div>
            </div>
          )}

          {outcome && (
            <div className="overlay results">
              <div className="panel">
                <div className="summary">
                  {outcome.finished && outcome.time !== null ? (
                    <>
                      <h2>{outcome.newBest ? (outcome.previousBest === null ? 'First time on the board' : 'New best!') : 'Finished'}</h2>
                      <div className="big-time">{formatTime(outcome.time)}</div>
                      {outcome.previousBest !== null && (
                        <p className={outcome.newBest ? 'delta good' : 'delta bad'}>
                          {outcome.newBest ? '−' : '+'}
                          {Math.abs(outcome.time - outcome.previousBest).toFixed(2)}s against your best of {formatTime(outcome.previousBest)}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <h2>Out of time</h2>
                      <p className="delta">
                        Races are cut off after {formatTime(config.race.timeLimitSeconds)}. You had touched {hud?.checkpointsDone ?? 0} of{' '}
                        {hud?.checkpointsTotal ?? 0} checkpoints; the line shows where you went.
                      </p>
                    </>
                  )}
                </div>
                <div className="actions">
                  <button type="button" className="primary" onClick={onRetry} autoFocus>Race this map again</button>
                  {onNewMap && <button type="button" onClick={onNewMap}>New map</button>}
                  <button type="button" onClick={onMenu}>{menuLabel}</button>
                </div>
                <RunReport outcome={outcome} />
                {!outcome.saved && <p className="delta bad">This browser’s storage is full, so the run was not kept as a ghost. Delete some ghosts or maps to make room.</p>}
                <p className="legend">
                  <span className="swatch you" style={{ background: hex(settings.color) }} /> Your route
                  {ghost && (<><span className="swatch best" /> {ghostName}</>)}
                </p>
              </div>
            </div>
          )}

          {showTuning && <Tuning config={config} onClose={() => setShowTuning(false)} onEffect={(kind) => bridge.emit('testEffect', kind)} onHurt={() => bridge.emit('testHurt')} onPoints={() => bridge.emit('testPoints')} />}
        </>
      )}
    </RaceView>
  );
}

/** What happened during the run, and the checkpoint times against your best. */
function RunReport({ outcome }: { outcome: Outcome }) {
  const s = outcome.summary;
  const facts: [string, string][] = [
    ['Distance', `${Math.round(s.distance)} tiles`],
    ['Hearts lost', String(s.heartsLost)],
    ['Traps sprung', String(s.trapsSprung)],
    ['Hits', String(s.hits)],
    ['Full map open', `${s.mapSeconds.toFixed(1)}s`],
  ];
  if (s.respawns > 0) facts.splice(2, 0, ['Respawns', String(s.respawns)]);
  const record = outcome.record;
  if (record && record.finishes > 0) facts.push(['Average before', formatTime(record.totalTime / record.finishes)]);
  const bestSplits = outcome.bestSplits;
  return (
    <div className="run-report">
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {s.splits.length > 0 && (
        <table className="splits">
          <tbody>
            <tr>
              <th>Checkpoint</th>
              {s.splits.map((_, i) => <td key={i}>{ordinal(i + 1)}</td>)}
            </tr>
            <tr>
              <th>Time</th>
              {s.splits.map((t, i) => <td key={i}>{formatTime(t)}</td>)}
            </tr>
            {bestSplits && bestSplits.length > 0 && (
              <tr>
                <th>Against best</th>
                {s.splits.map((t, i) => {
                  const b = bestSplits[i];
                  if (b === undefined) return <td key={i}>–</td>;
                  const d = t - b;
                  return <td key={i} className={d <= 0 ? 'good' : 'bad'}>{d <= 0 ? '−' : '+'}{Math.abs(d).toFixed(2)}</td>;
                })}
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
