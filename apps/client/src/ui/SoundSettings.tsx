import { audio } from '../audio/AudioEngine';
import type { Settings } from '../storage';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** Sound on or off, with separate volumes for the gameplay sounds and the music. */
export function SoundSettings({ settings, onChange }: Props) {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const slide = (key: 'volume' | 'musicVolume') => (event: React.ChangeEvent<HTMLInputElement>) => {
    audio.unlock();
    onChange({ [key]: Number(event.target.value) / 100 });
  };
  return (
    <fieldset className="sound">
      <label className="check">
        <input type="checkbox" checked={!settings.muted} onChange={(event) => onChange({ muted: !event.target.checked })} />
        <span>Sound</span>
      </label>
      <label className={settings.muted ? 'volume off' : 'volume'}>
        <span>Sounds</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(settings.volume * 100)}
          disabled={settings.muted}
          onChange={slide('volume')}
          // A sample when you let go, so you can judge the level.
          onPointerUp={() => audio.checkpoint(1)}
          onKeyUp={() => audio.checkpoint(1)}
          aria-valuetext={percent(settings.volume)}
        />
        <output>{percent(settings.volume)}</output>
      </label>
      <label className={settings.muted ? 'volume off' : 'volume'}>
        <span>Music</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(settings.musicVolume * 100)}
          disabled={settings.muted}
          onChange={slide('musicVolume')}
          aria-valuetext={settings.musicVolume === 0 ? 'off' : percent(settings.musicVolume)}
        />
        <output>{settings.musicVolume === 0 ? 'Off' : percent(settings.musicVolume)}</output>
      </label>
    </fieldset>
  );
}
