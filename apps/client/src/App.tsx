import { type GameConfig, type GameMap, cloneConfig, generateMap } from '@cursar/game-core';
import { useMemo, useState } from 'react';
import { audio } from './audio/AudioEngine';
import { type Settings, loadMaps, loadSettings, randomSeed, saveSettings } from './storage';
import { Editor } from './ui/Editor';
import { Menu } from './ui/Menu';
import { Multiplayer, roomFromAddress } from './ui/Multiplayer';
import { Race } from './ui/Race';

/** The editor's open map, kept while a test race runs so the editor comes back as it was. */
interface Editing {
  map: GameMap | null;
  savedId: string | null;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const loaded = loadSettings();
    return loaded.seed ? loaded : { ...loaded, seed: randomSeed() };
  });
  const [racing, setRacing] = useState<{ map: GameMap; attempt: number; custom: boolean } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Opening a shared room link goes straight to that room.
  const [online, setOnline] = useState(() => roomFromAddress() !== '');
  // One config object for the session, so live tuning carries over between races.
  const config = useMemo<GameConfig>(() => cloneConfig(), []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    audio.setMuted(next.muted);
    audio.setVolume(next.volume);
    return next;
  };

  const unlockAudio = (from: Settings) => {
    audio.unlock();
    audio.setMuted(from.muted);
    audio.setVolume(from.volume);
  };

  /** Races the chosen map: a saved hand-made one, or the generated one for the seed and size. */
  const start = (from: Settings = settings) => {
    unlockAudio(from);
    const custom = from.mapId ? loadMaps().find((m) => m.id === from.mapId) : undefined;
    const map = custom ?? generateMap({ seed: from.seed.trim() || 'cursar', size: from.size });
    setRacing((current) => ({ map, attempt: (current?.attempt ?? 0) + 1, custom: Boolean(custom) }));
  };

  /** Races the map open in the editor. */
  const testRace = (map: GameMap) => {
    unlockAudio(settings);
    setRacing((current) => ({ map, attempt: (current?.attempt ?? 0) + 1, custom: true }));
  };

  if (online) return <Multiplayer settings={settings} onChange={update} onExit={() => setOnline(false)} />;

  if (racing) {
    const fromEditor = editing !== null;
    return (
      <Race
        key={racing.attempt}
        map={racing.map}
        config={config}
        settings={settings}
        onChange={update}
        onRetry={() => (fromEditor ? testRace(racing.map) : start())}
        onNewMap={racing.custom ? undefined : () => start(update({ seed: randomSeed() }))}
        onMenu={() => setRacing(null)}
        menuLabel={fromEditor ? 'Back to the editor' : 'Menu'}
      />
    );
  }

  if (editing) {
    return (
      <Editor
        initial={editing.map}
        savedId={editing.savedId}
        onTest={(map, savedId) => {
          setEditing({ map, savedId });
          testRace(map);
        }}
        onExit={() => setEditing(null)}
      />
    );
  }

  return (
    <Menu
      settings={settings}
      onChange={update}
      onStart={() => start()}
      onEditor={(map) => setEditing({ map, savedId: map?.id ?? null })}
      onMultiplayer={() => {
        unlockAudio(settings);
        setOnline(true);
      }}
    />
  );
}
