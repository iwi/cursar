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
    /** After a pause, a short count before play continues, so nobody is caught mid-sprint. */
    resumeCountdownSeconds: number;
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
  /** Moving obstacles. Where they are comes from the map; how they move is set here. */
  obstacles: {
    boulder: { radius: number; speed: number };
    /** `armLength` is from the post to each end of the bar. */
    barrier: { armLength: number; thickness: number; turnSeconds: number };
    gate: { openSeconds: number; closedSeconds: number };
    /** Hearts lost when a boulder or barrier hits you, or a gate closes on you. */
    hitDamage: number;
    hitStunSeconds: number;
    /** Speed you are shoved away at. */
    knockSpeed: number;
    /** After a hit, obstacles pass through you for this long, so one cannot hit you twice in a row. */
    hitGuardSeconds: number;
  };
  /** Hidden traps, one tile each, placed by the map. */
  traps: {
    /** A sprung trap is safe for this long, then arms again. */
    rearmSeconds: number;
    /** In the race an armed trap is only seen within this distance (tiles). Always shown in the preview. */
    revealDistance: number;
    /** An armed trap makes a faint sound within this distance (tiles). */
    tellDistance: number;
    spikesDamage: number;
    snareStunSeconds: number;
    glueSlowSeconds: number;
    flashBlindSeconds: number;
    /** Reversed controls from a trick tile. */
    reverseSeconds: number;
    /** Confused controls from a trick tile. */
    confuseSeconds: number;
  };
  /** Enemies. Where they live comes from the map. */
  enemies: {
    /** Touching one costs a heart and shoves you. */
    patroller: { radius: number; speed: number };
    chaser: {
      radius: number;
      speed: number;
      /** Wakes when a runner it can see comes this close. */
      wakeRange: number;
      /** Keeps chasing while it can see its runner within this distance. */
      sightRange: number;
      /** After losing sight, carries on to where it last saw them for this long, then goes home. */
      giveUpSeconds: number;
      /** After catching someone, ignores runners for this long. */
      restSeconds: number;
      /** Catching costs a heart and this much stun. */
      stunSeconds: number;
    };
    turret: {
      range: number;
      turnRate: number;
      /** The whir before it fires. */
      chargeSeconds: number;
      reloadSeconds: number;
      boltSpeed: number;
      boltRadius: number;
      /** A bolt slows you for this long (no heart lost). */
      slowSeconds: number;
    };
    /** Enemy sounds carry this far (tiles). */
    hearingRange: number;
  };
  treasures: {
    /** Collected within this distance (tiles) of its centre. */
    reach: number;
    pointsEach: number;
  };
  /** Skill strengths; the deck itself (costs, threat) is `SKILLS` in sim/skills.ts. */
  skills: {
    /** Trap sense: a trap stepped on springs only if the runner is still on it after this long (seconds). */
    trapSenseDelaySeconds: number;
    /** Footing multiplies how much mud slows you and how much grip mud and ice take away. */
    footingMul: number;
    /** Homing sense: the checkpoint arrow shows for this long after touching a checkpoint (seconds). */
    homingSeconds: number;
    deepLungsDrainMul: number;
    deepLungsRegenMul: number;
    /** Steady multiplies how long loss of control lasts. */
    steadyMul: number;
    /** Reveal: on touching a checkpoint, hazards within `range` tiles show for `seconds`. */
    reveal: { seconds: number; range: number };
  };
  /** The shove (Space): everyone has it. */
  combat: {
    /** How far beyond touching (tiles, edge to edge) a shove reaches. */
    reach: number;
    /** Half the angle of the shove's cone in front of the runner (radians). */
    arc: number;
    staminaCost: number;
    cooldownSeconds: number;
    /** Speed a shoved rival is sent off at (tiles a second); they slide about 2 tiles. */
    knockSpeed: number;
    rivalStunSeconds: number;
    /** A shoved chaser is stunned this long, then walks home to rest. */
    chaserStunSeconds: number;
  };
  /** What threat (the sum of a runner's cards' threat) does. Enemies also prefer the highest-threat runner in sight. */
  threat: {
    /** Traps catch you this much further beyond their tile per threat point, up to the max (a brush). */
    trapReachPerThreat: number;
    trapReachMax: number;
    /** Chasers wake this much further off per threat point, up to the max. */
    wakeRangePerThreat: number;
    wakeRangeMax: number;
  };
  health: {
    /** Hearts a runner starts with, and gets back at each new checkpoint. */
    hearts: number;
    /** After respawning, the runner is safe from harm for this long. */
    respawnSafeSeconds: number;
  };
  /**
   * Temporary effects on a runner, applied by hazards, traps and skills.
   * `seconds` is how long each lasts unless whatever applies it says otherwise.
   */
  effects: {
    slow: { seconds: number; speedMul: number };
    haste: { seconds: number; speedMul: number };
    /** Cannot move at all; the runner slides to a stop. Loss of control. */
    stun: { seconds: number };
    /** Controls point the opposite way. Loss of control. */
    reversed: { seconds: number };
    /** Controls are turned a quarter turn. Loss of control. */
    confused: { seconds: number };
    /** Vision shrinks to this share of its normal size, and remembered tiles are hidden. */
    blind: { seconds: number; visionMul: number };
    /** After a loss-of-control effect ends, no new one can start for this long. */
    controlGuardSeconds: number;
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
    resumeCountdownSeconds: 3,
    timeLimitSeconds: 420,
    finishGraceSeconds: 30,
  },
  markers: { max: 3, reachRadius: 1.5 },
  footprints: { lifetimeSeconds: 20, max: 80 },
  ghost: { sampleEveryTicks: 3 },
  obstacles: {
    boulder: { radius: 0.9, speed: 3 },
    barrier: { armLength: 2, thickness: 0.3, turnSeconds: 4 },
    gate: { openSeconds: 3, closedSeconds: 2.5 },
    hitDamage: 1,
    hitStunSeconds: 0.5,
    knockSpeed: 6,
    hitGuardSeconds: 1,
  },
  traps: {
    rearmSeconds: 10,
    revealDistance: 2,
    tellDistance: 2.5,
    spikesDamage: 1,
    snareStunSeconds: 1,
    glueSlowSeconds: 4,
    flashBlindSeconds: 5,
    reverseSeconds: 2,
    confuseSeconds: 1,
  },
  enemies: {
    patroller: { radius: 0.35, speed: 2 },
    chaser: { radius: 0.4, speed: 3.96, wakeRange: 5, sightRange: 10, giveUpSeconds: 2, restSeconds: 3, stunSeconds: 0.8 },
    turret: { range: 9, turnRate: 2.5, chargeSeconds: 0.8, reloadSeconds: 2.5, boltSpeed: 6, boltRadius: 0.2, slowSeconds: 3 },
    hearingRange: 12,
  },
  treasures: { reach: 0.7, pointsEach: 1 },
  skills: {
    trapSenseDelaySeconds: 0.5,
    footingMul: 0.5,
    homingSeconds: 5,
    deepLungsDrainMul: 0.7,
    deepLungsRegenMul: 1.3,
    steadyMul: 0.5,
    reveal: { seconds: 5, range: 8 },
  },
  combat: { reach: 0.8, arc: 1.2, staminaCost: 25, cooldownSeconds: 1.5, knockSpeed: 14, rivalStunSeconds: 0.5, chaserStunSeconds: 1.5 },
  threat: { trapReachPerThreat: 0.05, trapReachMax: 0.3, wakeRangePerThreat: 0.5, wakeRangeMax: 3 },
  health: { hearts: 3, respawnSafeSeconds: 2 },
  effects: {
    slow: { seconds: 3, speedMul: 0.6 },
    haste: { seconds: 4, speedMul: 1.3 },
    stun: { seconds: 0.8 },
    reversed: { seconds: 2 },
    confused: { seconds: 1 },
    blind: { seconds: 6, visionMul: 0.2 },
    controlGuardSeconds: 1.5,
  },
};

export function cloneConfig(config: GameConfig = DEFAULT_CONFIG): GameConfig {
  return JSON.parse(JSON.stringify(config)) as GameConfig;
}

export const ENGINE_VERSION = '0.1.0';
