import {
  BOT_LEVELS,
  type BotLevel,
  MAP_SIZES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapSize,
  PLAYER_COLORS,
  type RoomInfo,
  type ServerMessage,
} from '@cursar/game-core';
import { useEffect, useState } from 'react';
import { audio } from '../audio/AudioEngine';
import { Connection, type ConnectionStatus } from '../net/Connection';
import type { Settings } from '../storage';
import { NetRace } from './NetRace';
import { hex } from './Race';

type RaceStart = Extract<ServerMessage, { t: 'race' }>;
type Results = Extract<ServerMessage, { t: 'results' }>;

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onExit: () => void;
}

/** Network play: connects to the game server, then shows the lobby or the race. */
export function Multiplayer({ settings, onChange, onExit }: Props) {
  const [connection] = useState(() => new Connection({ name: settings.name, color: settings.color }));
  const [status, setStatus] = useState<ConnectionStatus>(connection.status);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [race, setRace] = useState<RaceStart | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const off = [
      connection.onStatus(setStatus),
      connection.on('room', (message) => {
        setRoom(message.room);
        if (message.room.stage === 'lobby') {
          setRace(null);
          setResults(null);
        }
      }),
      connection.on('race', (message) => {
        setResults(null);
        setRace(message);
      }),
      connection.on('results', setResults),
      connection.on('error', (message) => setError(message.message)),
    ];
    return () => {
      off.forEach((fn) => fn());
      connection.close();
    };
  }, [connection]);

  if (error || status === 'closed') {
    return (
      <main className="menu">
        <div className="menu-card">
          <h2>{error ? 'Could not join' : 'No connection to the game server'}</h2>
          <p className="muted">
            {error ||
              'The game server is not answering. Check that it is still running on the host computer and that you are on the same network.'}
          </p>
          <div className="actions left">
            {!error && <button type="button" className="primary" onClick={() => connection.retry()}>Try again</button>}
            <button type="button" onClick={onExit}>Back to menu</button>
          </div>
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="menu">
        <div className="menu-card"><p className="muted">Connecting to the game server…</p></div>
      </main>
    );
  }

  if (race) {
    return (
      <>
        <NetRace
          key={race.id}
          start={race}
          results={results}
          room={room}
          connection={connection}
          settings={settings}
          onChange={onChange}
          onLeave={onExit}
        />
        {status === 'connecting' && <div className="reconnecting">Connection lost — reconnecting…</div>}
      </>
    );
  }

  return <Lobby room={room} connection={connection} settings={settings} onChange={onChange} onExit={onExit} reconnecting={status === 'connecting'} />;
}

interface LobbyProps extends Props {
  room: RoomInfo;
  connection: Connection;
  reconnecting: boolean;
}

