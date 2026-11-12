import type { GameConfig } from '@cursar/game-core';
import { useState } from 'react';

interface Slider {
  label: string;
  min: number;
  max: number;
  step: number;
  get: (c: GameConfig) => number;
  set: (c: GameConfig, v: number) => void;
}

const SLIDERS: Slider[] = [
  { label: 'Top speed (tiles/s)', min: 3, max: 9, step: 0.1, get: (c) => c.player.maxSpeed, set: (c, v) => (c.player.maxSpeed = v) },
  { label: 'Acceleration', min: 5, max: 80, step: 1, get: (c) => c.player.accel, set: (c, v) => (c.player.accel = v) },
  { label: 'Braking', min: 5, max: 100, step: 1, get: (c) => c.player.decel, set: (c, v) => (c.player.decel = v) },
  { label: 'Turn rate (rad/s)', min: 3, max: 30, step: 0.5, get: (c) => c.player.turnRate, set: (c, v) => (c.player.turnRate = v) },
  { label: 'Sprint speed ×', min: 1.1, max: 2, step: 0.05, get: (c) => c.sprint.speedMul, set: (c, v) => (c.sprint.speedMul = v) },
  { label: 'Sprint drain /s', min: 5, max: 60, step: 1, get: (c) => c.sprint.drainPerSec, set: (c, v) => (c.sprint.drainPerSec = v) },
  { label: 'Stamina regen /s', min: 4, max: 40, step: 1, get: (c) => c.sprint.regenPerSec, set: (c, v) => (c.sprint.regenPerSec = v) },
  { label: 'Vision ahead (tiles)', min: 3, max: 14, step: 0.5, get: (c) => c.vision.ahead, set: (c, v) => (c.vision.ahead = v) },
  { label: 'Vision to the side', min: 2, max: 8, step: 0.5, get: (c) => c.vision.side, set: (c, v) => (c.vision.side = v) },
  { label: 'Vision behind', min: 1, max: 6, step: 0.5, get: (c) => c.vision.back, set: (c, v) => (c.vision.back = v) },
  { label: 'Memory (seconds)', min: 0, max: 120, step: 5, get: (c) => c.vision.memorySeconds, set: (c, v) => (c.vision.memorySeconds = v) },
];

/**
 * Live gameplay tuning. It edits the running race's config object directly, so
 * changes are felt immediately and last until the page is reloaded.
 */
export function Tuning({ config, onClose }: { config: GameConfig; onClose: () => void }) {
  const [, refresh] = useState(0);
  const [copied, setCopied] = useState(false);

  return (
    <aside className="tuning">
      <header>
        <strong>Tuning</strong>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      {SLIDERS.map((slider) => (
        <label key={slider.label}>
          <span>{slider.label}</span>
          <output>{slider.get(config)}</output>
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={slider.get(config)}
            onChange={(event) => {
              slider.set(config, Number(event.target.value));
              refresh((n) => n + 1);
            }}
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(JSON.stringify(config, null, 2)).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy values'}
      </button>
      <small>Applies immediately. Send me the copied values you like and I will make them the defaults.</small>
    </aside>
  );
}
