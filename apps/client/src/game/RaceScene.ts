import {
  type ActiveEffect,
  type EffectKind,
  type GameEvent,
  type GameMap,
  LOSS_OF_CONTROL,
  type Landmark,
  type Obstacle,
  TERRAIN,
  type Trap,
  Tile,
  computeVisibility,
  createAutopilot,
  barrierAngle,
  barrierEnds,
  boulderPosition,
  effectiveVision,
  gateClosed,
  hasEffect,
  SKILLS,
  maxHearts,
  obstacleTime,
  patrollerPose,
  patrollerPosition,
  trapArmed,
} from '@cursar/game-core';
import { ENEMY_LABEL, EFFECT_STYLE, TRAP_STYLE } from './effects';
import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Bridge } from './bridge';
import type { MoveIntent, RaceDriver, Track } from './driver';
import { DEFAULT_BINDINGS, type KeyBindings } from './input';

export interface RaceSceneData {
  map: GameMap;
  /** Runs the race: locally in single player, through the server in network play. */
  driver: RaceDriver;
  finishArrow: boolean;
  bridge: Bridge;
  audio: AudioEngine;
  bindings?: KeyBindings;
  /** During the race, clicking (or holding) the mouse runs towards the pointer. */
  mouseMove?: boolean;
  /** Developer aid: the runner follows the shortest route by itself. */
  demo?: boolean;
}

/** Pixels per tile at zoom 1. Purely a rendering choice: the simulation works in tiles. */
const PX = 32;
/** Mouse movement stops this close (tiles) to where you clicked. */
const MOUSE_ARRIVE_TILES = 0.3;
/** How many tiles of the map fit across the shorter side of the window during a race. */
const TILES_ACROSS = 15;

const COLOR = {
  background: 0x0b0d12,
  floor: 0x262c38,
  floorAlt: 0x2a313e,
  wall: 0x5d6a80,
  wallTop: 0x78869e,
  mud: 0x5b4429,
  mudSpot: 0x6d5434,
  ice: 0x8ecbe0,
  iceShine: 0xc4e9f5,
  start: 0x3a4a63,
  ghost: 0xffffff,
  finishArrow: 0x7ee08a,
  checkpoint: 0xff4f9a,
  checkpointDone: 0x8a93a6,
  boulder: 0x9b7b5a,
  boulderEdge: 0x4a3826,
  barrier: 0xe8b04a,
  gate: 0xc9d2e3,
};

/**
 * One colour per plaza. The shape says what kind of landmark it is; the colour
 * tells apart two of the same kind ("the red fountain"). Maps have at most 10
 * plazas, so no two on a map share a colour. None is close to the checkpoint pink.
 */
const LANDMARK_TINTS = [
  0x4aa3ff, // blue
  0xf2d24b, // yellow
  0x4fbf6a, // green
  0xff6b3d, // orange
  0xc77dff, // purple
  0xe8e8f0, // white
  0x3fe0d0, // teal
  0xe5484d, // red
  0xa8e05f, // lime
  0xc08a4a, // bronze
];

