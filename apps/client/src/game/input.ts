/** Phaser key names per action. Several keys may trigger the same action. */
export interface KeyBindings {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  sprint: string[];
}

export const DEFAULT_BINDINGS: KeyBindings = {
  up: ['W', 'UP'],
  down: ['S', 'DOWN'],
  left: ['A', 'LEFT'],
  right: ['D', 'RIGHT'],
  sprint: ['SHIFT'],
};
