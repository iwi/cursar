# Cursar – Design Decisions (addendum to the v0.1 documents)

Date: 10 November 2026, updated 11 November 2026 after the play tests and the multiplayer build, and 12 November 2026 with answers to the open questions and the internet-play build

This records what was agreed in the design review and where it changes the Game Design Document (GDD), the Technical Architecture and the Roadmap. Where this file and the v0.1 documents disagree, this file wins.

Status key: **Built** = in the current project. **Agreed** = decided, not built yet. **Proposed** = my suggestion, waiting for your answer.

## 1. Gameplay decisions

| Topic | Decision | Status |
|---|---|---|
| First release | Single player first, multiplayer straight after. | Built (single player) |
| Race length | Target 120–300 seconds. Races are cut off at 420 s (7 minutes) so a slow run on a large map can still finish. | Built, second tuning pass (see section 1a) |
| Map freshness | Seeded random maps from the first release (moved up from P3). Same seed gives the same map. | Built |
| Map key (M) | Removed. There is no in-race map. | Built |
| Memory of seen tiles | Tiles you have seen stay dimly visible for 25 s, then fade. Only terrain is remembered, never moving things. A Navigation skill will later lengthen this or make it permanent. | Built (skill: agreed) |
| Preview | Shows walls, terrain, landmarks, and later traps and enemies. Length scales with map size (15 s small, 17 s medium, 19 s large) so there is never time to memorise everything. | Built |
| Preview waypoints | Up to 3, dropped by clicking during the preview. In the race an arrow points to the next one. | Built |
| Facing | Follows movement, in 8 directions (diagonals included), turning smoothly rather than snapping. | Built |
| Vision | Egg-shaped: 8 tiles ahead, 4 to the side, 2 behind. Walls block it. | Built |
| Character size | Collision radius 0.3 tile, so a one-tile gap is passable. Corridors in generated maps are 2 tiles wide. | Built |
| Sprint | Limited by stamina. Running dry locks sprint until 25% is recovered. | Built |
| Pause | Solo: anyone, any time. Multiplayer: the host only, and it freezes the race for everyone (changed 11 November; it was "no pause in multiplayer"). From the pause panel the host can resume, restart the race on the same map, or cancel to the lobby. Resuming a race in progress counts 3-2-1 (with beeps and the start tone) before anyone can move, so nobody is caught mid-sprint; the race clock stands still during the count (added 12 November, solo and multiplayer). | Built |
| Computer players | The host can add them in the lobby. They are run by the server, take the best route, and differ only in speed: Easy 45%, Normal 60%, Hard 80% of top speed, never sprinting. They score series points like anyone else. Later: a little randomness so a bot now and then loses track of the right turn for a short while, to feel more human. | Built (randomness: agreed, later) |
| Checkpoints | Every checkpoint must be touched, in any order, before the finish counts (3, 4 or 5 by map size). The last one touched is the respawn point, and touching a new one restores full health. Later they are also the places where skills are picked. | Built (skills: agreed) |
| Health and respawning | Decided 12 November. Runners have **3 hearts**; a hit costs one (a big hit can cost more). Touching a new checkpoint restores full health. Out of hearts, the runner is sent **straight back** (no delay) to the last checkpoint touched, or the start if none, with full health and effects cleared; checkpoints already touched still count. After respawning the runner is **safe for 2 s** (no damage, no harmful effects; haste still works) and flickers, for rivals too. Hearts show above the stamina bar; there are sounds for a lost heart and for respawning. Nothing on the maps does damage yet; the solo Tuning panel has a "Lose a heart" button to try it. | Built |
| Footprints | Runners leave fading footprints. You see a rival's only inside your own view. | Built |
| Objective arrow | Optional arrow pointing at the nearest untouched checkpoint, then the finish (direction only), off by default. | Built |
| Finish timer | Once the first runner finishes, the rest have 30 s. Finished runners watch the rest on the full map. | Built |
| Landmarks | The features in the open plazas (fountain, statue, tree, crystal, brazier, obelisk) give the preview things to remember. Maps have 8–10 plazas and only six kinds, so some kinds repeat. Decided 12 November: the shape shows the kind and each plaza has its own colour, so no two plazas on a map share one; a repeated kind gets the colour most unlike its twin ("the red fountain", "the blue fountain"). Drawing only: maps and saved ghosts are unchanged. | Built |
| Moving obstacles | Decided 12 November, tuned after the first play test the same day. Three kinds, placed by the map generator: **5 on small maps, 6 on medium, 7 on large** (was 4, 5, 6), roughly a third of each. **Rolling boulders** roll back and forth along a straight corridor of 4–6 cells, filling its width (3 tiles a second). Every cell along a boulder's corridor has a **side passage** to duck into (the generator opens one where there is none): without them a boulder in a corridor could not be passed unhurt. **Rotating barriers** are a bar turning round a plaza's landmark (one turn in **4 s**, was 5; reaching 2 tiles from the post), so the fountain or statue becomes the post. **Gates** close an opening between two corridor cells on a rhythm (open 3 s, closed 2.5 s): walking into a closed gate just blocks you, but **a gate closing on you hurts** like a hit and throws you out to the nearer side (changed after the play test; it was harmless). A boulder or barrier **hit costs a heart, shoves you clear and stuns you for half a second**; then obstacles pass through you for 1 s so one cannot hit you twice in a row. Obstacles are placed before the finish and checkpoints, which keep off them, as do mud and ice and the start plaza. Obstacles **move in the preview** as in the race. In the race only what is in your view is drawn (moving things are never remembered), and they are heard before seen: boulders rumble (higher while coming towards you), barriers click at each quarter turn, gates clunk as they open and close. Their motion depends only on the race clock, so pages draw them without being sent positions. | Built |
| Computer players and obstacles | Computer players look a second ahead against the obstacles' known motion: they follow their route while it is clear, otherwise wait or step aside into a safe spot, and their route goes round barrier posts. If they make no progress for 4 s they go for it anyway, as a person would. Over 72 test races (Easy, Normal and Hard, 8 maps per size) every one finished, losing 0–19 s to obstacles with a hit now and then. Not built yet: the agreed randomness that makes them lose track of the route. | Built |
| Player collision | Runners do not block each other. | Built |
| Personal difficulty | A personal threat level: enemies prioritise high-threat players and traps trigger more easily for them. Replaces "more enemies for one player". | Agreed |
| Effects | Temporary effects on a runner, for hazards, traps and skills to use (decided 12 November). Six kinds: **Slowed** (top speed ×0.6, 3 s), **Haste** (×1.3, 4 s), **Stunned** (cannot move, slides to a stop, 0.8 s), **Reversed** (controls point the opposite way, 1 s), **Confused** (controls turned a quarter turn, 1 s), **Blinded** (vision shrinks to 20% and remembered tiles are hidden until it ends, 6 s; the server also reveals less to a blinded player; changed 12 November after trying it, from 40% for 4 s with memory still showing). The same effect again keeps the longer time rather than stacking; different effects run side by side, and slow and haste multiply. Each has its own sound and colour, a ring round the runner (shrinking as it runs out) and a label above the stamina bar; rivals' effects show when they are in view. All numbers are first guesses, adjustable in the solo Tuning panel, which also has a button per effect to try it. | Built |
| Loss-of-control effects | Stunned, Reversed and Confused last about one second. They come one at a time: none can start while another is running, and after one ends the runner is guarded for 1.5 s, so a row of traps cannot keep them helpless (decided 12 November). Slowed and Blinded are not limited by the guard. A short cue sounds when control returns, another when the guard turns an effect away. | Built |
| Series scoring | Cumulative points over a series of 1, 3, 5 or 7 races, a different map each race, with the host starting the next race from the results. Points by place: 10, 7, 5, 4, 3, 2, 1, 1; not finishing scores 0. | Built |
| Preview in multiplayer | Starts early once every connected runner is ready. Waypoints are private. | Built |
| Start positions | Rotate from race to race. | Built |
| Late joiners | Someone who joins during a race waits in the lobby for the next one. | Built |
| Graphics | Placeholder shapes until the late phases, then options to choose from. | Built (placeholders) |

