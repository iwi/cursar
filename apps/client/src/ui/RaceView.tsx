import type { GameMap } from '@cursar/game-core';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/AudioEngine';
import { Bridge, type HudState } from '../game/bridge';
import { createGame } from '../game/createGame';
import type { RaceDriver } from '../game/driver';
import { type Settings, formatTime } from '../storage';

interface Props {
  map: GameMap;
  /** Builds the driver for this race. Called once, when the view mounts. */
  createDriver: () => RaceDriver;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  title: string;
  subtitle: string;
  /** Extra buttons for the top-right corner. */
  buttons?: ReactNode;
  /** Hides the checkpoint counter (when a results panel covers it). */
  quiet?: boolean;
  onRestartKey?: () => void;
  /** Overlays drawn above the race: pause, results and so on. */
  children?: (hud: HudState | null, bridge: Bridge) => ReactNode;
}

/** The race canvas with its HUD. Shared by single player and network play. */
export function RaceView({ map, createDriver, settings, onChange, title, subtitle, buttons, quiet, onRestartKey, children }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bridge = useMemo(() => new Bridge(), []);
  const [hud, setHud] = useState<HudState | null>(null);
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const restart = useRef(onRestartKey);
  restart.current = onRestartKey;

  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).has('demo');
    const game = createGame(host.current!, { map, driver: createDriver(), finishArrow: settings.finishArrow, bridge, audio, demo });
    const offHud = bridge.on('hud', setHud);
    const offRestart = bridge.on('restart', () => restart.current?.());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offNotice = bridge.on('notice', (text) => {
      setNotice({ text, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 4000);
    });
    return () => {
      offHud();
      offRestart();
      offNotice();
      clearTimeout(timer);
      game.destroy(true);
    };
    // A race is rebuilt by remounting this component (with a new `key`), never by changing props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = hud?.phase ?? 'preview';
  const markersLeft = hud ? hud.markersMax - hud.markersPlaced : 0;
  const checkpointsLeft = hud ? hud.checkpointsTotal - hud.checkpointsDone : 0;
  const lowTime = phase === 'racing' && hud !== null && !hud.spectating && hud.timeLeft <= 30;
  const readiness = hud?.readiness ?? null;

  return (
    <div className="race">
      <div ref={host} className="canvas-host" />

      <div className="hud-top">
        <div className="hud-map">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="clock">
          <div className={lowTime ? 'timer low' : 'timer'}>{formatTime(hud?.raceTime ?? 0)}</div>
          {hud && hud.checkpointsTotal > 0 && phase === 'racing' && !hud.spectating && !quiet && (
            <div className={checkpointsLeft === 0 ? 'goal open' : 'goal'}>
              {Array.from({ length: hud.checkpointsTotal }, (_, i) => (
                <i key={i} className={i < hud.checkpointsDone ? 'done' : ''} />
              ))}
              <span>{checkpointsLeft === 0 ? 'Finish open' : `${hud.checkpointsDone} of ${hud.checkpointsTotal} checkpoints`}</span>
            </div>
          )}
          {lowTime && hud && !quiet && <div className="goal low">{Math.ceil(hud.timeLeft)}s left</div>}
        </div>
        <div className="hud-buttons">
          <button type="button" onClick={() => onChange({ muted: !settings.muted })}>{settings.muted ? 'Sound off' : 'Sound on'}</button>
          {buttons}
        </div>
      </div>

      {phase === 'preview' && hud && (
        <div className="banner">
          <strong>Memorise the map — {Math.ceil(hud.phaseTime)}s</strong>
          <span>
            Touch all {hud.checkpointsTotal} pink checkpoints in any order, then reach the chequered finish. You are the pulsing runner.{' '}
            {markersLeft > 0
              ? `Click the map to drop ${markersLeft} more waypoint${markersLeft === 1 ? '' : 's'}.`
              : 'All waypoints placed (right-click removes the last).'}
          </span>
          {readiness?.mine ? (
            <em>Waiting for the others — {readiness.ready} of {readiness.total} ready</em>
          ) : (
            <button type="button" onClick={() => bridge.emit('skipPreview')}>
              I’m ready (Enter){readiness && readiness.total > 1 ? ` — ${readiness.ready} of ${readiness.total} ready` : ''}
            </button>
          )}
        </div>
      )}

      {phase === 'countdown' && hud && <div className="count" key={Math.ceil(hud.phaseTime)}>{Math.ceil(hud.phaseTime)}</div>}
      {phase === 'racing' && hud && hud.resumeTime > 0 && !hud.paused && (
        <div className="count" key={`resume-${Math.ceil(hud.resumeTime)}`}>{Math.ceil(hud.resumeTime)}</div>
      )}

      {phase === 'racing' && hud && !hud.spectating && (
        <div className="hud-bottom">
          <div className={hud.exhausted ? 'stamina exhausted' : 'stamina'} aria-label="Stamina">
            <div style={{ width: `${Math.round(hud.stamina * 100)}%` }} />
          </div>
          <span>{hud.exhausted ? 'Out of breath' : hud.terrain === 'Floor' ? 'Stamina' : `On ${hud.terrain.toLowerCase()}`}</span>
        </div>
      )}

      {notice && <div className="notice" key={notice.id}>{notice.text}</div>}

      {children?.(hud, bridge)}
    </div>
  );
}
