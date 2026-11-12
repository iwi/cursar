import { type GameConfig, type GameMap, cloneConfig, generateMap } from '@cursar/game-core';
import { useMemo, useState } from 'react';
import { audio } from './audio/AudioEngine';
import { type Settings, loadSettings, randomSeed, saveSettings } from './storage';
import { Menu } from './ui/Menu';
import { Multiplayer } from './ui/Multiplayer';
import { Race } from './ui/Race';

export function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const loaded = loadSettings();
    return loaded.seed ? loaded : { ...loaded, seed: randomSeed() };
  });
  const [racing, setRacing] = useState<{ map: GameMap; attempt: number } | null>(null);
  const [online, setOnline] = useState(false);
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

  const start = (from: Settings = settings) => {
    audio.unlock();
    audio.setMuted(from.muted);
    audio.setVolume(from.volume);
    const map = generateMap({ seed: from.seed.trim() || 'cursar', size: from.size });
    setRacing((current) => ({ map, attempt: (current?.attempt ?? 0) + 1 }));
  };

  if (online) return <Multiplayer settings={settings} onChange={update} onExit={() => setOnline(false)} />;

  if (!racing) {
    return (
      <Menu
        settings={settings}
        onChange={update}
        onStart={() => start()}
        onMultiplayer={() => {
          audio.unlock();
          audio.setMuted(settings.muted);
          audio.setVolume(settings.volume);
          setOnline(true);
        }}
      />
    );
  }

  return (
    <Race
      key={racing.attempt}
      map={racing.map}
      config={config}
      settings={settings}
      onChange={update}
      onRetry={() => start()}
      onNewMap={() => start(update({ seed: randomSeed() }))}
      onMenu={() => setRacing(null)}
    />
  );
}