## 1a. Race length (play test, 11 November)

The first version was far too short: every map could be finished in under a minute, some in under 30 seconds. Movement was judged good and is unchanged.

Making the maze bigger was not enough by itself. The shortest route grows with the width of a map, not its area: a map nine times the area was needed to reach about 90 seconds, and it could no longer be read in a preview. So races now use **checkpoints**: pink flags spread across the map, each as far as possible from the start, the finish and each other. All must be touched, in any order, before the finish counts. This multiplies the distance on a map that still fits the preview, and choosing the visiting order adds a planning decision to the preview.

| Size | Map (tiles) | Checkpoints | Preview | Flawless run, no sprint (average, range) | Expected real race |
|---|---|---|---|---|---|
| Small | 64 × 46 | 3 | 15 s | 82 s (61–131) | about 2 minutes |
| Medium | 67 × 49 | 4 | 17 s | 101 s (73–135) | about 3 minutes |
| Large | 73 × 52 | 5 | 19 s | 125 s (90–168) | about 4–5 minutes |

The flawless run is a bot that knows the map and takes the best order, measured over 24 maps per size.

Second play test (same day): with 4, 5 and 6 checkpoints on larger maps, real races took 2–3 minutes (small), about twice that (medium) and almost 10 minutes (large). People were about 1.6, 2.5 and 3.7 times slower than the bot: the bigger the map, the more time is lost to wrong turns, so real race length grows much faster than route length. The fix was one checkpoint fewer everywhere, and medium and large maps only a little bigger than small, so the sizes now differ mainly by checkpoint count. The expected times above assume the lost-time factor falls with map size as observed; they need confirming by play.

