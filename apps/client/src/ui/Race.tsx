import { type GameConfig, type GameMap, type GhostRecording, PLAYER_COLORS } from '@cursar/game-core';
import { useMemo, useState } from 'react';
import { LocalDriver, type LocalResult } from '../game/driver';
import { type Settings, formatTime, loadGhost, saveGhost } from '../storage';
import { RaceView } from './RaceView';
import { Tuning } from './Tuning';

interface Props {
  map: GameMap;
  config: GameConfig;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onRetry: () => void;
  onNewMap: () => void;
  onMenu: () => void;
}

interface Outcome extends LocalResult {
  previousBest: number | null;
  newBest: boolean;
}

/** A single-player race against the clock and the ghost of your best run. */
export function Race({ map, config, settings, onChange, onRetry, onNewMap, onMenu }: Props) {
  const ghost = useMemo<GhostRecording | null>(() => loadGhost(map.id), [map.id]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showTuning, setShowTuning] = useState(false);

  const createDriver = () =>
    new LocalDriver(
      map,
      config,
      ghost,
      (result) => {
        const previousBest = ghost?.time ?? null;
        const newBest = result.finished && result.time !== null && (previousBest === null || result.time < previousBest);
        if (newBest && result.recording) saveGhost(result.recording);
        setOutcome({ ...result, previousBest, newBest });
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
      subtitle={ghost ? `Best ${formatTime(ghost.time)}` : 'No best time yet'}
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
                  <button type="button" onClick={onNewMap}>New map</button>
                  <button type="button" onClick={onMenu}>Menu</button>
                </div>
                <p className="legend">
                  <span className="swatch you" style={{ background: hex(settings.color) }} /> Your route
                  {ghost && (<><span className="swatch best" /> Previous best</>)}
                </p>
              </div>
            </div>
          )}

          {showTuning && <Tuning config={config} onClose={() => setShowTuning(false)} />}
        </>
      )}
    </RaceView>
  );
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
