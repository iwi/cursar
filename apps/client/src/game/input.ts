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

/** The default keys plus, if asked for, vim's: H left, J down, K up, L right. */
export function bindingsFor(options: { vimKeys: boolean }): KeyBindings {
  if (!options.vimKeys) return DEFAULT_BINDINGS;
  return {
    ...DEFAULT_BINDINGS,
    up: [...DEFAULT_BINDINGS.up, 'K'],
    down: [...DEFAULT_BINDINGS.down, 'J'],
    left: [...DEFAULT_BINDINGS.left, 'H'],
    right: [...DEFAULT_BINDINGS.right, 'L'],
  };
}
