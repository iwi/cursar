import type { GameConfig } from '../config';
import { Rng } from '../rng';
import type { GameEvent, PlayerState, RaceState } from './types';

export type SkillId = 'trapSense' | 'reveal' | 'homing' | 'footing' | 'deepLungs' | 'tough' | 'steady';

export interface SkillCard {
  id: SkillId;
  name: string;
  group: 'senses' | 'body';
  /** Points it costs to take. */
  cost: number;
  /** Threat it adds (see `config.threat`). */
  threat: number;
  /** What it does, in a few words, for the card. */
  text: string;
}

/**
 * The skill deck. Each skill lasts for the rest of the race and can be taken
 * once. How strong each one is lives in `config.skills`.
 */
export const SKILLS: Record<SkillId, SkillCard> = {
  trapSense: { id: 'trapSense', name: 'Trap sense', group: 'senses', cost: 1, threat: 1, text: 'A trap clicks before it springs: step off in time' },
  reveal: { id: 'reveal', name: 'Reveal', group: 'senses', cost: 1, threat: 1, text: 'Each checkpoint shows the hazards around you' },
  homing: { id: 'homing', name: 'Homing sense', group: 'senses', cost: 1, threat: 1, text: 'The checkpoint arrow shows for a while after each checkpoint' },
  footing: { id: 'footing', name: 'Footing', group: 'body', cost: 1, threat: 1, text: 'Mud and ice slow and slide you half as much' },
  deepLungs: { id: 'deepLungs', name: 'Deep lungs', group: 'body', cost: 2, threat: 2, text: 'Sprint longer, recover sooner' },
  tough: { id: 'tough', name: 'Tough', group: 'body', cost: 2, threat: 2, text: 'A fourth heart' },
  steady: { id: 'steady', name: 'Steady', group: 'body', cost: 1, threat: 1, text: 'Loss of control wears off twice as fast' },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

export function hasSkill(p: PlayerState, id: SkillId): boolean {
  return p.skills.includes(id);
}

/** Cards offered at a time. */
const OFFER_SIZE = 3;

/**
 * Offers three cards when a runner touches a checkpoint with at least one
 * point, unless an offer is already waiting. The cards come from the runner's
 * own seeded deck (the map and the runner decide it, so the same race always
 * deals the same), leaving out skills already taken; at least one card is one
 * they can afford.
 */
export function offerSkills(state: RaceState, p: PlayerState, events: GameEvent[]): void {
  if (p.offer || p.points < 1) return;
  const left = SKILL_IDS.filter((id) => !hasSkill(p, id));
  if (left.length === 0) return;
  const rng = new Rng(`${state.map.id}:${p.id}:${p.offersMade}`);
  const cards = rng.shuffle([...left]).slice(0, OFFER_SIZE);
  if (!cards.some((id) => SKILLS[id].cost <= p.points)) {
    const affordable = left.filter((id) => SKILLS[id].cost <= p.points && !cards.includes(id));
    if (affordable.length === 0) return;
    cards[cards.length - 1] = rng.pick(affordable);
  }
  p.offersMade++;
  p.offer = cards;
  events.push({ type: 'offer', playerId: p.id, cards });
}

/**
 * Takes the card in `slot` (0 to 2) of the waiting offer, if it is affordable:
 * spends its points, adds its threat, and clears the offer. Returns whether it
 * was taken.
 */
export function pickSkill(state: RaceState, playerId: string, slot: number, events: GameEvent[]): boolean {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p || p.finished || !p.offer || state.phase !== 'racing') return false;
  const id = p.offer[slot];
  if (!id || hasSkill(p, id) || SKILLS[id].cost > p.points) return false;
  const card = SKILLS[id];
  p.points -= card.cost;
  p.threat += card.threat;
  p.skills.push(id);
  p.offer = null;
  // A fourth heart is given at once.
  if (id === 'tough') p.health += 1;
  events.push({ type: 'skill', playerId: p.id, skill: id });
  return true;
}

/** Counts down Reveal's glow and Homing sense's arrow by one tick. */
export function tickSkills(p: PlayerState, dt: number): void {
  p.revealTime = Math.max(0, p.revealTime - dt);
  p.homingTime = Math.max(0, p.homingTime - dt);
}

/** How close (tiles, beyond its tile) a trap catches this runner: higher threat, and traps catch you on a brush. */
export function trapReach(config: GameConfig, p: PlayerState): number {
  return Math.min(config.threat.trapReachMax, p.threat * config.threat.trapReachPerThreat);
}

/** How far off a chaser wakes for this runner: higher threat, further. */
export function wakeRange(config: GameConfig, p: PlayerState): number {
  return config.enemies.chaser.wakeRange + Math.min(config.threat.wakeRangeMax, p.threat * config.threat.wakeRangePerThreat);
}
