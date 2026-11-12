import { type GameMap, type RaceState, Tile, createAutopilot } from '../src';

/** Builds a map from rows of text: # wall, . floor, m mud, i ice, S start, F finish, C checkpoint. */
export function mapFromText(rows: string[]): GameMap {
  const height = rows.length;
  const width = rows[0]!.length;
  const tiles: number[] = [];
  const startPositions: { x: number; y: number }[] = [];
  let finish = { x: 0, y: 0, w: 1, h: 1 };
  const checkpoints: { x: number; y: number; w: number; h: number }[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      tiles.push(ch === '#' ? Tile.Wall : ch === 'm' ? Tile.Mud : ch === 'i' ? Tile.Ice : Tile.Floor);
      if (ch === 'S') startPositions.push({ x: x + 0.5, y: y + 0.5 });
      if (ch === 'F') finish = { x, y, w: 1, h: 1 };
      if (ch === 'C') checkpoints.push({ x, y, w: 1, h: 1 });
    });
  });
  return {
    schema: 1, id: 'test', name: 'Test', version: 1, width, height, tiles,
    startPositions, finish, checkpoints, landmarks: [],
  };
}

/** Bot input for the first player, following the shortest route. */
export function makeBot(map: GameMap) {
  const pilot = createAutopilot(map);
  return (state: RaceState, sprint = false) => pilot(state.players[0]!, sprint);
}
