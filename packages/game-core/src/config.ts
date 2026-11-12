/**
 * All gameplay tuning lives here. Units: distance in tiles, time in seconds,
 * angles in radians. Nothing in the engine hard-codes these numbers, so a game
 * mode (or the in-game tuning panel) can override any of them.
 */
export interface GameConfig {
  tickRate: number;
  player: {
    /** Collision radius. Kept well under half a tile so 1-tile gaps are passable. */
    radius: number;
    maxSpeed: number;
    accel: number;
    decel: number;
    /** How fast the facing direction swings round to the movement direction. */
    turnRate: number;
    /** Distance between footsteps (drives footstep sounds and footprints). */
    strideLength: number;
  };
  sprint: {
    speedMul: number;
    staminaMax: number;
    drainPerSec: number;
    regenPerSec: number;
    /** Pause after sprinting before stamina starts to come back. */
    regenDelay: number;
    /** After running dry, sprint stays locked until stamina is back above this. */
    recoverThreshold: number;
  };
  vision: {
    ahead: number;
    side: number;
    back: number;
    /** How long a seen tile stays dimly remembered. 0 = no memory. */
    memorySeconds: number;
  };
  race: {
    previewBaseSeconds: number;
    /** Extra preview time per map tile, so bigger maps get longer previews. */
    previewSecondsPerTile: number;
    previewMaxSeconds: number;
    countdownSeconds: number;
    timeLimitSeconds: number;
    /** Once the first player finishes, the rest have this long. */
    finishGraceSeconds: number;
  };
  markers: {
    /** Waypoints a player may drop on the map during the preview. */
    max: number;
    reachRadius: number;
  };
  footprints: {
    lifetimeSeconds: number;
    max: number;
  };
  ghost: {
    /** Record one sample every N ticks (3 ticks at 60 Hz = 50 ms). */
    sampleEveryTicks: number;
  };
}

export const DEFAULT_CONFIG: GameConfig = {
  tickRate: 60,
  player: { radius: 0.3, maxSpeed: 5.5, accel: 40, decel: 50, turnRate: 12, strideLength: 0.85 },
  sprint: {
    speedMul: 1.45,
    staminaMax: 100,
    drainPerSec: 30,
    regenPerSec: 16,
    regenDelay: 0.7,
    recoverThreshold: 25,
  },
  vision: { ahead: 8, side: 4, back: 2, memorySeconds: 25 },
  race: {
    previewBaseSeconds: 4,
    previewSecondsPerTile: 1 / 260,
    previewMaxSeconds: 30,
    countdownSeconds: 3,
    timeLimitSeconds: 420,
    finishGraceSeconds: 30,
  },
  markers: { max: 3, reachRadius: 1.5 },
  footprints: { lifetimeSeconds: 20, max: 80 },
  ghost: { sampleEveryTicks: 3 },
};

export function cloneConfig(config: GameConfig = DEFAULT_CONFIG): GameConfig {
  return JSON.parse(JSON.stringify(config)) as GameConfig;
}

export const ENGINE_VERSION = '0.1.0';
