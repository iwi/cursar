import {
  BOT_LEVELS,
  type BotLevel,
  MAP_SIZES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapSize,
  PLAYER_COLORS,
  ROOM_CODE_LENGTH,
  type RoomInfo,
  type ServerMessage,
  cleanRoomCode,
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

/** The room code in the page address (`?room=BCDF`), if any. */
export function roomFromAddress(): string {
  return cleanRoomCode(new URLSearchParams(window.location.search).get('room'));
}

/** Puts the room code in the page address, so the link can be shared and a reload rejoins; '' removes it. */
function setRoomInAddress(code: string): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

/** Network play: create a room or join one by its code, then the lobby and races. */
export function Multiplayer(props: Props) {
  // undefined: still choosing; null: create a new room; a code: join that room.
  const [target, setTarget] = useState<string | null | undefined>(() => roomFromAddress() || undefined);
  // Someone arriving by a shared link has not clicked anything yet, and browsers only allow sound after a click or key.
  useEffect(() => {
    const unlock = () => {
      audio.unlock();
      audio.setMuted(props.settings.muted);
      audio.setVolume(props.settings.volume);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  const exit = () => {
    setRoomInAddress('');
    props.onExit();
  };
  if (target === undefined) return <ChooseRoom onCreate={() => setTarget(null)} onJoin={setTarget} onExit={exit} />;
  return <Online key={target ?? 'new'} {...props} target={target} onExit={exit} onAnother={() => { setRoomInAddress(''); setTarget(undefined); }} />;
}

function ChooseRoom({ onCreate, onJoin, onExit }: { onCreate: () => void; onJoin: (code: string) => void; onExit: () => void }) {
  const [typed, setTyped] = useState('');
  const code = cleanRoomCode(typed);
  return (
    <main className="menu">
      <div className="menu-card">
        <h1>Play with friends</h1>
        <p className="muted">One of you creates a room and shares its code or link. Everyone else joins with it. Up to {MAX_PLAYERS} players.</p>
        <button type="button" className="primary" onClick={onCreate}>Create a room</button>
        <form
          className="join-code"
          onSubmit={(event) => {
            event.preventDefault();
            if (code) onJoin(code);
          }}
        >
          <label className="field grow">
            <span>Or join with a room code</span>
            <input
              value={typed}
              maxLength={ROOM_CODE_LENGTH + 2}
              placeholder="e.g. BCDF"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value.toUpperCase())}
            />
          </label>
          <button type="submit" disabled={!code}>Join</button>
        </form>
        <button type="button" onClick={onExit}>Back to menu</button>
      </div>
    </main>
  );
}

interface OnlineProps extends Props {
  target: string | null;
  onAnother: () => void;
}

function Online({ settings, onChange, onExit, onAnother, target }: OnlineProps) {
  const [connection] = useState(() => new Connection({ name: settings.name, color: settings.color }, target));
  const [status, setStatus] = useState<ConnectionStatus>(connection.status);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [race, setRace] = useState<RaceStart | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const off = [
      connection.onStatus(setStatus),
      connection.on('welcome', (message) => setRoomInAddress(message.room)),
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
          <h2>{error ? (room ? 'No longer in the room' : 'Could not join') : 'No connection to the game server'}</h2>
          <p className="muted">
            {error || 'The game server is not answering. Check your internet connection, or that the server is still running.'}
          </p>
          <div className="actions left">
            {!error && <button type="button" className="primary" onClick={() => connection.retry()}>Try again</button>}
            {error && <button type="button" className="primary" onClick={onAnother}>Create or join another room</button>}
            <button type="button" onClick={onExit}>Back to menu</button>
          </div>
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="menu">
        <div className="menu-card"><p className="muted">{target ? `Joining room ${target}…` : 'Creating a room…'}</p></div>
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

interface LobbyProps extends Omit<Props, 'onExit'> {
  onExit: () => void;
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
  const people = room.players.filter((p) => !p.bot).length;
  const readyCount = room.players.filter((p) => !p.bot && p.ready).length;

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

  // The link other players open. On "localhost" that only works on this computer, so offer the network addresses instead.
  const { hostname, port, protocol } = window.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  const origins = local ? connection.addresses.map((address) => `${protocol}//${address}${port ? `:${port}` : ''}`) : [window.location.origin];
  const links = origins.map((origin) => `${origin}/?room=${connection.room}`);
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const remove = (player: RoomInfo['players'][number]) => {
    if (player.bot || window.confirm(`Remove ${player.name} from the room? They will not be able to rejoin from the same page.`)) {
      connection.send({ t: 'remove', id: player.id });
    }
  };

  return (
    <main className="menu">
      <div className="menu-card lobby">
        <header>
          <h1>
            Room <span className="room-code">{connection.room}</span>
          </h1>
          <p>
            Other players join with the code <strong>{connection.room}</strong>, or by opening{' '}
            {links.length > 0 ? <strong className="address">{links.join('  or  ')}</strong> : 'this computer’s network address'}.
          </p>
          {links[0] && (
            <button type="button" onClick={() => copy(links[0]!)}>{copied ? 'Link copied' : 'Copy link'}</button>
          )}
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
                {room.stage === 'lobby' && !p.bot && (p.ready ? <span className="tag ready">Ready</span> : <span className="tag choosing">Choosing…</span>)}
                {!p.connected && <span className="tag">Reconnecting</span>}
                {showPoints && <span className="points">{p.points} pts</span>}
                {isHost && p.id !== connection.id && (p.bot ? !waiting : room.stage !== 'race' || !p.inRace) && (
                  <button type="button" className="remove" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}>
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

        {!waiting && me && (
          <section className="ready-row">
            <button type="button" className={me.ready ? 'active' : 'primary'} onClick={() => connection.send({ t: 'lobbyReady', on: !me.ready })}>
              {me.ready ? 'Ready ✓ (click if you are not)' : 'I’m ready'}
            </button>
            <label className="check">
              <input type="checkbox" checked={settings.finishArrow} onChange={(event) => onChange({ finishArrow: event.target.checked })} />
              <span>Show me an arrow toward the nearest checkpoint, then the finish <small>(easier; only for you)</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.vimKeys} onChange={(event) => onChange({ vimKeys: event.target.checked })} />
              <span>Also move with <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> <small>(vim keys)</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.mouseMove} onChange={(event) => onChange({ mouseMove: event.target.checked })} />
              <span>Move with the mouse <small>(click or hold to run towards the pointer; right click stops)</small></span>
            </label>
          </section>
        )}

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

        {isHost && !waiting && (
          <p className="ready-count">
            {readyCount === people ? `Everyone is ready (${readyCount} of ${people})` : `${readyCount} of ${people} ready`}
          </p>
        )}
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