function Lobby({ room, connection, settings, onChange, onExit, reconnecting }: LobbyProps) {
  const me = room.players.find((p) => p.id === connection.id);
  const isHost = room.hostId === connection.id;
  const host = room.players.find((p) => p.id === room.hostId);
  const taken = new Set(room.players.filter((p) => p.id !== connection.id).map((p) => p.color));
  const [name, setName] = useState(me?.name ?? settings.name);
  const [seed, setSeed] = useState(room.settings.seed);
  const [botLevel, setBotLevel] = useState<BotLevel>('normal');
  const waiting = room.stage !== 'lobby';
  const showPoints = room.players.some((p) => p.points > 0);

  const saveName = () => {
    const clean = name.trim();
    if (!clean || !me || clean === me.name) return;
    onChange({ name: clean });
    connection.setProfile({ name: clean, color: me.color });
  };
  const pickColor = (color: number) => {
    if (!me) return;
    onChange({ color });
    connection.setProfile({ name: me.name, color });
  };
  const set = (patch: Partial<RoomInfo['settings']>) => connection.send({ t: 'settings', settings: patch });

  // Where other players should point their browsers.
  const { hostname, port, protocol } = window.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  const links = local ? connection.addresses.map((address) => `${protocol}//${address}${port ? `:${port}` : ''}`) : [window.location.origin];

  return (
    <main className="menu">
      <div className="menu-card lobby">
        <header>
          <h1>Lobby</h1>
          <p>
            {links.length > 0 ? (
              <>Other players on your network join by opening <strong className="address">{links.join('  or  ')}</strong> in a browser.</>
            ) : (
              'Other players join by opening this computer’s network address in a browser.'
            )}
          </p>
        </header>

        {reconnecting && <p className="warning">Connection lost — reconnecting…</p>}
        {waiting && (
          <p className="warning">
            {room.stage === 'race' ? 'A race is in progress. You will join the next one.' : `Waiting for ${host?.name ?? 'the host'} to start the next race.`}
          </p>
        )}

        <section>
          <h3>Players ({room.players.length} of {MAX_PLAYERS})</h3>
          <ul className="players">
            {room.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'away'}>
                <i className="dot" style={{ background: hex(p.color) }} />
                <span className="who">
                  {p.name}
                  {p.id === connection.id && <small> (you)</small>}
                </span>
                {p.id === room.hostId && <span className="tag">Host</span>}
                {p.bot && <span className="tag">Computer · {BOT_LEVELS[p.bot].label}</span>}
                {!p.connected && <span className="tag">Reconnecting</span>}
                {showPoints && <span className="points">{p.points} pts</span>}
                {p.bot && isHost && !waiting && (
                  <button type="button" className="remove" aria-label={`Remove ${p.name}`} onClick={() => connection.send({ t: 'removeBot', id: p.id })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && !waiting && room.players.length < MAX_PLAYERS && (
            <div className="add-bot">
              <select value={botLevel} onChange={(event) => setBotLevel(event.target.value as BotLevel)} aria-label="Computer player level">
                {(Object.keys(BOT_LEVELS) as BotLevel[]).map((level) => (
                  <option key={level} value={level}>{BOT_LEVELS[level].label}</option>
                ))}
              </select>
              <button type="button" onClick={() => connection.send({ t: 'addBot', level: botLevel })}>Add a computer player</button>
            </div>
          )}
        </section>

        <section className="profile">
          <label className="field">
            <span>Your name</span>
            <input
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => event.key === 'Enter' && saveName()}
              spellCheck={false}
            />
          </label>
          <div className="field">
            <span>Your colour</span>
            <div className="swatches">
              {PLAYER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={me?.color === color ? 'chosen' : ''}
                  style={{ background: hex(color) }}
                  disabled={taken.has(color)}
                  aria-label={`Colour ${hex(color)}${taken.has(color) ? ' (taken)' : ''}`}
                  onClick={() => pickColor(color)}
                />
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3>Race settings {!isHost && <small>(chosen by {host?.name ?? 'the host'})</small>}</h3>
          <div className="sizes">
            {(Object.keys(MAP_SIZES) as MapSize[]).map((size) => (
              <label key={size} className={room.settings.size === size ? 'size selected' : 'size'}>
                <input type="radio" name="size" disabled={!isHost || waiting} checked={room.settings.size === size} onChange={() => set({ size })} />
                <strong>{MAP_SIZES[size].label}</strong>
                <span>{MAP_SIZES[size].checkpoints} checkpoints</span>
              </label>
            ))}
          </div>
          <div className="row">
            <label className="field">
              <span>Races in the series</span>
              <select value={room.settings.races} disabled={!isHost || waiting} onChange={(event) => set({ races: Number(event.target.value) })}>
                {[1, 3, 5, 7].map((n) => (
                  <option key={n} value={n}>{n === 1 ? 'Single race' : `${n} races`}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Map seed <small>(blank for random maps)</small></span>
              <input
                value={isHost ? seed : room.settings.seed}
                disabled={!isHost || waiting}
                maxLength={40}
                spellCheck={false}
                placeholder="Random"
                onChange={(event) => setSeed(event.target.value)}
                onBlur={() => set({ seed })}
              />
            </label>
          </div>
        </section>

        {isHost && !waiting ? (
          <button
            type="button"
            className="primary"
            onClick={() => {
              audio.unlock();
              if (seed !== room.settings.seed) set({ seed });
              connection.send({ t: 'start' });
            }}
          >
            {room.settings.races > 1 ? `Start series of ${room.settings.races} races` : 'Start race'}
          </button>
        ) : (
          !waiting && <p className="hint">Waiting for {host?.name ?? 'the host'} to start…</p>
        )}
        <button type="button" onClick={onExit}>Back to menu</button>
      </div>
    </main>
  );
}
