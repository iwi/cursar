# Cursar

A top-down racing game about navigation and memory. You are shown the whole map for a few seconds, then you run it with a restricted view: touch every checkpoint, in any order, then reach the finish.

It has a solo mode against the ghost of your best run, and multiplayer for 2–8 players in rooms you join with a code, on your own network or over the internet at https://cursarserver-production.up.railway.app (roadmap Phases 0–2b). Phase 3, hazards, is in: effects, health, moving obstacles, traps and enemies. Phase 4 (treasures, skills, the shove), Phase 5 (the map editor) and Phase 6 (recordings: several ghosts, ghost files, statistics) are in. Design decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Run it

You need [Node.js](https://nodejs.org) 22.12 or newer (the current LTS release is fine).

```bash
npm install
npm start
```

`npm start` builds the game and starts the game server. It prints two addresses:

- `http://localhost:3000` for the computer running it;
- `http://<network address>:3000` for everyone else on the same network.

Leave that terminal open while you play; `Ctrl+C` stops the server.

### Playing with friends

1. Someone runs the game server: `npm start` on one computer for a game on your own network, or the hosted server on Railway for play over the internet (see [docs/DEPLOY.md](docs/DEPLOY.md)). Nobody else needs to install anything.
2. One player opens the address in a desktop browser, chooses **Play with friends**, then **Create a room**. The lobby shows a four-letter room code and a link to share.
3. Everyone else opens the link, or chooses **Play with friends** and types the code. One server holds many rooms at once, each with its own players.
4. Each player picks a name and colour, says they are ready, and can turn on the checkpoint arrow for themselves. Whoever created the room is the host: they choose the map size, the number of races in the series and, optionally, a seed, then start. If the host's connection drops, someone else takes over until they return.
5. In the preview, a race starts early once everyone has pressed `Enter`.
6. After each race the host starts the next one. Points for a place are 10, 7, 5, 4, 3, 2, 1, 1; not finishing scores nothing.

If other computers cannot open the address, the host computer's firewall is the usual cause: allow Node.js to accept incoming connections on private networks (Windows asks about this the first time; on macOS it is under System Settings → Network → Firewall).

The host can add **computer players** in the lobby (Easy, Normal or Hard). They take the best route, so their level is how fast they run. This is also the way to try multiplayer alone.

The host can **remove** a player from the lobby, from the results, or while they wait for the next race (not mid-race). A removed player cannot rejoin that room from the same browser tab.

During a race the host can press `Esc` (or the Pause button) to freeze it for everyone. From the pause panel the host can resume (play continues after a 3-2-1), restart the race on the same map, or cancel it and return everyone to the lobby.

### Working on the code

```bash
npm run dev
```

This runs the game server and the page side by side with live reload; open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm start` | Builds the game and serves it, with multiplayer, on port 3000. |
| `npm run dev` | Development mode on port 5173, reloading as files change. |
| `npm test` | Runs the tests for the game rules and the server. |
| `npm run typecheck` | Checks the TypeScript. |

To use a different port: `npm run start -w @cursar/server -- --port 8080` (after `npm run build`).

## Play

| Action | Control |
|---|---|
| Move | `W` `A` `S` `D` or the arrow keys; optionally `H` `J` `K` `L` (vim keys) or the mouse (click or hold to run towards the pointer, right click stops), both turned on in the menu or lobby |
| Sprint | `Shift` (uses stamina) |
| Drop a waypoint | Click the map during the preview (up to 3) |
| Remove the last waypoint | Right-click or `Backspace` during the preview |
| Start early | `Enter` during the preview |
| Restart | `R` in solo play; in multiplayer the host restarts from the pause panel |
| Pause | `Esc` (in multiplayer, the host only: it pauses for everyone) |
| Full map | `M` or the Map button during the race; you stand still while it is open, and the clock keeps running |
| Shove | `Space`: pushes a rival or an awake chaser in front of you (uses stamina) |
| Take a skill card | `1` `2` `3` when cards are offered |

- The **map editor** (from the menu) lets you make your own maps on the maze grid: open walls, place the start, finish, checkpoints, traps, coins, enemies and obstacles, then save, race, or export them as a file. Saved maps can be chosen in the menu, and by the host in a multiplayer room.
- The **map seed** decides the map. The same seed and size always give the same map, so you can share a seed or return to beat your time.
- **Checkpoints** are the pink flags. The finish only counts once you have touched them all; the order is up to you.
- You have **3 hearts**. A new checkpoint restores them; losing the last sends you back to the last checkpoint you touched.
- **Moving obstacles**: boulders roll along corridors, barriers turn round some plazas' landmarks, and gates open and close. A boulder or barrier costs a heart and knocks you aside, and so does a gate closing on you (a closed gate otherwise just blocks the way). Boulder corridors always have side passages to duck into. Watch how they move in the preview, and listen for them in the race.
- **Traps** are shown in the preview but hidden in the race until you are within about 2 tiles; listen for a faint tick. Spikes cost a heart; snares stun, glue slows, flashes blind and trick tiles scramble your controls. A sprung trap is safe for 10 seconds. Corridors are two tiles wide, so you can step round a trap you remember.
- **Treasures and skills**: gold coins are worth a point each. Touch a checkpoint with points to spend and three skill cards appear; press `1`, `2` or `3` to take one without stopping. Skills last the race. Each card also adds threat: enemies go for high-threat runners first, and traps catch them more easily.
- **Enemies**: purple patrollers walk a winding beat back and forth, turning corners (hug the wall to squeeze past; a touch costs a heart). Red chasers sleep until you come close, then chase you; break their line of sight to lose them (a catch costs a heart and stuns you). Turrets turn, whir and fire slow bolts that slow you; dodge or duck behind a wall. Listen: you hear each kind before you see it.
- In a solo race, a white **ghost** races alongside you: your best run on the map, unless you choose another in the menu. Your last few runs are kept too, and you can keep any finished runner's ghost from multiplayer results or open a ghost file a friend exported. After each run you get a summary (checkpoint times against your best, hearts lost, traps, distance); **Statistics** in the menu has your totals and a record per map. All of it is kept in the browser.
- In multiplayer you only see rivals, and their footprints, inside your own view. You can hear their footsteps a little further away. When the first runner finishes, everyone else has 30 seconds.
- A runner who has finished watches the rest of the race on the full map.
- After a race the map is revealed with the route each runner took.
- The **Tuning** button in a race opens live sliders for speed, acceleration, sprint, vision and memory, and for the effects. Its **Effects** buttons put an effect on your runner to try it: Slowed, Haste, Stunned, Reversed, Confused or Blinded,, and **Lose a heart** tries health. Changes apply immediately and last until you reload the page. "Copy values" copies the full configuration so the defaults can be updated.
- Turn the sound on. Footsteps tell you the surface, a heartbeat tells you stamina is low, and your nearest checkpoint (or the open finish) pings when you are close.

`CLAUDE.md` holds working notes for Claude Code: commands, layout and the rules of the codebase.

## How the project is organised

```
packages/game-core/   The game rules. Plain TypeScript: no browser, Phaser or network code.
  src/config.ts         Every tunable number.
  src/map/              Map format, seeded generator, validation.
  src/sim/              Movement, collision, stamina, effects, health, visibility, race phases.
  src/replay/           Ghost recording and playback.
  src/net/              Messages between page and server, and their validation.
  tests/                Tests for all of the above.
apps/client/          The browser application.
  src/game/             Phaser scene (draws the race), and the two race drivers: local and network.
  src/net/              Connection to the game server.
  src/ui/               React: menu, lobby, HUD, results, tuning panel.
  src/audio/            Synthesised sound cues.
apps/server/          The game server (Node.js).
  src/rooms.ts          All the rooms on the server, found by their code.
  src/room.ts           One room: lobby, race loop, what each player may see, results and series points.
  src/index.ts          WebSocket connections, connection limits, serving the built page.
  tests/                Tests for the rooms.
docs/DECISIONS.md     What was decided and why.
docs/DEPLOY.md        Hosting the server for play over the internet (Railway; railway.json).
```

The important rule: `game-core` never imports from the client or the server. The race advances only through `step(state, inputs)`, so the same rules run in the browser for solo play and on the server for multiplayer.

In multiplayer the server is the only authority. The page moves your own runner immediately using the same rules (prediction) and corrects itself from the server's updates; other runners are drawn a tenth of a second in the past, blended between updates. The server sends each player only the rivals inside that player's view.

## Conventions

- Distances are in tiles, time in seconds, angles in radians. Pixels exist only in the client.
- Gameplay numbers go in `config.ts`, not in the code that uses them.
- A new rule comes with a test in `packages/game-core/tests`.
- The simulation reports what happened as events; sound and visual effects react to events rather than being called from the rules.