Movement: confirmed good as built. No change.

**Can facing be changed later?** Yes. Facing is one small rule in `packages/game-core/src/sim/movement.ts`; switching it to follow the mouse, or offering both as a setting, touches only that rule and the input reader.

## 2. Spending skill points mid-race (agreed 11 November, not built yet)

The problem: opening a menu in a real-time race costs time, so players would either ignore skills or resent them.

Decision: **a one-key pick of three, at checkpoints, without stopping.**

1. Treasures give points. Treasure points and skill points are the same currency.
2. Crossing a checkpoint with enough points offers three skill cards at the bottom of the screen.
3. Each card shows the benefit and its threat cost. Press `1`, `2` or `3` to take one. You keep running the whole time.
4. The offer stays until you choose. Ignoring it loses nothing but the benefit.
5. The three cards are drawn from a seeded per-player deck, so there is variety without unfairness.

With 3 to 5 checkpoints per race this gives three to five picks, which is enough for a build to take shape without the race becoming a menu.

## 3. Audio

The principle: **sound carries information the restricted view cannot.** Every cue should tell the player something they could not otherwise know, or save them a glance at the HUD.

All sound is synthesised in the browser, so there are no audio files yet. Real recorded sounds can replace each cue later without changing the game.

Built now:

| Cue | What it tells you |
|---|---|
| Footsteps that change with the surface | You hear mud (squelch) or ice (glassy tick) the moment you step on it. |
| Footstep tempo | Your speed, and whether you are sprinting. |
| Heartbeat, faster as stamina drops below 35% | Stamina, without looking at the bar. |
| Gasp when stamina runs out | Sprint is locked. |
| Thud scaled to impact speed, with a small screen shake | You hit a wall, and how hard. |
| Objective beacon: a soft ping, panned left or right, louder when closer. Low for a checkpoint, high for the open finish | Your nearest untouched checkpoint (or the finish, once open) is within 16 tiles and roughly which way. It passes through walls, so it gives direction but not the route. |
| Checkpoint chime, with a rising run on the last one | Checkpoint counted; the finish is now open. |
| Low double buzz on the finish | The finish does not count yet: checkpoints remain. |
| Ghost footsteps, panned | A rival is near, even when out of sight. |
| Waypoint chime | You reached the waypoint you set. |
| Countdown beeps and start tone | Race start. |
| Clock ticks in the last 30 s, faster in the last 10 | Time is running out. |
| Finish fanfare, with an extra flourish for a new best | Result, before you read it. |

Agreed for later phases:

- **Opponents' footsteps: built.** Audible within 9 tiles, panned left or right and louder when closer. The server sends only direction and loudness, never a position. Still to add: making the surface audible, so you can tell a rival is crossing ice nearby.
- **A rival finishing: built.** A falling two-note cue and an on-screen notice; the 30-second clock is now running.
- **Enemy signatures.** Each enemy type has its own sound that is audible before it is visible: a patroller's regular steps, a chaser's growl that rises when it has picked you, a turret's whir before it fires.
- **Trap tells.** Armed traps make a faint sound at very close range. The trap-detection skill makes it louder and earlier.
- **Dynamic obstacles.** Rolling boulders rumble with a pitch shift as they pass. Rotating barriers click on a rhythm you can time.
- **Adaptive music.** A quiet base layer, with layers added when you are in the lead, when someone is close behind, and in the final stretch.
- **Settings.** Separate volumes for effects and music, and a visual alternative for each important cue so the game does not depend on hearing.

## 4. Technical decisions

