import type { GameMap } from '@cursar/game-core';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/AudioEngine';
import { Bridge, type HudState } from '../game/bridge';
import { createGame } from '../game/createGame';
import type { RaceDriver } from '../game/driver';
import { EFFECT_STYLE, cssColor } from '../game/effects';
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
          {hud && phase === 'racing' && !hud.spectating && !quiet && (hud.points > 0 || hud.threat > 0) && (
            <div className="goal purse">
              <span className="coin" /> {hud.points} {hud.points === 1 ? 'point' : 'points'}
              {hud.threat > 0 && <span className="threat">Threat {hud.threat}</span>}
            </div>
          )}
        </div>
        <div className="hud-buttons">
          {phase === 'racing' && hud && !hud.spectating && (
            <button
              type="button"
              className={hud.mapOpen ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => bridge.emit('toggleMap')}
            >
              {hud.mapOpen ? 'Close map (M)' : 'Map (M)'}
            </button>
          )}
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
          {hud.offer && (
            <div className="cards" role="group" aria-label="Skill cards">
              {hud.offer.map((card, slot) => (
                <button
                  key={card.id}
                  type="button"
                  className={card.affordable ? 'card' : 'card dim'}
                  disabled={!card.affordable}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => bridge.emit('pick', slot)}
                >
                  <kbd>{slot + 1}</kbd>
                  <strong>{card.name}</strong>
                  <span>{card.text}</span>
                  <small>
                    {card.cost} {card.cost === 1 ? 'point' : 'points'} · threat +{card.threat}
                  </small>
                </button>
              ))}
            </div>
          )}
          <div className="hearts" aria-label={`${hud.health} of ${hud.healthMax} hearts`}>
            {Array.from({ length: hud.healthMax }, (_, i) => (
              <i key={i} className={i < hud.health ? 'full' : ''}>♥</i>
            ))}
          </div>
          {hud.effects.length > 0 && (
            <div className="effects">
              {hud.effects.map((effect) => (
                <span key={effect.kind} className="effect" style={{ borderColor: cssColor(EFFECT_STYLE[effect.kind].color) }}>
                  {EFFECT_STYLE[effect.kind].label}
                  <i style={{ width: `${Math.round((effect.left / effect.total) * 100)}%`, background: cssColor(EFFECT_STYLE[effect.kind].color) }} />
                </span>
              ))}
            </div>
          )}
          <div className={hud.exhausted ? 'stamina exhausted' : 'stamina'} aria-label="Stamina">
            <div style={{ width: `${Math.round(hud.stamina * 100)}%` }} />
          </div>
          <span>{hud.exhausted ? 'Out of breath' : hud.terrain === 'Floor' ? 'Stamina' : `On ${hud.terrain.toLowerCase()}`}</span>
        </div>
      )}

      {phase === 'racing' && hud?.mapOpen && (
        <div className="banner map-banner">
          <strong>Full map — you are standing still</strong>
          <span>The clock and the others keep going. Press M to close it.</span>
        </div>
      )}

      {notice && <div className="notice" key={notice.id}>{notice.text}</div>}

      {children?.(hud, bridge)}
    </div>
  );
}
