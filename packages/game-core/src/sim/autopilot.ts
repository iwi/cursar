import { planRoute } from '../map/route';
import { type GameMap, isSolid } from '../map/types';
import type { PlayerInput } from './types';

/**
 * A simple route-follower: it takes the shortest tour of the checkpoints and
 * then the finish, walking downhill on each target's distance field.
 * Used by tests and the client's demo mode; a starting point for AI racers.
 */
export function createAutopilot(
  map: GameMap,
): (p: { x: number; y: number; checkpoints: boolean[] }, sprint?: boolean) => PlayerInput {
  const plan = planRoute(map);
  let seq = 0;
  return (p, sprint = false) => {
    const next = plan.order.find((index) => !p.checkpoints[index]);
    const dist = plan.fields[next ?? map.checkpoints.length]!;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    let best = dist[ty * map.width + tx]!;
    let targetX = tx;
    let targetY = ty;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (isSolid(map, tx + dx, ty + dy)) continue;
      const d = dist[(ty + dy) * map.width + tx + dx]!;
      if (d >= 0 && d < best) {
        best = d;
        targetX = tx + dx;
        targetY = ty + dy;
      }
    }
    const mx = targetX + 0.5 - p.x;
    const my = targetY + 0.5 - p.y;
    const len = Math.hypot(mx, my) || 1;
    return { seq: ++seq, mx: mx / len, my: my / len, sprint };
  };
}
