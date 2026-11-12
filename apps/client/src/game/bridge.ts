import type { RacePhase } from '@cursar/game-core';

/** What the HUD needs to know, sent from the game scene to the React interface. */
export interface HudState {
  phase: RacePhase;
  phaseTime: number;
  raceTime: number;
  /** Seconds left before the race is cut off. */
  timeLeft: number;
  stamina: number;
  exhausted: boolean;
  sprinting: boolean;
  markersPlaced: number;
  markersMax: number;
  checkpointsDone: number;
  checkpointsTotal: number;
  paused: boolean;
  terrain: string;
  /** The local runner has finished and is watching the others. */
  spectating: boolean;
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
}

type Handler<T> = (payload: T) => void;

/**
 * The only channel between React (menus, HUD) and Phaser (the race). Neither
 * side imports the other's internals.
 */
export class Bridge {
  private handlers = new Map<keyof BridgeEvents, Set<Handler<never>>>();

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