| Topic | Decision | Status |
|---|---|---|
| Where the simulation runs | `game-core` is plain TypeScript with no browser, Phaser or network dependency. It runs in the browser for single player and will run unchanged on the server for multiplayer. | Built |
| Fixed timestep | 60 ticks per second, independent of frame rate. | Built |
| Client prediction | Your own runner moves at once using the shared rules; each server update is applied and the inputs it has not yet processed are replayed. Small corrections are eased out rather than snapped. Rivals are drawn 100 ms in the past, blended between updates (20 per second). | Built |
| Visibility | Computed in the core and used by the server: during a race each player is sent only the rivals and footprints inside their own view, so a modified page cannot reveal where the others are. The static layout is not hidden, since it is shown in the preview. | Built |
| Server authority | The server runs the race. Pages send only movement intent; messages are validated, size-limited and rate-limited, and a page sending inputs faster than the simulation gains nothing. | Built |
| Rooms | Many rooms per server, each up to 8 players and one race at a time, joined by a four-letter code (consonants only, so codes never spell words) or a link with the code in it. Creating a room makes you its host. If the host drops, the role passes to someone connected and comes back when they return. A room closes once nobody has been in it for 30 seconds. The server holds at most 50 rooms (setting: `MAX_ROOMS`). (Changed 12 November; it was one room per server.) | Built |
| Removing players | The host can remove a person from the lobby, from the results, or while they wait for the next race, but not mid-race (they would leave a hole in it). The removed page is told why and cannot rejoin that room from the same tab. Without accounts this is a deterrent, not a ban: a new tab joins as someone new. | Built |
| Abuse limits | A connection gets one try at joining, so room codes cannot be guessed in a loop. Per visitor address: at most 30 new connections a minute and 12 open at once. Existing limits on message size and rate still apply. | Built |
| Stalled pages | If a page stops sending moves for a quarter of a second (a background tab, a frozen page), the server stops that runner rather than repeating its last move. This is also why the earlier demo tab kept running into walls. | Built |
| Reconnection | A dropped or reloaded page gets its place back (including mid-race) for 30 seconds. | Built |
| Deployment | `npm start` serves the page and the connection from one port, so local, network and later internet play differ only in the address. | Built |
| Ghosts | Position tracks sampled every 50 ms, not input replays. About 25 KB per minute, played back identically anywhere. | Built |
| Storage | Browser storage for settings and best runs. SQLite waits until profiles and statistics. | Built |
| Events | The simulation reports what happened (footstep, bump, finish and so on) as events. Audio and effects listen to them. | Built |
| Effect system | `sim/effects.ts`: `applyEffect` starts one (with the stacking and guard rules), effects count down inside `step`, and they change the input (`controlledInput`), top speed (`effectSpeedMul`) and vision (`effectiveVision`). Effects travel with the runner's own state to its page; rivals in view carry a list of their effects' kinds. Nothing on the maps applies them yet: that is the hazards' job. | Built |
| Internet play | A single hosted server with room codes and no accounts. Code built 12 November: rooms, codes, removing players, a health check (`/health`), cache headers, a `Dockerfile`, and `TRUST_PROXY` for running behind the HTTPS proxy that hosting platforms provide (see `docs/DEPLOY.md`). Host chosen 12 November: Railway, building the `Dockerfile`, with its settings in `railway.json` (exactly one copy, never asleep, no overlap between old and new versions on deploy, health check on `/health`). Accounts and matchmaking stay late. Online since 12 November at https://cursarserver-production.up.railway.app (tested by the owner with players on different networks: works well). | Online |
| Phaser version | Phaser 3.90, the final and most widely documented release of version 3. Version 4 exists; because rendering is kept separate from the game rules, moving later affects only `apps/client/src/game`. | Built |

## 5. Revised roadmap

1. **Phase 0–1: single-player prototype.** Done in this project, including seeded random maps, a ghost of your best run, waypoints, stamina and audio. *Now: play it and tune the feel.*
2. **Phase 2: multiplayer on the local network.** Done: server, lobby, 2–8 runners, rivals and their footprints inside your view, finish timer, results with routes, series scoring, reconnection. Tested across real computers on a network (12 November): works well.
3. **Phase 2b: simple internet play.** One hosted server, room codes, no accounts. The host can remove a human player. *Done 12 November: online on Railway at https://cursarserver-production.up.railway.app. Played from different networks and it works well.*
4. **Phase 3: hazards.** Effect system first, then checkpoints and respawn, health, dynamic obstacles, traps, enemies, with their audio. *Built 12 November: the effect system (six effects), health with checkpoint respawning, and moving obstacles (boulders, barriers, gates). Next: traps, then enemies.*
5. **Phase 4: skills, perks and combat.** Including the one-key skill pick and the threat level.
6. **Phase 5: map editor.** Using the same map format the generator already produces.
7. **Phase 6: recordings.** Managing several ghosts, statistics, racing other players' ghosts.
8. **Phase 7–8: wider application, accounts, matchmaking, final graphics.**

## 6. Open questions

- Obstacle speeds, timings and counts are first guesses, in `config.obstacles` and `MAP_SIZES` (barrier speed, gate damage and counts tuned after the first play test).
- The effects' strengths and lengths are first guesses: try them from the solo Tuning panel.
- Computer players' speeds are first guesses set against your times (a flawless run at full speed is about 80 s on a small map).

Settled on 12 November: multiplayer works across real computers on a network; memory time (25 s) and vision ranges stay as they are; the server is hosted on Railway (the Tuning panel in solo mode still changes them live).
