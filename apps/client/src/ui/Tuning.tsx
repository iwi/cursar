import { EFFECT_KINDS, type EffectKind, type GameConfig } from '@cursar/game-core';
import { useState } from 'react';
import { EFFECT_STYLE, cssColor } from '../game/effects';

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

const EFFECT_SLIDERS: Slider[] = [
  { label: 'Slowed: speed ×', min: 0.2, max: 0.95, step: 0.05, get: (c) => c.effects.slow.speedMul, set: (c, v) => (c.effects.slow.speedMul = v) },
  { label: 'Slowed (seconds)', min: 0.5, max: 8, step: 0.5, get: (c) => c.effects.slow.seconds, set: (c, v) => (c.effects.slow.seconds = v) },
  { label: 'Haste: speed ×', min: 1.05, max: 2, step: 0.05, get: (c) => c.effects.haste.speedMul, set: (c, v) => (c.effects.haste.speedMul = v) },
  { label: 'Haste (seconds)', min: 0.5, max: 10, step: 0.5, get: (c) => c.effects.haste.seconds, set: (c, v) => (c.effects.haste.seconds = v) },
  { label: 'Stunned (seconds)', min: 0.2, max: 3, step: 0.1, get: (c) => c.effects.stun.seconds, set: (c, v) => (c.effects.stun.seconds = v) },
  { label: 'Reversed (seconds)', min: 0.3, max: 4, step: 0.1, get: (c) => c.effects.reversed.seconds, set: (c, v) => (c.effects.reversed.seconds = v) },
  { label: 'Confused (seconds)', min: 0.3, max: 4, step: 0.1, get: (c) => c.effects.confused.seconds, set: (c, v) => (c.effects.confused.seconds = v) },
  { label: 'Blinded: vision ×', min: 0.15, max: 0.9, step: 0.05, get: (c) => c.effects.blind.visionMul, set: (c, v) => (c.effects.blind.visionMul = v) },
  { label: 'Blinded (seconds)', min: 0.5, max: 10, step: 0.5, get: (c) => c.effects.blind.seconds, set: (c, v) => (c.effects.blind.seconds = v) },
  { label: 'Guard after loss of control (s)', min: 0, max: 4, step: 0.1, get: (c) => c.effects.controlGuardSeconds, set: (c, v) => (c.effects.controlGuardSeconds = v) },
];

/**
 * Live gameplay tuning. It edits the running race's config object directly, so
 * changes are felt immediately and last until the page is reloaded.
 */
export function Tuning({
  config,
  onClose,
  onEffect,
  onHurt,
}: {
  config: GameConfig;
  onClose: () => void;
  /** Puts an effect on the runner, to try it during a race. */
  onEffect: (kind: EffectKind) => void;
  /** Takes a heart from the runner, to try health and respawning. */
  onHurt: () => void;
}) {
  const [, refresh] = useState(0);
  const [copied, setCopied] = useState(false);
  const slider = (s: Slider) => (
    <label key={s.label}>
      <span>{s.label}</span>
      <output>{Math.round(s.get(config) * 100) / 100}</output>
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={s.step}
        value={s.get(config)}
        onChange={(event) => {
          s.set(config, Number(event.target.value));
          refresh((n) => n + 1);
        }}
      />
    </label>
  );

  return (
    <aside className="tuning">
      <header>
        <strong>Tuning</strong>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      {SLIDERS.map(slider)}
      <h3>Effects</h3>
      <div className="effect-buttons">
        {EFFECT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            style={{ borderLeftColor: cssColor(EFFECT_STYLE[kind].color) }}
            // Keep keyboard focus on the race, so steering carries on after a click.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onEffect(kind)}
          >
            {EFFECT_STYLE[kind].label}
          </button>
        ))}
      </div>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onHurt}>
        Lose a heart
      </button>
      <small>Try an effect during a race. Losing your last heart sends you back to the last checkpoint you touched. Stunned, Reversed and Confused cannot follow one another straight away (the guard).</small>
      {EFFECT_SLIDERS.map(slider)}
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