/** Rough perceived difference between two colours ("redmean" distance). */
function colourDistance(a: number, b: number): number {
  const [r1, g1, b1] = [a >> 16, (a >> 8) & 0xff, a & 0xff];
  const [r2, g2, b2] = [b >> 16, (b >> 8) & 0xff, b & 0xff];
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

/**
 * Colours for a map's plazas, in the order the map lists them. Each plaza takes
 * the next unused colour, except a second landmark of a kind already seen: it
 * takes the unused colour most unlike the first one's, so the two never look alike.
 */
function plazaTints(landmarks: readonly Landmark[]): number[] {
  const free = [...LANDMARK_TINTS];
  const firstOfKind = new Map<Landmark['kind'], number>();
  return landmarks.map((mark, i) => {
    const first = firstOfKind.get(mark.kind);
    let pick = 0;
    if (first !== undefined) {
      free.forEach((c, j) => {
        if (colourDistance(first, c) > colourDistance(first, free[pick]!)) pick = j;
      });
    }
    const color = free.splice(pick, 1)[0] ?? LANDMARK_TINTS[i % LANDMARK_TINTS.length]!;
    if (first === undefined) firstOfKind.set(mark.kind, color);
    return color;
  });
}

export class RaceScene extends Phaser.Scene {
  private data_!: RaceSceneData;
  private driver!: RaceDriver;
  private routesDrawn = false;
  private autopilot: ReturnType<typeof createAutopilot> | null = null;
  /** Mouse movement: where the runner is heading (tiles), and whether the button is held. */
  private moveTarget: { x: number; y: number } | null = null;
  private mouseHeld = false;
  /** The shove key was pressed since the last tick. */
  private pendingShove = false;
  /** When your last shove started (scene time, ms), for the swipe drawn in front of you. */
  private shoveAt = -1e9;
  private labels = new Map<string, Phaser.GameObjects.Text>();

  private entityGfx!: Phaser.GameObjects.Graphics;
  private fogGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;

  private visible!: Uint8Array;
  private seenAt!: Float32Array;
  private fog!: Float32Array;

  private keys: Record<keyof KeyBindings, Phaser.Input.Keyboard.Key[]> = { up: [], down: [], left: [], right: [], sprint: [] };
  private frame = 0;

  private camX = 0;
  private camY = 0;
  /** The full map is open (M): the runner stands still while the others carry on. */
  private mapOpen = false;
  /** 0 = race view, 1 = full map; eased between them. */
  private mapBlend = 0;
  private lookX = 0;
  private lookY = 0;
  private finishedAt = -1;

  private beaconTimer = 0;
  private heartTimer = 0;
  private warnedSecond = -1;
  private ghostStride = 0;
  private ghostLast: { x: number; y: number } | null = null;
  private rumbleTimer = 0;
  private tellTimer = 0;
  /** An active skill key pressed, sent with the next tick's input. */
  /** "You" above the local runner at the start, so everyone finds themselves at once. */
  private youLabel: Phaser.GameObjects.Text | null = null;
  /** Per patroller (map enemy index): where it was and how far it has walked since its last step sound. */
  private patrolSteps = new Map<number, { x: number; y: number; stride: number }>();
  /** Per obstacle: the last quarter turn of a barrier, or whether a gate was closed, for their sounds. */
  private obstacleMarks = new Map<Obstacle, number>();
  private unsubscribe: (() => void)[] = [];

  constructor(data: RaceSceneData) {
    super('race');
    this.data_ = data;
  }

  create(): void {
    const { map, bridge, driver } = this.data_;
    this.driver = driver;
    if (this.data_.demo) this.autopilot = createAutopilot(map);

    const size = map.width * map.height;
    this.visible = new Uint8Array(size);
    this.seenAt = new Float32Array(size).fill(-1e9);
    this.fog = new Float32Array(size);

    this.cameras.main.setBackgroundColor(COLOR.background);
    this.drawMap();
    this.entityGfx = this.add.graphics().setDepth(10);
    this.fogGfx = this.add.graphics().setDepth(20);
    this.overlayGfx = this.add.graphics().setDepth(30);

    this.camX = (map.width * PX) / 2;
    this.camY = (map.height * PX) / 2;

    const keyboard = this.input.keyboard!;
    const bindings = this.data_.bindings ?? DEFAULT_BINDINGS;
    for (const action of Object.keys(bindings) as (keyof KeyBindings)[]) {
      this.keys[action] = bindings[action].map((name) => keyboard.addKey(name));
    }
    if (driver.canPause) {
      keyboard.on('keydown-ESC', () => driver.setPaused(!driver.paused));
      keyboard.on('keydown-R', () => bridge.emit('restart'));
    }
    keyboard.on('keydown-ENTER', () => driver.ready());
    keyboard.on('keydown-M', () => this.toggleMap());
    keyboard.addCapture('SPACE');
    keyboard.on('keydown-SPACE', () => (this.pendingShove = true));
    // Skill cards: 1, 2, 3.
    (['ONE', 'TWO', 'THREE'] as const).forEach((key, slot) => keyboard.on(`keydown-${key}`, () => this.pick(slot)));
    keyboard.on('keydown-BACKSPACE', () => {
      if (this.state.phase === 'preview' && driver.removeLastMarker()) this.data_.audio.click();
    });

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerup', () => (this.mouseHeld = false));
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.state.phase === 'racing' && this.data_.mouseMove) {
        // Mouse movement: a click sets where to run, holding keeps following the pointer, a right click stops.
        if (pointer.rightButtonDown()) {
          this.moveTarget = null;
          return;
        }
        this.mouseHeld = true;
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.moveTarget = { x: world.x / PX, y: world.y / PX };
        return;
      }
      if (this.state.phase !== 'preview') return;
      if (pointer.rightButtonDown()) {
        if (driver.removeLastMarker()) this.data_.audio.click();
        return;
      }
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (driver.placeMarker(world.x / PX, world.y / PX)) {
        this.data_.audio.markerPlaced(this.me().markers.length - 1);
      } else {
        this.data_.audio.denied();
      }
    });

    this.unsubscribe.push(
      bridge.on('skipPreview', () => driver.ready()),
      bridge.on('setPaused', (paused) => driver.setPaused(paused)),
      bridge.on('testEffect', (kind) => driver.testEffect?.(kind)),
      bridge.on('toggleMap', () => this.toggleMap()),
      bridge.on('pick', (slot) => this.pick(slot)),
      bridge.on('testPoints', () => driver.testPoints?.()),
      bridge.on('testHurt', () => driver.testHurt?.()),
    );
    const onBlur = () => driver.setPaused(true);
    window.addEventListener('blur', onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup(onBlur));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup(onBlur));
  }

  private cleanup(onBlur: () => void): void {
    window.removeEventListener('blur', onBlur);
    this.unsubscribe.forEach((off) => off());
    this.unsubscribe = [];
    this.driver.destroy();
  }

  private get state() {
    return this.driver.state;
  }

  private me() {
    return this.state.players[0]!;
  }

  /** True while the local runner is racing with a restricted view. */
  private racingView(): boolean {
    return this.state.phase === 'racing' && !this.me().finished;
  }

  /** Takes a card from the offer, during the race. */
  private pick(slot: number): void {
    if (this.racingView() && !this.driver.paused && this.me().offer) this.driver.pick(slot);
  }

  /** True while the full map is open during the race. */
  private peeking(): boolean {
    return this.mapOpen && this.racingView();
  }

  /** Opens or closes the full map. Only during the race, and not while paused. */
  private toggleMap(): void {
    if (!this.racingView() || this.driver.paused) return;
    this.mapOpen = !this.mapOpen;
    this.data_.audio.click();
  }

  /** True once the local runner is done: the whole map is shown again. */
  private overview(): boolean {
    return this.state.phase === 'finished' || this.me().finished;
  }

  // --- Simulation ---------------------------------------------------------

  update(_time: number, deltaMs: number): void {
    const { driver } = this;
    for (const event of driver.advance(deltaMs, () => this.readIntent())) this.handleEvent(event);

    const dt = Math.min(0.1, deltaMs / 1000);
    if (!this.racingView()) this.mapOpen = false;
    this.mapBlend += ((this.mapOpen ? 1 : 0) - this.mapBlend) * Math.min(1, dt * 8);
    if (Math.abs(this.mapBlend - (this.mapOpen ? 1 : 0)) < 0.01) this.mapBlend = this.mapOpen ? 1 : 0;
    if (this.racingView() && !driver.paused && this.state.resumeTime === 0) this.ambientAudio(dt);
    if (this.overview()) {
      if (this.finishedAt < 0) this.finishedAt = this.time.now;
      if (!this.routesDrawn && this.state.phase === 'finished') {
        const routes = driver.routes();
        if (routes) {
          this.routesDrawn = true;
          this.drawRoutes(routes);
        }
      }
    }

    const { x, y } = driver.position();
    this.updateCamera(x, y, dt);
    this.updateFog(dt);
    this.drawEntities(x, y);

    if (this.frame++ % 2 === 0) this.emitHud();
  }

  private readIntent(): MoveIntent {
    // Looking at the full map costs time: the runner cannot move meanwhile.
    if (this.peeking()) {
      this.pendingShove = false;
      return { mx: 0, my: 0, sprint: false };
    }
    if (this.autopilot) {
      const { mx, my, sprint } = this.autopilot(this.me());
      return { mx, my, sprint };
    }
    const down = (action: keyof KeyBindings) => this.keys[action].some((key) => key.isDown);
    const mx = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    const my = (down('down') ? 1 : 0) - (down('up') ? 1 : 0);
    const sprint = down('sprint');
    const shove = this.pendingShove && this.state.phase === 'racing';
    this.pendingShove = false;
    const withShove = (intent: MoveIntent): MoveIntent => (shove ? { ...intent, shove: true } : intent);
    // The keys always win over mouse movement, and cancel it.
    if (mx !== 0 || my !== 0 || this.state.phase !== 'racing') {
      this.moveTarget = null;
      return withShove({ mx, my, sprint });
    }
    if (this.mouseHeld) {
      const pointer = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.moveTarget = { x: world.x / PX, y: world.y / PX };
    }
    if (this.moveTarget) {
      const me = this.me();
      const dx = this.moveTarget.x - me.x;
      const dy = this.moveTarget.y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist < MOUSE_ARRIVE_TILES) {
        if (!this.mouseHeld) this.moveTarget = null;
        return withShove({ mx: 0, my: 0, sprint });
      }
      return withShove({ mx: dx / dist, my: dy / dist, sprint });
    }
    return withShove({ mx: 0, my: 0, sprint });
  }

  private handleEvent(event: GameEvent): void {
    const { audio, bridge } = this.data_;
    const me = this.me();
    switch (event.type) {
      case 'countdown':
        audio.countdown();
        break;
      case 'resumed':
        audio.go();
        break;
      case 'phase':
        if (event.phase === 'racing') audio.go();
        if (event.phase === 'finished' && !me.finished) audio.timeUp();
        break;
      case 'footstep':
        audio.footstep(event.terrain, event.sprinting);
        break;
      case 'bump':
        audio.bump(event.speed);
        this.cameras.main.shake(90, Math.min(0.006, event.speed / 1500));
        break;
      case 'exhausted':
        audio.exhausted();
        break;
      case 'marker':
        audio.markerReached();
        break;
      case 'checkpoint':
        audio.checkpoint(event.remaining);
        if (event.playerId === me.id && me.skills.includes('reveal')) audio.reveal();
        break;
      case 'finishLocked':
        audio.finishLocked();
        break;
      case 'finish':
        if (event.playerId === me.id) {
          audio.finish(this.driver.celebrate(event));
        } else {
          audio.rivalFinished();
          bridge.emit('notice', `${this.driver.runnerName(event.playerId)} finished${event.place === 1 ? ' first' : ''}`);
        }
        break;
      case 'effect':
        if (event.playerId === me.id) audio.effect(event.kind);
        break;
      case 'effectEnd':
        if (event.playerId === me.id && LOSS_OF_CONTROL.has(event.kind) && !me.effects.some((e) => LOSS_OF_CONTROL.has(e.kind))) {
          audio.controlBack();
        }
        break;
      case 'trap':
        if (event.playerId === me.id) {
          audio.trapSpring();
          bridge.emit('notice', TRAP_STYLE[event.kind].label);
        }
        break;
      case 'enemyHit':
        if (event.playerId === me.id) bridge.emit('notice', ENEMY_LABEL[event.kind]);
        break;
      case 'shove':
        if (event.playerId === me.id) {
          audio.shove();
          this.shoveAt = this.time.now;
        }
        break;
      case 'shoveHit':
        if (event.playerId === me.id) audio.shoveHit();
        break;
      case 'shoved':
        if (event.playerId === me.id) {
          audio.shoved();
          bridge.emit('notice', `Shoved by ${this.driver.rivals().find((r) => r.id === event.by)?.name ?? 'a rival'}`);
        }
        break;
      case 'foeHeard':
        audio.foe(event.sound, event.pan, event.closeness, event.aimed);
        break;
      case 'treasure':
        if (event.playerId === me.id) audio.treasure();
        break;
      case 'offer':
        if (event.playerId === me.id) audio.offer();
        break;
      case 'skill':
        if (event.playerId === me.id) {
          audio.skill();
          bridge.emit('notice', SKILLS[event.skill].name);
        }
        break;
      case 'trapClick':
        if (event.playerId === me.id) audio.trapClick();
        break;
      case 'hurt':
        if (event.playerId === me.id) {
          audio.hurt(event.health);
          if (event.health > 0) this.cameras.main.shake(120, 0.006);
        }
        break;
      case 'respawn':
        if (event.playerId === me.id) audio.respawn();
        break;
      case 'effectResisted':
        if (event.playerId === me.id) audio.resisted();
        break;
      case 'rivalStep':
        audio.rivalStep(event.pan, event.closeness);
        break;
    }
  }

  /** Sounds that depend on where you are rather than on a single event. */
  private ambientAudio(dt: number): void {
    const { state } = this;
    const { audio } = this.data_;
    const me = this.me();

    // Objective beacon: the nearest untouched checkpoint, or the finish once it is open.
    this.beaconTimer -= dt;
    if (this.beaconTimer <= 0) {
      this.beaconTimer = 1.5;
      const target = this.objective(me.x, me.y);
      const range = 16;
      const dist = Math.hypot(target.dx, target.dy);
      if (dist < range) audio.beacon(target.dx / 6, 1 - dist / range, target.finish);
    }

    // Heartbeat when stamina is low.
    const staminaShare = me.stamina / state.config.sprint.staminaMax;
    this.heartTimer -= dt;
    if (staminaShare < 0.35 && this.heartTimer <= 0) {
      const intensity = 1 - staminaShare / 0.35;
      this.heartTimer = 0.85 - 0.4 * intensity;
      audio.heartbeat(intensity);
    }

    // Clock ticks near the cut-off.
    const left = state.deadline - state.raceTime;
    const second = Math.ceil(left);
    if (left <= 30 && second !== this.warnedSecond) {
      this.warnedSecond = second;
      if (left <= 10 || second % 5 === 0) audio.timeWarning(left <= 10);
    }

    // The ghost's footsteps.
    const g = this.driver.ghost();
    if (g && this.ghostLast) {
      this.ghostStride += Math.hypot(g.x - this.ghostLast.x, g.y - this.ghostLast.y);
      if (this.ghostStride >= state.config.player.strideLength) {
        this.ghostStride = 0;
        const dist = Math.hypot(g.x - me.x, g.y - me.y);
        if (dist < 9) audio.rivalStep((g.x - me.x) / 5, 1 - dist / 9);
      }
    }
    this.ghostLast = g;

    this.obstacleAudio(dt);
    this.trapAudio(dt);
    this.patrollerAudio();
  }

  /** Patrollers follow the clock, so their regular steps are worked out here. */
  private patrollerAudio(): void {
    const { state } = this;
    const me = this.me();
    const t = obstacleTime(state);
    const range = 9;
    (this.data_.map.enemies ?? []).forEach((e, index) => {
      if (e.kind !== 'patroller') return;
      const at = patrollerPosition(state.config, e, t);
      const last = this.patrolSteps.get(index) ?? { x: at.x, y: at.y, stride: 0 };
      last.stride += Math.hypot(at.x - last.x, at.y - last.y);
      last.x = at.x;
      last.y = at.y;
      if (last.stride >= 0.9) {
        last.stride = 0;
        const dist = Math.hypot(at.x - me.x, at.y - me.y);
        if (dist < range) this.data_.audio.patrollerStep((at.x - me.x) / 6, 1 - dist / range);
      }
      this.patrolSteps.set(index, last);
    });
  }

  /** The nearest armed trap within earshot ticks faintly: the trap tell. */
  private trapAudio(dt: number): void {
    this.tellTimer -= dt;
    if (this.tellTimer > 0) return;
    this.tellTimer = 0.5;
    const { state } = this;
    const me = this.me();
    const range = state.config.traps.tellDistance;
    let nearest: { dx: number; dist: number } | null = null;
    (this.data_.map.traps ?? []).forEach((trap, i) => {
      if (!trapArmed(state, i)) return;
      const dx = trap.x + 0.5 - me.x;
      const dist = Math.hypot(dx, trap.y + 0.5 - me.y);
      if (dist < range && (!nearest || dist < nearest.dist)) nearest = { dx, dist };
    });
    const found = nearest as { dx: number; dist: number } | null;
    if (found) this.data_.audio.trapTell(found.dx / 3, 1 - found.dist / range);
  }

  /**
   * Obstacles are heard before they are seen: boulders rumble (higher while
   * coming towards you), barriers click at every quarter turn, gates clunk as
   * they open and close.
   */
  private obstacleAudio(dt: number): void {
    const { state } = this;
    const { audio, map } = this.data_;
    const me = this.me();
    const t = obstacleTime(state);
    this.rumbleTimer -= dt;
    const rumble = this.rumbleTimer <= 0;
    if (rumble) this.rumbleTimer = 0.22;
    for (const o of map.obstacles ?? []) {
      if (o.kind === 'boulder') {
        if (!rumble) continue;
        const b = boulderPosition(state.config, o, t);
        const dist = Math.hypot(b.x - me.x, b.y - me.y);
        if (dist >= 11) continue;
        const soon = boulderPosition(state.config, o, t + 0.1);
        const approaching = Math.hypot(soon.x - me.x, soon.y - me.y) < dist;
        audio.rumble((b.x - me.x) / 6, 1 - dist / 11, approaching);
      } else if (o.kind === 'barrier') {
        const quarter = Math.floor((barrierAngle(state.config, o, t) * o.dir) / (Math.PI / 2));
        const last = this.obstacleMarks.get(o);
        this.obstacleMarks.set(o, quarter);
        const dist = Math.hypot(o.x - me.x, o.y - me.y);
        if (last !== undefined && last !== quarter && dist < 10) audio.barrierClick((o.x - me.x) / 6, 1 - dist / 10);
      } else {
        const closed = gateClosed(state.config, o, t) ? 1 : 0;
        const last = this.obstacleMarks.get(o);
        this.obstacleMarks.set(o, closed);
        const gx = o.x + o.w / 2;
        const gy = o.y + o.h / 2;
        const dist = Math.hypot(gx - me.x, gy - me.y);
        if (last !== undefined && last !== closed && dist < 10) audio.gate(closed === 1, (gx - me.x) / 6, 1 - dist / 10);
      }
    }
  }

  /** Straight-line offset to the nearest untouched checkpoint, or to the finish when none are left. */
  private objective(x: number, y: number): { dx: number; dy: number; finish: boolean } {
    const { map } = this.data_;
    const me = this.me();
    let best: { dx: number; dy: number; finish: boolean } | null = null;
    map.checkpoints.forEach((zone, index) => {
      if (me.checkpoints[index]) return;
      const dx = zone.x + zone.w / 2 - x;
      const dy = zone.y + zone.h / 2 - y;
      if (!best || Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy)) best = { dx, dy, finish: false };
    });
    return best ?? { dx: map.finish.x + map.finish.w / 2 - x, dy: map.finish.y + map.finish.h / 2 - y, finish: true };
  }

  // --- Camera -------------------------------------------------------------

  /** Screen space kept clear for the HUD and results when the whole map is shown. */
  private insets(): { top: number; right: number; bottom: number } {
    const side = this.driver.resultsLayout === 'side';
    if (this.state.phase === 'finished') return side ? { top: 70, right: 400, bottom: 20 } : { top: 250, right: 0, bottom: 20 };
    if (this.overview()) return { top: 130, right: 0, bottom: 20 };
    // The full map during the race: keep clear of the banner and the hearts and stamina.
    if (this.mapOpen) return { top: 130, right: 0, bottom: 80 };
    return { top: 185, right: 0, bottom: 20 };
  }

  private overviewZoom(): number {
    const { map } = this.data_;
    const cam = this.cameras.main;
    const inset = this.insets();
    const freeW = Math.max(200, cam.width - inset.right - 24);
    const freeH = Math.max(150, cam.height - inset.top - inset.bottom);
    return Math.max(0.05, Math.min(freeW / (map.width * PX), freeH / (map.height * PX)));
  }

  /** Camera centre that places the map in the space left free by the HUD. */
  private overviewCentre(): { x: number; y: number } {
    const { map } = this.data_;
    const inset = this.insets();
    const zoom = this.overviewZoom();
    return {
      x: (map.width * PX) / 2 + inset.right / 2 / zoom,
      y: (map.height * PX) / 2 - (inset.top - inset.bottom) / 2 / zoom,
    };
  }

  private raceZoom(): number {
    const cam = this.cameras.main;
    return Math.min(cam.width, cam.height) / (TILES_ACROSS * PX);
  }

  private updateCamera(px: number, py: number, dt: number): void {
    const { state } = this;
    const cam = this.cameras.main;
    const centre = this.overviewCentre();
    const mapCx = centre.x;
    const mapCy = centre.y;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    const zoomMix = (a: number, b: number, t: number) => a * Math.pow(b / a, t);

    // Look a little ahead of the runner, since that is where the vision is.
    const me = this.me();
    const lead = 2.2 * PX;
    const follow = Math.min(1, dt * 3);
    this.lookX += (Math.cos(me.facing) * lead - this.lookX) * follow;
    this.lookY += (Math.sin(me.facing) * lead - this.lookY) * follow;
    const targetX = px * PX + this.lookX;
    const targetY = py * PX + this.lookY;

    if (state.phase === 'preview') {
      cam.setZoom(this.overviewZoom());
      this.camX = mapCx;
      this.camY = mapCy;
    } else if (state.phase === 'countdown') {
      const t = ease(1 - state.phaseTime / state.config.race.countdownSeconds);
      cam.setZoom(zoomMix(this.overviewZoom(), this.raceZoom(), t));
      this.camX = mix(mapCx, targetX, t);
      this.camY = mix(mapCy, targetY, t);
    } else if (this.racingView()) {
      // With the full map open, pull back to show it all.
      const t = ease(this.mapBlend);
      cam.setZoom(zoomMix(this.raceZoom(), this.overviewZoom(), t));
      this.camX = mix(targetX, mapCx, t);
      this.camY = mix(targetY, mapCy, t);
    } else {
      // Finished: pull back out to show the whole map and the route taken.
      const t = ease(Math.min(1, (this.time.now - this.finishedAt) / 1600));
      cam.setZoom(zoomMix(this.raceZoom(), this.overviewZoom(), t));
      this.camX = mix(this.camX, mapCx, Math.min(1, dt * 4) * t);
      this.camY = mix(this.camY, mapCy, Math.min(1, dt * 4) * t);
    }
    cam.centerOn(this.camX, this.camY);
  }

  // --- Fog and memory -----------------------------------------------------

  private updateFog(dt: number): void {
    const { state, fog, visible, seenAt } = this;
    const { map } = this.data_;
    const racing = this.racingView();
    const me = this.me();
    // Blinded, you lose your memory of the map too, until the effect ends.
    const memory = hasEffect(me, 'blind') ? 0 : effectiveVision(state.config, me).memorySeconds;

    if (racing) {
      computeVisibility(map, me.x, me.y, me.facing, effectiveVision(state.config, me), visible);
      for (let i = 0; i < visible.length; i++) if (visible[i]) seenAt[i] = state.raceTime;
    }

    const view = this.cameras.main.worldView;
    const x0 = Math.max(0, Math.floor(view.x / PX) - 1);
    const y0 = Math.max(0, Math.floor(view.y / PX) - 1);
    const x1 = Math.min(map.width - 1, Math.ceil(view.right / PX) + 1);
    const y1 = Math.min(map.height - 1, Math.ceil(view.bottom / PX) + 1);
    const blend = Math.min(1, dt * (racing ? 9 : 2.5));

    this.fogGfx.clear();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * map.width + tx;
        let target = 0;
        if (racing && !visible[i] && !this.mapOpen) {
          const age = state.raceTime - seenAt[i]!;
          if (memory > 0 && age < memory) {
            // Remembered tiles stay dim, then fade to black over the last third of the memory time.
            const fade = Math.max(0, (age / memory - 0.67) / 0.33);
            target = 0.62 + 0.38 * fade;
          } else {
            target = 1;
          }
        }
        const value = (fog[i] = fog[i]! + (target - fog[i]!) * blend);
        if (value > 0.01) {
          this.fogGfx.fillStyle(COLOR.background, Math.min(1, value));
          this.fogGfx.fillRect(tx * PX, ty * PX, PX, PX);
        }
      }
    }
  }

  /** Whether something at this position may be drawn: during a race, only inside the current view. */
  private isVisibleTile(x: number, y: number): boolean {
    if (!this.racingView() || this.peeking()) return true;
    const { map } = this.data_;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
    return this.visible[ty * map.width + tx] === 1;
  }

  // --- Drawing ------------------------------------------------------------

  private drawMap(): void {
    const { map } = this.data_;
    const g = this.add.graphics().setDepth(0);
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const code = map.tiles[ty * map.width + tx]!;
        const x = tx * PX;
        const y = ty * PX;
        if (code === Tile.Wall) {
          g.fillStyle(COLOR.wall).fillRect(x, y, PX, PX);
          // Light edge only where the wall borders open ground above it.
          if (ty > 0 && map.tiles[(ty - 1) * map.width + tx] !== Tile.Wall) g.fillStyle(COLOR.wallTop).fillRect(x, y, PX, 6);
        } else if (code === Tile.Mud) {
          g.fillStyle(COLOR.mud).fillRect(x, y, PX, PX);
          g.fillStyle(COLOR.mudSpot).fillCircle(x + 9, y + 11, 4).fillCircle(x + 22, y + 21, 5);
        } else if (code === Tile.Ice) {
          g.fillStyle(COLOR.ice).fillRect(x, y, PX, PX);
          g.lineStyle(2, COLOR.iceShine, 0.9).lineBetween(x + 6, y + 22, x + 18, y + 8).lineBetween(x + 18, y + 26, x + 26, y + 16);
        } else {
          g.fillStyle((tx + ty) % 2 === 0 ? COLOR.floor : COLOR.floorAlt).fillRect(x, y, PX, PX);
        }
      }
    }

    // Start plaza marking.
    for (const p of map.startPositions) {
      g.lineStyle(2, COLOR.start, 1).strokeCircle(p.x * PX, p.y * PX, PX * 0.38);
    }

    // Finish zone: chequered flag pattern.
    const f = map.finish;
    const cell = PX / 2;
    for (let cy = 0; cy < f.h * 2; cy++) {
      for (let cx = 0; cx < f.w * 2; cx++) {
        g.fillStyle((cx + cy) % 2 === 0 ? 0xf2f2f2 : 0x16181d).fillRect(f.x * PX + cx * cell, f.y * PX + cy * cell, cell, cell);
      }
    }
    g.lineStyle(3, COLOR.finishArrow, 1).strokeRect(f.x * PX, f.y * PX, f.w * PX, f.h * PX);

    // Landmarks: the shape gives the kind, the colour picks out the plaza.
    const tints = plazaTints(map.landmarks);
    map.landmarks.forEach((mark, i) => this.drawLandmark(g, mark, tints[i]!));
  }

  /** After the race: the routes taken, drawn over the revealed map. */
  private drawRoutes(tracks: Track[]): void {
    const g = this.add.graphics().setDepth(5);
    for (const track of tracks) {
      const { samples, stride } = track;
      if (samples.length < stride * 2) continue;
      g.lineStyle(track.width, track.color, track.alpha).beginPath();
      g.moveTo(samples[0]! * PX, samples[1]! * PX);
      for (let i = stride; i + 1 < samples.length; i += stride) g.lineTo(samples[i]! * PX, samples[i + 1]! * PX);
      g.strokePath();
    }
  }

  private drawLandmark(g: Phaser.GameObjects.Graphics, mark: Landmark, color: number): void {
    const x = mark.x * PX;
    const y = mark.y * PX;
    const r = PX * 0.8;
    g.fillStyle(color, 0.16).fillCircle(x, y, PX * 2.1);
    g.fillStyle(color, 1).lineStyle(3, color, 1);
    switch (mark.kind) {
      case 'fountain':
        g.strokeCircle(x, y, r).fillCircle(x, y, r * 0.45);
        break;
      case 'statue':
        g.fillRect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
        break;
      case 'tree':
        g.fillCircle(x - r * 0.4, y + r * 0.2, r * 0.6).fillCircle(x + r * 0.4, y + r * 0.2, r * 0.6).fillCircle(x, y - r * 0.4, r * 0.65);
        break;
      case 'crystal':
        g.fillPoints([{ x, y: y - r * 1.1 }, { x: x + r * 0.7, y }, { x, y: y + r * 1.1 }, { x: x - r * 0.7, y }], true);
        break;
      case 'brazier':
        g.fillTriangle(x, y - r, x + r * 0.9, y + r * 0.7, x - r * 0.9, y + r * 0.7);
        break;
      case 'obelisk':
        g.fillRect(x - r * 0.3, y - r * 1.1, r * 0.6, r * 2.2).fillRect(x - r * 0.9, y - r * 0.3, r * 1.8, r * 0.6);
        break;
    }
  }

  private drawEntities(px: number, py: number): void {
    const { state } = this;
    const { map, finishArrow } = this.data_;
    const me = this.me();
    const g = this.entityGfx;
    const top = this.overlayGfx;
    g.clear();
    top.clear();
    const racing = this.racingView();
    const mine = me.color;

    // Checkpoints: pink flags until touched, then a grey tick.
    const preview = state.phase === 'preview';
    map.checkpoints.forEach((zone, index) => {
      const zx = zone.x * PX;
      const zy = zone.y * PX;
      const zw = zone.w * PX;
      const zh = zone.h * PX;
      const cx = zx + zw / 2;
      const cy = zy + zh / 2;
      if (me.checkpoints[index]) {
        g.lineStyle(3, COLOR.checkpointDone, 0.9).strokeRect(zx + 2, zy + 2, zw - 4, zh - 4);
        g.lineStyle(5, COLOR.checkpointDone, 0.9).beginPath();
        g.moveTo(cx - 14, cy).lineTo(cx - 4, cy + 11).lineTo(cx + 15, cy - 12).strokePath();
        return;
      }
      g.fillStyle(COLOR.checkpoint, 0.28).fillRect(zx, zy, zw, zh);
      g.lineStyle(3, COLOR.checkpoint, 1).strokeRect(zx + 1.5, zy + 1.5, zw - 3, zh - 3);
      g.fillStyle(0xffffff, 1).fillRect(cx - 12, cy - 20, 4, 40);
      g.fillStyle(COLOR.checkpoint, 1).fillTriangle(cx - 8, cy - 20, cx + 18, cy - 9, cx - 8, cy + 2);
      if (preview) g.lineStyle(4, COLOR.checkpoint, 0.9).strokeCircle(cx, cy, PX * 2 + Math.sin(this.time.now / 220 + index) * 5);
    });

    // The finish is shaded while checkpoints remain.
    if (racing && me.checkpoints.includes(false)) {
      g.fillStyle(COLOR.background, 0.6).fillRect(map.finish.x * PX, map.finish.y * PX, map.finish.w * PX, map.finish.h * PX);
    }

    // Footprints: where you have been, and where rivals have been inside your view.
    if (!this.overview()) {
      const life = state.config.footprints.lifetimeSeconds;
      for (const print of me.footprints) {
        if (!this.isVisibleTile(print.x, print.y)) continue;
        g.fillStyle(mine, 0.45 * (1 - (state.raceTime - print.t) / life)).fillCircle(print.x * PX, print.y * PX, 3.5);
      }
      for (const print of this.driver.rivalPrints()) {
        const fade = 1 - (state.raceTime - print.t) / life;
        if (fade > 0) g.fillStyle(print.color, 0.55 * fade).fillCircle(print.x * PX, print.y * PX, 3.5);
      }
    }

    this.drawTreasures(g);
    this.drawTraps(g, top);
    this.drawObstacles(g);
    this.drawEnemies(g, top);

    // Rivals. In a race the server only sends the ones inside your view.
    const r = state.config.player.radius * PX;
    const zoom = this.cameras.main.zoom;
    const shown = new Set<string>();
    for (const rival of this.driver.rivals()) {
      const rx = rival.x * PX;
      const ry = rival.y * PX;
      if (rival.safe && this.flickerOff()) continue;
      g.fillStyle(rival.color, 1).fillCircle(rx, ry, r);
      g.fillStyle(0xffffff, 1).fillPoints(
        [0, 0.9, -0.9].map((a, i) => {
          const d = i === 0 ? r * 1.55 : r * 0.75;
          return { x: rx + Math.cos(rival.facing + a) * d, y: ry + Math.sin(rival.facing + a) * d };
        }),
        true,
      );
      g.lineStyle(2, 0x10131a, 1).strokeCircle(rx, ry, r);
      this.drawEffects(top, rx, ry, r, rival.fx.map((kind) => ({ kind, time: 1, total: 1 })));
      let label = this.labels.get(rival.id);
      if (!label) {
        label = this.add
          .text(0, 0, rival.name, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#e8ecf3', stroke: '#0b0d12', strokeThickness: 4 })
          .setOrigin(0.5, 1)
          .setDepth(25);
        this.labels.set(rival.id, label);
      }
      // Keep names a readable size however far the camera is zoomed out.
      label.setPosition(rx, ry - r - 4).setScale(Math.min(2.4, 1 / zoom)).setVisible(true);
      shown.add(rival.id);
    }
    for (const [id, label] of this.labels) if (!shown.has(id)) label.setVisible(false);

    // Ghost of the best run on this map.
    {
      const sample = this.driver.ghost();
      if (sample && !this.peeking() && this.isVisibleTile(sample.x, sample.y)) {
        const gx = sample.x * PX;
        const gy = sample.y * PX;
        g.fillStyle(COLOR.ghost, 0.22).fillCircle(gx, gy, PX * 0.3);
        g.lineStyle(2, COLOR.ghost, 0.75).strokeCircle(gx, gy, PX * 0.3);
        g.lineBetween(gx, gy, gx + Math.cos(sample.facing) * PX * 0.42, gy + Math.sin(sample.facing) * PX * 0.42);
      }
    }

    // The runner: a disc with a nose showing the facing direction.
    const x = px * PX;
    const y = py * PX;
    const nose = (angle: number, dist: number) => ({ x: x + Math.cos(me.facing + angle) * dist, y: y + Math.sin(me.facing + angle) * dist });
    const scale = state.phase === 'preview' ? 2.4 : 1 + 1.4 * this.mapBlend;
    // Flickers during the safe time after a respawn.
    const alpha = me.safeTime > 0 && this.flickerOff() ? 0.2 : 1;
    // A pulsing ring makes the runner easy to find on the whole map.
    if (state.phase === 'preview' || this.mapBlend > 0.5) g.lineStyle(3, mine, 0.9).strokeCircle(x, y, r * 4 + Math.sin(this.time.now / 180) * 4);
    g.fillStyle(mine, alpha).fillCircle(x, y, r * scale);
    g.fillStyle(0xffffff, alpha).fillPoints([nose(0, r * 1.55 * scale), nose(0.9, r * 0.75 * scale), nose(-0.9, r * 0.75 * scale)], true);
    // A shove: a short white swipe across the cone in front.
    const swipe = (this.time.now - this.shoveAt) / (state.config.combat.activeSeconds * 1000);
    if (swipe >= 0 && swipe < 1) {
      const reach = (state.config.player.radius * 2 + state.config.combat.reach) * PX;
      g.lineStyle(4, 0xffffff, 1 - swipe);
      g.beginPath();
      g.arc(x, y, reach * (0.7 + 0.3 * swipe), me.facing - state.config.combat.arc, me.facing + state.config.combat.arc);
      g.strokePath();
    }
    g.lineStyle(2, 0x1a1205, alpha).strokeCircle(x, y, r * scale);

    // Stamina ring round the runner whenever it is not full.
    const share = me.stamina / state.config.sprint.staminaMax;
    if (racing && share < 0.999) {
      const color = me.exhausted ? 0xff5a4f : 0x7ee08a;
      top.lineStyle(3, color, 0.9).beginPath();
      top.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share, false).strokePath();
    }

    if (racing) this.drawEffects(top, x, y, r, me.effects);
    this.drawYou(top, x, y, r * scale);

    // Waypoint flags (the player's own notes, so they show through the fog).
    me.markers.forEach((marker, index) => {
      if (marker.reached) return;
      const mx = marker.x * PX;
      const my = marker.y * PX;
      const big = state.phase === 'preview' ? 2.2 : 1;
      top.lineStyle(3 * big, mine, 1).strokeCircle(mx, my, PX * 0.42 * big);
      for (let dot = 0; dot <= index; dot++) {
        top.fillStyle(mine, 1).fillCircle(mx + (dot - index / 2) * 9 * big, my, 3 * big);
      }
    });

    // Compass arrows round the runner: next waypoint, and optionally the next objective.
    if (racing) {
      const next = me.markers.find((marker) => !marker.reached);
      if (next) this.drawArrow(top, x, y, next.x - px, next.y - py, mine);
      if (finishArrow || me.homingTime > 0) {
        const target = this.objective(px, py);
        this.drawArrow(top, x, y, target.dx, target.dy, target.finish ? COLOR.finishArrow : COLOR.checkpoint);
      }
    }
  }

  /**
   * Enemies. Patrollers follow the clock and are worked out here; chasers,
   * turrets and bolts come from the driver (in network play, only those in
   * view). During the race only what is inside your view is drawn.
   */
  private drawEnemies(g: Phaser.GameObjects.Graphics, top: Phaser.GameObjects.Graphics): void {
    const { state } = this;
    const { config } = state;
    const spawns = this.data_.map.enemies ?? [];
    const t = obstacleTime(state);
    // Larger on the whole-map views, so they can be picked out and remembered.
    const whole = !this.racingView() || this.peeking();
    const k = whole ? 1.8 : 1;
    spawns.forEach((e) => {
      if (e.kind !== 'patroller') return;
      if (whole) {
        // The beat it walks.
        g.lineStyle(3, 0x8e5bd6, 0.45).strokePoints(e.path.map((pt) => ({ x: pt.x * PX, y: pt.y * PX })), false, false);
      }
      const at = patrollerPose(config, e, t);
      // The Reveal skill shows patrollers close by through the fog.
      const me = this.me();
      const revealed = !this.isVisibleTile(at.x, at.y) && this.revealing() && Math.hypot(at.x - me.x, at.y - me.y) <= config.skills.reveal.range;
      if (!this.isVisibleTile(at.x, at.y) && !revealed) return;
      const pen = revealed ? top : g;
      const r = config.enemies.patroller.radius * PX * k;
      const x = at.x * PX;
      const y = at.y * PX;
      const heading = at.heading;
      // A purple diamond with a pointer.
      const pts = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((a) => ({ x: x + Math.cos(a + heading) * r * 1.25, y: y + Math.sin(a + heading) * r * 1.25 }));
      pen.fillStyle(0x8e5bd6, 1).fillPoints(pts, true);
      pen.lineStyle(2, 0x2a1640, 1).strokePoints(pts, true, true);
      pen.fillStyle(0xffe066, 1).fillCircle(x, y, r * 0.35);
    });
    // The full map during the race shows where turrets stand and chasers live
    // (that is part of the map), never where a chaser is now.
    const shown = this.peeking()
      ? spawns.flatMap((e, index) => (e.kind === 'patroller' ? [] : [{ index, x: e.x, y: e.y, angle: Math.PI / 2, mode: 0 }]))
      : this.driver.foes();
    for (const foe of shown) {
      const spawn = spawns[foe.index];
      if (!spawn || !this.isVisibleTile(foe.x, foe.y)) continue;
      const x = foe.x * PX;
      const y = foe.y * PX;
      if (spawn.kind === 'chaser') {
        const r = config.enemies.chaser.radius * PX * k;
        const awake = foe.mode !== 0;
        const dazed = foe.mode === 3;
        g.fillStyle(dazed ? 0xa0605a : awake ? 0xd9342b : 0x7a2a26, 1).fillCircle(x, y, r);
        g.lineStyle(2, 0x2b0907, 1).strokeCircle(x, y, r);
        // Eyes: open and looking ahead when awake, shut when asleep.
        for (const side of [-0.45, 0.45]) {
          const ex = x + Math.cos(foe.angle + side) * r * 0.55;
          const ey = y + Math.sin(foe.angle + side) * r * 0.55;
          if (dazed) {
            // Dazed after a shove: crossed eyes.
            g.lineStyle(2, 0xfff3a0, 1).lineBetween(ex - r * 0.15, ey - r * 0.15, ex + r * 0.15, ey + r * 0.15);
            g.lineBetween(ex - r * 0.15, ey + r * 0.15, ex + r * 0.15, ey - r * 0.15);
          } else if (awake) g.fillStyle(0xfff3a0, 1).fillCircle(ex, ey, r * 0.22);
          else g.lineStyle(2, 0xffb3a8, 1).lineBetween(ex - r * 0.18, ey, ex + r * 0.18, ey);
        }
      } else {
        // A turret: a square base and a barrel that glows while it whirs.
        const s = PX * 0.36 * k;
        g.fillStyle(0x3a4252, 1).fillRect(x - s, y - s, s * 2, s * 2);
        g.lineStyle(2, 0x10131a, 1).strokeRect(x - s, y - s, s * 2, s * 2);
        g.lineStyle(6, foe.mode === 1 ? 0xff9f1c : 0xaab4c8, 1);
        g.lineBetween(x, y, x + Math.cos(foe.angle) * PX * 0.55 * k, y + Math.sin(foe.angle) * PX * 0.55 * k);
        g.fillStyle(foe.mode === 1 ? 0xff9f1c : 0x5d6a80, 1).fillCircle(x, y, s * 0.55);
      }
    }
    for (const b of this.driver.bolts()) {
      if (!this.isVisibleTile(b.x, b.y)) continue;
      g.fillStyle(0xffb347, 0.35).fillCircle(b.x * PX, b.y * PX, config.enemies.turret.boltRadius * PX * 2);
      g.fillStyle(0xfff0c2, 1).fillCircle(b.x * PX, b.y * PX, config.enemies.turret.boltRadius * PX);
    }
  }

  /**
   * Traps. The preview and the full map show them all. In the race an armed
   * trap shows only when you are close to it; a sprung one shows wherever you
   * can see it (it is safe until it re-arms).
   */
  private drawTraps(g: Phaser.GameObjects.Graphics, top: Phaser.GameObjects.Graphics): void {
    const { state } = this;
    const me = this.me();
    const all = !this.racingView() || this.peeking();
    const reveal = state.config.traps.revealDistance;
    const revealing = this.revealing();
    (this.data_.map.traps ?? []).forEach((trap, i) => {
      const armed = trapArmed(state, i);
      const cx = trap.x + 0.5;
      const cy = trap.y + 0.5;
      // The Reveal skill shows traps close by through the fog.
      if (!all && revealing && Math.hypot(cx - me.x, cy - me.y) <= state.config.skills.reveal.range) {
        this.drawTrap(top, trap, armed, 1);
        return;
      }
      if (!all) {
        if (!this.isVisibleTile(cx, cy)) return;
        if (armed && Math.hypot(cx - me.x, cy - me.y) > reveal) return;
      }
      this.drawTrap(g, trap, armed, all ? 1.8 : 1);
    });
  }

  /** The Reveal skill is showing hazards close by. */
  private revealing(): boolean {
    return this.racingView() && this.me().revealTime > 0;
  }

  /** Treasures: gold coins, until this runner has collected them. Seen like the ground (they never move). */
  private drawTreasures(g: Phaser.GameObjects.Graphics): void {
    const me = this.me();
    const whole = !this.racingView() || this.peeking();
    const k = whole ? 1.8 : 1;
    const spin = Math.abs(Math.sin(this.time.now / 300));
    (this.data_.map.treasures ?? []).forEach((t, i) => {
      if (me.treasures[i]) return;
      const x = t.x * PX;
      const y = t.y * PX;
      const r = PX * 0.28 * k;
      g.fillStyle(0xffd23f, 0.25).fillCircle(x, y, r * 1.6);
      g.fillStyle(0xffc21a, 1).fillEllipse(x, y, r * 2 * (0.35 + 0.65 * spin), r * 2);
      g.lineStyle(2, 0x8a5a00, 1).strokeEllipse(x, y, r * 2 * (0.35 + 0.65 * spin), r * 2);
    });
  }

  /** One trap: a dark plate with the kind's sign. `k` scales it up on the whole-map views, so it can be picked out. */
  private drawTrap(g: Phaser.GameObjects.Graphics, trap: Trap, armed: boolean, k: number): void {
    const { color } = TRAP_STYLE[trap.kind];
    const alpha = armed ? 1 : 0.35;
    const cx = (trap.x + 0.5) * PX;
    const cy = (trap.y + 0.5) * PX;
    const half = (PX / 2 - 3) * k;
    const at = (dx: number, dy: number) => ({ x: cx + dx * k, y: cy + dy * k });
    g.fillStyle(0x10131a, 0.8 * alpha).fillRoundedRect(cx - half, cy - half, half * 2, half * 2, 5 * k);
    g.lineStyle(2 * Math.min(k, 1.6), color, alpha).strokeRoundedRect(cx - half, cy - half, half * 2, half * 2, 5 * k);
    g.fillStyle(color, alpha);
    g.lineStyle(2.5 * Math.min(k, 1.6), color, alpha);
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const a = at(x0, y0);
      const b = at(x1, y1);
      g.lineBetween(a.x, a.y, b.x, b.y);
    };
    const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
      const a = at(x0, y0);
      const b = at(x1, y1);
      const c = at(x2, y2);
      g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    };
    switch (trap.kind) {
      case 'spikes':
        for (const ox of [-7, 0, 7]) tri(ox - 3.5, 6, ox, -6, ox + 3.5, 6);
        break;
      case 'snare':
        g.strokeCircle(cx, cy, 7 * k);
        for (let n = 0; n < 6; n++) {
          const a = (n * Math.PI) / 3;
          line(Math.cos(a) * 7, Math.sin(a) * 7, Math.cos(a) * 3.5, Math.sin(a) * 3.5);
        }
        break;
      case 'glue':
        g.fillCircle(cx - 3 * k, cy + 1 * k, 5 * k);
        g.fillCircle(cx + 3 * k, cy - 1 * k, 4 * k);
        g.fillCircle(cx + 4 * k, cy + 5 * k, 2.5 * k);
        break;
      case 'flash':
        line(-8, 0, 8, 0);
        line(0, -8, 0, 8);
        line(-5, -5, 5, 5);
        line(-5, 5, 5, -5);
        break;
      case 'reverse':
        line(-7, -3, 7, -3);
        tri(7, -6, 10, -3, 7, 0);
        line(-7, 4, 7, 4);
        tri(-7, 1, -10, 4, -7, 7);
        break;
      case 'confuse':
        g.beginPath();
        g.arc(cx, cy, 7 * k, 0, Math.PI * 1.5, false);
        g.strokePath();
        g.beginPath();
        g.arc(cx, cy, 3.5 * k, Math.PI, Math.PI * 2.6, false);
        g.strokePath();
        break;
    }
  }

  /**
   * Moving obstacles. During a race only what is inside your view is drawn:
   * moving things are never remembered.
   */
  private drawObstacles(g: Phaser.GameObjects.Graphics): void {
    const { state } = this;
    const { config } = state;
    const t = obstacleTime(state);
    for (const o of this.data_.map.obstacles ?? []) {
      if (o.kind === 'boulder') {
        const b = boulderPosition(config, o, t);
        if (!this.isVisibleTile(b.x, b.y)) continue;
        const r = config.obstacles.boulder.radius * PX;
        g.fillStyle(COLOR.boulder, 1).fillCircle(b.x * PX, b.y * PX, r);
        g.lineStyle(3, COLOR.boulderEdge, 1).strokeCircle(b.x * PX, b.y * PX, r);
        // A groove that turns as it rolls.
        const along = Math.hypot(b.x - o.ax, b.y - o.ay) / config.obstacles.boulder.radius;
        const vertical = o.ax === o.bx;
        const a = vertical ? along : -along;
        g.lineStyle(3, COLOR.boulderEdge, 0.8).beginPath();
        g.arc(b.x * PX, b.y * PX, r * 0.6, a, a + Math.PI * 0.8, false).strokePath();
      } else if (o.kind === 'barrier') {
        const [a, b] = barrierEnds(config, o, t);
        const steps = 10;
        g.lineStyle(config.obstacles.barrier.thickness * PX, COLOR.barrier, 1);
        for (let i = 0; i < steps; i++) {
          const x0 = a.x + ((b.x - a.x) * i) / steps;
          const y0 = a.y + ((b.y - a.y) * i) / steps;
          const x1 = a.x + ((b.x - a.x) * (i + 1)) / steps;
          const y1 = a.y + ((b.y - a.y) * (i + 1)) / steps;
          if (this.isVisibleTile((x0 + x1) / 2, (y0 + y1) / 2)) g.lineBetween(x0 * PX, y0 * PX, x1 * PX, y1 * PX);
        }
        if (this.isVisibleTile(o.x, o.y)) g.fillStyle(0x10131a, 1).fillCircle(o.x * PX, o.y * PX, 5);
      } else {
        if (!this.isVisibleTile(o.x + 0.5, o.y + 0.5) && !this.isVisibleTile(o.x + o.w - 0.5, o.y + o.h - 0.5)) continue;
        const x = o.x * PX;
        const y = o.y * PX;
        const w = o.w * PX;
        const h = o.h * PX;
        if (gateClosed(config, o, t)) {
          // Closed: bars across the opening.
          g.fillStyle(0x10131a, 0.55).fillRect(x, y, w, h);
          g.lineStyle(4, COLOR.gate, 1);
          const across = o.w < o.h;
          for (let i = 1; i <= 3; i++) {
            if (across) g.lineBetween(x, y + (h * i) / 4, x + w, y + (h * i) / 4);
            else g.lineBetween(x + (w * i) / 4, y, x + (w * i) / 4, y + h);
          }
          g.lineStyle(2, COLOR.gate, 1).strokeRect(x + 1, y + 1, w - 2, h - 2);
        } else {
          // Open: only the frame shows.
          g.lineStyle(2, COLOR.gate, 0.45).strokeRect(x + 1, y + 1, w - 2, h - 2);
        }
      }
    }
  }

  /**
   * At the start (preview, count and the first seconds of the race) the local
   * runner gets a "You" label and rings rippling outwards, so it stands out
   * among the others in the start plaza. Sizes are in screen pixels, whatever
   * the zoom.
   */
  private drawYou(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    const { state } = this;
    const intro = state.phase === 'preview' || state.phase === 'countdown' || (state.phase === 'racing' && state.raceTime < 3 && !this.me().finished);
    if (!this.youLabel) {
      this.youLabel = this.add
        .text(0, 0, 'You', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#0b0d12', strokeThickness: 5 })
        .setOrigin(0.5, 1)
        .setDepth(26);
    }
    this.youLabel.setVisible(intro);
    if (!intro) return;
    const zoom = this.cameras.main.zoom;
    const px = 1 / zoom;
    for (let k = 0; k < 2; k++) {
      const u = ((this.time.now / 1100 + k / 2) % 1 + 1) % 1;
      g.lineStyle(3 * px, 0xffffff, 0.9 * (1 - u)).strokeCircle(x, y, r + (10 + 46 * u) * px);
    }
    this.youLabel.setPosition(x, y - r - 14 * px).setScale(px);
  }

  /** On and off about eight times a second, for runners in their safe time. */
  private flickerOff(): boolean {
    return Math.floor(this.time.now / 60) % 2 === 0;
  }

  /** A coloured ring per effect round a runner; for your own, the ring shrinks as the effect runs out. */
  private drawEffects(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, effects: readonly ActiveEffect[]): void {
    effects.forEach((effect, i) => {
      const { color } = EFFECT_STYLE[effect.kind as EffectKind];
      const radius = r + 12 + i * 5;
      const share = Math.max(0, Math.min(1, effect.time / effect.total));
      g.lineStyle(3, color, 0.95).beginPath();
      g.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share, false).strokePath();
      if (effect.kind === 'stun') {
        // Little stars circling the head.
        for (let k = 0; k < 3; k++) {
          const a = this.time.now / 150 + (k * Math.PI * 2) / 3;
          g.fillStyle(color, 1).fillCircle(x + Math.cos(a) * radius, y - r - 6 + Math.sin(a) * 4, 2.5);
        }
      }
    });
  }

  private drawArrow(g: Phaser.GameObjects.Graphics, x: number, y: number, dx: number, dy: number, color: number): void {
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const angle = Math.atan2(dy, dx);
    const ring = PX * 1.5;
    const at = (a: number, d: number) => ({ x: x + Math.cos(angle + a) * d, y: y + Math.sin(angle + a) * d });
    g.fillStyle(color, 0.95).fillPoints([at(0, ring + 16), at(0.16, ring), at(-0.16, ring)], true);
  }

  private emitHud(): void {
    const { state } = this;
    const me = this.me();
    this.data_.bridge.emit('hud', {
      phase: state.phase,
      phaseTime: state.phaseTime,
      resumeTime: state.resumeTime,
      raceTime: me.finishTime ?? state.raceTime,
      timeLeft: state.deadline - state.raceTime,
      stamina: me.stamina / state.config.sprint.staminaMax,
      shoveReady: state.phase === 'racing' && !me.finished && me.shoveCooldown <= 0 && me.stamina >= state.config.combat.staminaCost,
      exhausted: me.exhausted,
      sprinting: me.sprinting,
      markersPlaced: me.markers.length,
      markersMax: state.config.markers.max,
      checkpointsDone: me.checkpoints.filter(Boolean).length,
      checkpointsTotal: me.checkpoints.length,
      paused: this.driver.paused,
      terrain: TERRAIN[me.terrain]!.name,
      spectating: state.phase === 'racing' && me.finished,
      mapOpen: this.peeking(),
      health: me.health,
      healthMax: maxHearts(state.config, me),
      points: me.points,
      threat: me.threat,
      offer: me.offer?.map((id) => ({ ...SKILLS[id], affordable: SKILLS[id].cost <= me.points })) ?? null,
      effects: me.effects.map((e) => ({ kind: e.kind, left: e.time, total: e.total })),
      readiness: this.driver.readiness(),
    });
  }
}
