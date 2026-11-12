# Cursar – notes for Claude Code

Cursar is a top-down racing game about navigation and memory: players see the whole map in a preview, then race with a restricted, direction-based view, touching every checkpoint (any order) before the finish. Solo mode races a ghost of your best run; multiplayer is 2–8 players per room (rooms joined by a four-letter code, many rooms per server), with server-run computer players.

Read `docs/DECISIONS.md` before changing gameplay: it records what was agreed with the project owner and why (race length tuning, checkpoint rule, audio cues, multiplayer rules). It overrides the original v0.1 design documents. Update it when a decision changes.

## Commands

- `npm install` – install dependencies (Node.js 22.12+).
- `npm start` – build the page and run the game server on port 3000 (what players use).
- `npm run dev` – development: Vite on 5173 with live reload, game server on 3001 (proxied at `/ws`).
- `npm test` – Vitest: game rules (`packages/game-core/tests`) and server room (`apps/server/tests`).
- `npm run typecheck` – TypeScript for all three packages.

Run `npm run typecheck` and `npm test` before calling any change done.

## Layout

- `packages/game-core/` – the game rules in plain TypeScript. No browser, Phaser, DOM or network code here, ever.
  - `config.ts` every tunable number; `map/` format, seeded generator, validation, route planning; `sim/` movement, collision, stamina, effects, health and respawning, visibility, race phases, autopilot; `replay/` ghosts; `net/protocol.ts` client/server messages and their validation.
- `apps/server/` – Node game server. `rooms.ts` holds every room by code (create, join, close when abandoned); `room.ts` is one room (lobby, race loop, per-player visibility filtering, results, series points, computer players, pause/restart/cancel, removing players). Both are transport-free; `index.ts` wires them to WebSockets, applies per-address connection limits and serves `apps/client/dist` plus `/health`. Hosting: Railway, via `Dockerfile` and `railway.json`; see `docs/DEPLOY.md`.
- `apps/client/` – Vite + React (menus, HUD) + Phaser 3.90 (race rendering).
  - `game/RaceScene.ts` draws and plays sound; it gets everything from a `RaceDriver` (`game/driver.ts`): `LocalDriver` (solo, simulation in the browser) or `NetDriver` (multiplayer: client prediction + reconciliation, rivals interpolated 6 ticks behind).
  - `ui/` React screens; `audio/AudioEngine.ts` synthesised Web Audio cues (no audio files).

## Rules of the codebase

- The race advances only through `step(state, inputs)` (or `stepPlayer` for client prediction). Same rules run in the browser and on the server.
- Units: tiles, seconds, radians. Pixels exist only in the client (`PX = 32`).
- Gameplay numbers belong in `config.ts` or data tables (`TERRAIN`, `MAP_SIZES`, `BOT_LEVELS`, `PLACE_POINTS`), not inline.
- The simulation reports what happened as `GameEvent`s; audio and effects react to events.
- The server is authoritative and trusts nothing: validate every client message in `parseClientMessage`. During a race, never send a player anything outside their own view (rivals, footprints) – see `sendSnapshots`.
- Changing message shapes means bumping `PROTOCOL_VERSION`. Changing the map generator means bumping `GENERATOR_VERSION` (saved ghosts are keyed by map id).
- New rules come with tests. Server tests use a fixed seed (`fixture`) so they are deterministic.
- Graphics are deliberate placeholders until the late phases; the owner wants to choose a visual style from options then.

## Where the project is

Done: Phases 0–2 (solo prototype, seeded maps, checkpoints, ghosts, audio, local-network multiplayer, computer players, host pause/restart/cancel) and Phase 2b (rooms with codes, removing players), online on Railway at https://cursarserver-production.up.railway.app. Pushing game changes to `main` redeploys it and closes open rooms. Phase 3 (hazards) has begun: the effect system (`sim/effects.ts`, six effects) and health with checkpoint respawning (`sim/health.ts`, 3 hearts) are built and tried from the solo Tuning panel, but nothing on the maps applies effects or damage yet. Next: dynamic obstacles, traps and enemies. The skill-pick design (one-key pick of three at checkpoints) is agreed but not built.

The owner writes in British English; keep user-facing text in British English.
