import { type GameMap, type RoomInfo, type ServerMessage, generateMap } from '@cursar/game-core';
import { useEffect, useMemo } from 'react';
import { NetDriver } from '../game/NetDriver';
import type { Connection } from '../net/Connection';
import { type Settings, formatTime } from '../storage';
import { hex } from './Race';
import { RaceView } from './RaceView';

type RaceStart = Extract<ServerMessage, { t: 'race' }>;
type Results = Extract<ServerMessage, { t: 'results' }>;

interface Props {
  start: RaceStart;
  results: Results | null;
  room: RoomInfo;
  connection: Connection;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onLeave: () => void;
}

/** A race run by the server, plus the results table and the host's controls between races. */
export function NetRace({ start, results, room, connection, settings, onChange, onLeave }: Props) {
  // Everyone builds the same map from the seed the server chose.
  const map = useMemo<GameMap>(() => generateMap({ seed: start.seed, size: start.size }), [start.seed, start.size]);
  const isHost = room.hostId === connection.id;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  const standings = results ? [...results.rows].sort((a, b) => b.pointsTotal - a.pointsTotal) : [];
  const series = start.racesTotal > 1;
  const racing = room.stage === 'race';

  // The host can freeze the race for everyone with Esc.
  useEffect(() => {
    if (!isHost || !racing) return;
    let paused = false;
    const off = connection.on('snap', (snapshot) => (paused = snapshot.paused));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') connection.send({ t: 'pause', on: !paused });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, [connection, isHost, racing]);

  return (
    <RaceView
      map={map}
      createDriver={() => new NetDriver(map, start, connection)}
      settings={settings}
      onChange={onChange}
      title={series ? `Race ${start.raceNumber} of ${start.racesTotal}` : 'Race'}
      subtitle={`${start.runners.length} runner${start.runners.length === 1 ? '' : 's'}`}
      quiet={results !== null}
      buttons={
        <>
          {isHost && racing && <button type="button" onClick={() => connection.send({ t: 'pause', on: true })}>Pause (Esc)</button>}
          <button type="button" onClick={onLeave}>Leave</button>
        </>
      }
    >
      {(hud) => (
        <>
          {hud?.paused && !results && (
            <div className="overlay">
              <div className="panel">
                <h2>Paused{isHost ? '' : ` by ${hostName}`}</h2>
                {isHost ? (
                  <>
                    <p className="delta">The race is frozen for everyone.</p>
                    <div className="actions">
                      <button type="button" className="primary" onClick={() => connection.send({ t: 'pause', on: false })} autoFocus>Resume</button>
                      <button type="button" onClick={() => connection.send({ t: 'restart' })}>Restart this race</button>
                      <button type="button" onClick={() => connection.send({ t: 'lobby' })}>Cancel and go to the lobby</button>
                    </div>
                  </>
                ) : (
                  <p className="delta">The race is frozen for everyone until {hostName} resumes it.</p>
                )}
              </div>
            </div>
          )}

          {hud?.spectating && !results && !hud.paused && (
            <div className="banner">
              <strong>You finished in {formatTime(hud.raceTime)}</strong>
              <span>Watching the others. The race ends in {Math.max(0, Math.ceil(hud.timeLeft))}s.</span>
            </div>
          )}

          {results && (
            <aside className="standings">
              <h2>
                {results.seriesOver && series
                  ? `${standings[0]?.name ?? 'Nobody'} wins the series`
                  : series
                    ? `Race ${results.raceNumber} of ${results.racesTotal}`
                    : 'Results'}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Runner</th>
                    <th>Time</th>
                    <th>Points</th>
                    {series && <th>Total</th>}
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((row) => (
                    <tr key={row.id} className={row.id === connection.id ? 'me' : ''}>
                      <td>{row.place ?? '–'}</td>
                      <td>
                        <i className="dot" style={{ background: hex(row.color) }} />
                        {row.name}
                      </td>
                      <td>{row.time !== null ? formatTime(row.time) : `Did not finish (${row.checkpoints}/${map.checkpoints.length})`}</td>
                      <td>+{row.pointsGained}</td>
                      {series && <td>{row.pointsTotal}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">The lines on the map show the route each runner took.</p>
              {isHost ? (
                <div className="actions">
                  <button type="button" className="primary" onClick={() => connection.send({ t: 'start' })} autoFocus>
                    {results.seriesOver ? (series ? 'New series' : 'Race again') : 'Next race'}
                  </button>
                  <button type="button" onClick={() => connection.send({ t: 'lobby' })}>Back to lobby</button>
                </div>
              ) : (
                <p className="waiting">Waiting for {hostName} to start the next race…</p>
              )}
            </aside>
          )}
        </>
      )}
    </RaceView>
  );
}
