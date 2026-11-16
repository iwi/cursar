import type { EffectKind, RacePhase, SkillId } from '@cursar/game-core';

/** What the HUD needs to know, sent from the game scene to the React interface. */
export interface HudState {
  phase: RacePhase;
  phaseTime: number;
  /** Seconds left in the count after a pause (0 when play is running). */
  resumeTime: number;
  raceTime: number;
  /** Seconds left before the race is cut off. */
  timeLeft: number;
  stamina: number;
  /** The doors (by index) whose keys the local runner holds. */
  keys: number[];
  /** The shove (Space) can be used now. */
  shoveReady: boolean;
  exhausted: boolean;
  sprinting: boolean;
  markersPlaced: number;
  markersMax: number;
  checkpointsDone: number;
  checkpointsTotal: number;
  paused: boolean;
  terrain: string;
  /** The full map is open: the runner is standing still. */
  mapOpen: boolean;
  /** The local runner has finished and is watching the others. */
  spectating: boolean;
  health: number;
  healthMax: number;
  /** Skill points to spend, and threat (the sum of the taken cards' threat). */
  points: number;
  threat: number;
  /** Cards on offer, or null. */
  offer: { id: SkillId; name: string; text: string; cost: number; threat: number; affordable: boolean }[] | null;
  /** Active skills taken: their key and seconds until usable (0 = ready). */
  /** Effects on the local runner: seconds left and in all. */
  effects: { kind: EffectKind; left: number; total: number }[];
  /** Who is ready during the preview (network play only). */
  readiness: { ready: number; total: number; mine: boolean } | null;
}

interface BridgeEvents {
  hud: HudState;
  /** A short message to flash on screen, such as a rival finishing. */
  notice: string;
  /** The player asked for a restart from inside the game (R key). */
  restart: undefined;
  /** Interface to game. */
  skipPreview: undefined;
  setPaused: boolean;
  /** Tuning panel (solo only): put an effect on the runner to try it. */
  testEffect: EffectKind;
  /** Tuning panel (solo only): take a heart from the runner. */
  testHurt: undefined;
  /** Open or close the full map during the race. */
  toggleMap: undefined;
  /** Take card 0, 1 or 2 of the skill offer (a click on the card). */
  pick: number;
  /** Tuning panel (solo only): three skill points and a deal of cards, to try them. */
  testPoints: undefined;
  /** The on-screen shove button (touch screens). */
  shove: undefined;
}

/** The on-screen controls of a touch screen, read by the scene every tick: the stick (length up to 1) and the sprint button. */
export interface TouchInput {
  mx: number;
  my: number;
  sprint: boolean;
}

type Handler<T> = (payload: T) => void;

/**
 * The only channel between React (menus, HUD) and Phaser (the race). Neither
 * side imports the other's internals.
 */
export class Bridge {
  private handlers = new Map<keyof BridgeEvents, Set<Handler<never>>>();
  /** Written by the touch controls, read by the scene (too frequent for events). */
  readonly touch: TouchInput = { mx: 0, my: 0, sprint: false };

  on<K extends keyof BridgeEvents>(event: K, handler: Handler<BridgeEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof BridgeEvents>(event: K, ...payload: BridgeEvents[K] extends undefined ? [] : [BridgeEvents[K]]): void {
    this.handlers.get(event)?.forEach((h) => (h as Handler<unknown>)(payload[0]));
  }
}
