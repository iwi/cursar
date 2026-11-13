import { type GameMap, MAP_SIZES, type ResultRow, type RoomInfo, type ServerMessage, decodeMap, generateMap, ghostFromRoute, routeDistance } from '@cursar/game-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NetDriver } from '../game/NetDriver';
import type { Connection } from '../net/Connection';
import { addGhost } from '../recordings';
import { recordRace } from '../stats';
import { type Settings, formatTime, loadMaps, saveMap } from '../storage';
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
  // Everyone builds the same map from the seed the server chose, unless the host chose a hand-made map.
  const map = useMemo<GameMap>(() => {
    const made = start.map ? decodeMap(start.map) : null;
    return made?.ok ? made.map : generateMap({ seed: start.seed, size: start.size });
  }, [start]);
  const isHost = room.hostId === connection.id;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';
  const standings = results ? [...results.rows].sort((a, b) => b.pointsTotal - a.pointsTotal) : [];
  const series = start.racesTotal > 1;
  const racing = room.stage === 'race';
  const [ghostSaved, setGhostSaved] = useState<Record<string, 'saved' | 'full'>>({});
  const routeSeconds = start.config.ghost.routeEveryTicks / start.config.tickRate;

  // Your statistics: each results table is counted once.
  const counted = useRef<Results | null>(null);
  useEffect(() => {
    setGhostSaved({});
    if (!results || counted.current === results) return;
    counted.current = results;
    const mine = results.rows.find((row) => row.id === connection.id);
    if (!mine) return;
    recordRace(map, {
      place: mine.place,
      time: mine.time,
      raceSeconds: mine.time ?? (mine.track.length / 2) * routeSeconds,
      distance: routeDistance(mine.track),
    });
  }, [results, connection.id, map, routeSeconds]);

  /** Keeps a runner's route as a ghost to race in solo. */
  const saveGhost = (row: ResultRow) => {
    if (row.time === null) return;
    const ghost = ghostFromRoute(row.track, {
      mapId: map.id,
      mapVersion: map.version,
      playerName: row.name,
      time: row.time,
      intervalMs: routeSeconds * 1000,
    });
    if (!ghost) return;
    // A hand-made map goes into My maps, so the ghost can be raced.
    if (!map.generator && !loadMaps().some((m) => m.id === map.id)) saveMap(map);
    const { saved } = addGhost(map, ghost, 'race');
    setGhostSaved((current) => ({ ...current, [row.id]: saved ? 'saved' : 'full' }));
  };
  const savedAny = Object.values(ghostSaved).includes('saved');

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
                    <th />
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
                      <td>
                        {row.time !== null && row.track.length >= 4 && (
                          ghostSaved[row.id] === 'saved' ? (
                            <span className="tag">Ghost kept</span>
                          ) : ghostSaved[row.id] === 'full' ? (
                            <span className="tag bad">Storage full</span>
                          ) : (
                            <button type="button" className="small" title="Keep this run as a ghost to race in solo" onClick={() => saveGhost(row)}>
                              Keep ghost
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">The lines on the map show the route each runner took.</p>
              {savedAny && (
                <p className="hint">
                  To race a kept ghost, choose this map in the solo menu
                  {map.generator ? ` (${MAP_SIZES[start.size].label}, seed “${start.seed}”)` : ' (it is in My maps)'}, or from Statistics.
                </p>
              )}
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
