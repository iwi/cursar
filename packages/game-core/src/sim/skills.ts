import type { GameConfig } from '../config';
import { Rng } from '../rng';
import type { GameEvent, PlayerState, RaceState } from './types';

export type SkillId =
  | 'navigation'
  | 'trapSense'
  | 'wideEyes'
  | 'fleetFoot'
  | 'deepLungs'
  | 'tough'
  | 'steady'
  | 'dash'
  | 'reveal'
  | 'decoy';

export type ActiveSkill = 'dash' | 'reveal' | 'decoy';

export interface SkillCard {
  id: SkillId;
  name: string;
  group: 'senses' | 'body' | 'active';
  /** Points it costs to take. */
  cost: number;
  /** Threat it adds (see `config.threat`). */
  threat: number;
  /** What it does, in a few words, for the card. */
  text: string;
  /** For active skills: the key that uses it. */
  key?: string;
}

/**
 * The skill deck. Each skill lasts for the rest of the race and can be taken
 * once. How strong each one is lives in `config.skills`.
 */
export const SKILLS: Record<SkillId, SkillCard> = {
  navigation: { id: 'navigation', name: 'Navigation', group: 'senses', cost: 1, threat: 1, text: 'Remembered ground lasts much longer' },
  trapSense: { id: 'trapSense', name: 'Trap sense', group: 'senses', cost: 1, threat: 1, text: 'See and hear traps from further off' },
  wideEyes: { id: 'wideEyes', name: 'Wide eyes', group: 'senses', cost: 2, threat: 2, text: 'See a quarter further' },
  fleetFoot: { id: 'fleetFoot', name: 'Fleet foot', group: 'body', cost: 3, threat: 3, text: 'Run a little faster' },
  deepLungs: { id: 'deepLungs', name: 'Deep lungs', group: 'body', cost: 2, threat: 2, text: 'Sprint longer, recover sooner' },
  tough: { id: 'tough', name: 'Tough', group: 'body', cost: 2, threat: 2, text: 'A fourth heart' },
  steady: { id: 'steady', name: 'Steady', group: 'body', cost: 1, threat: 1, text: 'Loss of control wears off twice as fast' },
  dash: { id: 'dash', name: 'Dash', group: 'active', cost: 2, threat: 2, text: 'A short burst of speed', key: 'Q' },
  reveal: { id: 'reveal', name: 'Reveal', group: 'active', cost: 2, threat: 1, text: 'Show hazards close by for a moment', key: 'E' },
  decoy: { id: 'decoy', name: 'Decoy', group: 'active', cost: 3, threat: 2, text: 'Leave a fake for enemies to chase', key: 'F' },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
export const ACTIVE_SKILLS: readonly ActiveSkill[] = ['dash', 'reveal', 'decoy'];

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

/** Uses an active skill the runner has, if its cooldown is over. Called from `stepPlayer` with the tick's input. */
export function useSkill(state: RaceState, p: PlayerState, skill: ActiveSkill, events: GameEvent[]): void {
  if (!hasSkill(p, skill) || (p.cooldowns[skill] ?? 0) > 0) return;
  const cfg = state.config.skills;
  p.cooldowns[skill] = cfg[skill].cooldownSeconds;
  if (skill === 'dash') p.dashTime = cfg.dash.seconds;
  else if (skill === 'reveal') p.revealTime = cfg.reveal.seconds;
  else state.decoys.push({ owner: p.id, x: p.x, y: p.y, time: cfg.decoy.seconds });
  events.push({ type: 'skillUsed', playerId: p.id, skill });
}

/** Counts down cooldowns and active skills by one tick. */
export function tickSkills(p: PlayerState, dt: number): void {
  for (const skill of ACTIVE_SKILLS) {
    const left = p.cooldowns[skill];
    if (left !== undefined && left > 0) p.cooldowns[skill] = Math.max(0, left - dt);
  }
  p.dashTime = Math.max(0, p.dashTime - dt);
  p.revealTime = Math.max(0, p.revealTime - dt);
}

/** How far the runner sees and hears traps (Trap sense widens both). */
export function trapSenses(config: GameConfig, p: PlayerState): { reveal: number; tell: number } {
  return hasSkill(p, 'trapSense')
    ? { reveal: config.skills.trapSenseReveal, tell: config.skills.trapSenseTell }
    : { reveal: config.traps.revealDistance, tell: config.traps.tellDistance };
}

/** How close (tiles, beyond its tile) a trap catches this runner: higher threat, and traps catch you on a brush. */
export function trapReach(config: GameConfig, p: PlayerState): number {
  return Math.min(config.threat.trapReachMax, p.threat * config.threat.trapReachPerThreat);
}

/** How far off a chaser wakes for this runner: higher threat, further. */
export function wakeRange(config: GameConfig, p: PlayerState): number {
  return config.enemies.chaser.wakeRange + Math.min(config.threat.wakeRangeMax, p.threat * config.threat.wakeRangePerThreat);
}
