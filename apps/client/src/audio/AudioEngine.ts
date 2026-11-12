import { Tile } from '@cursar/game-core';

interface ToneOptions {
  freq: number;
  /** Glide to this frequency over the duration. */
  to?: number;
  dur: number;
  vol: number;
  type?: OscillatorType;
  pan?: number;
  delay?: number;
  attack?: number;
}

interface NoiseOptions {
  dur: number;
  freq: number;
  vol: number;
  filter?: BiquadFilterType;
  q?: number;
  pan?: number;
  delay?: number;
  attack?: number;
}

/**
 * All sound is synthesised with the Web Audio API, so there are no audio files
 * to load or license. Every method is a gameplay cue: sound carries information
 * the restricted view cannot (see docs/DECISIONS.md, "Audio").
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.7;
  private stepSide = 1;

  /** Browsers only allow audio after a click or key press: call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      const limiter = this.ctx.createDynamicsCompressor();
      this.master.connect(limiter).connect(this.ctx.destination);
      const length = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private output(pan: number | undefined): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (!pan) return this.master;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master);
    return panner;
  }

  private envelope(o: { vol: number; dur: number; delay?: number; attack?: number }, out: AudioNode): { gain: GainNode; start: number; end: number } {
    const ctx = this.ctx!;
    const start = ctx.currentTime + (o.delay ?? 0);
    const end = start + o.dur;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), start + (o.attack ?? 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(out);
    return { gain, start, end };
  }

  private tone(o: ToneOptions): void {
    const out = this.output(o.pan);
    if (!out || !this.ctx) return;
    const { gain, start, end } = this.envelope(o, out);
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, end);
    osc.connect(gain);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private noise(o: NoiseOptions): void {
    const out = this.output(o.pan);
    if (!out || !this.ctx || !this.noiseBuffer) return;
    const { gain, start, end } = this.envelope(o, out);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = o.filter ?? 'bandpass';
    filter.frequency.value = o.freq;
    filter.Q.value = o.q ?? 1;
    src.connect(filter).connect(gain);
    src.start(start, Math.random() * 0.5);
    src.stop(end + 0.02);
  }

  // --- Movement -----------------------------------------------------------

  /** One footfall. The surface is audible, so you can hear mud or ice before you look. */
  footstep(terrain: number, sprinting: boolean): void {
    this.stepSide = -this.stepSide;
    const pan = this.stepSide * 0.12;
    const loud = sprinting ? 1.4 : 1;
    if (terrain === Tile.Mud) {
      this.noise({ dur: 0.14, freq: 420, filter: 'lowpass', vol: 0.3 * loud, pan, attack: 0.02 });
      this.tone({ freq: 150, to: 60, dur: 0.12, vol: 0.12 * loud, pan });
    } else if (terrain === Tile.Ice) {
      this.tone({ freq: 2300 + Math.random() * 500, to: 1700, dur: 0.06, vol: 0.05 * loud, pan });
      this.noise({ dur: 0.04, freq: 6000, filter: 'highpass', vol: 0.06 * loud, pan });
    } else {
      this.noise({ dur: 0.05, freq: 1500 + Math.random() * 600, q: 0.8, vol: 0.16 * loud, pan });
      this.tone({ freq: 95, to: 60, dur: 0.05, vol: 0.1 * loud, pan });
    }
  }

  bump(speed: number): void {
    const vol = Math.min(0.45, 0.08 + speed / 18);
    this.tone({ freq: 120, to: 45, dur: 0.14, vol });
    this.noise({ dur: 0.08, freq: 320, filter: 'lowpass', vol: vol * 0.8 });
  }

  /** Out of breath: sprint is locked until stamina recovers. */
  exhausted(): void {
    this.noise({ dur: 0.45, freq: 900, q: 0.6, vol: 0.22, attack: 0.12 });
    this.noise({ dur: 0.5, freq: 700, q: 0.6, vol: 0.18, attack: 0.15, delay: 0.55 });
  }

  /** Heartbeat while stamina is low, so you can judge it without reading the bar. */
  heartbeat(intensity: number): void {
    const vol = 0.12 + 0.2 * intensity;
    this.tone({ freq: 62, to: 42, dur: 0.11, vol });
    this.tone({ freq: 55, to: 38, dur: 0.13, vol: vol * 0.7, delay: 0.14 });
  }

  // --- Navigation ---------------------------------------------------------

  /**
   * Your next objective pings when you are near: panned left or right, louder
   * when closer. Checkpoints ping low, the open finish pings high.
   */
  beacon(pan: number, closeness: number, finish: boolean): void {
    const vol = 0.03 + 0.2 * closeness * closeness;
    const freq = finish ? 1320 : 784;
    this.tone({ freq, dur: 0.6, vol, pan, type: 'sine' });
    this.tone({ freq: freq * 1.5, dur: 0.35, vol: vol * 0.35, pan, type: 'sine', delay: 0.02 });
  }

  /** Checkpoint touched. The last one adds a rising run: the finish is now open. */
  checkpoint(remaining: number): void {
    this.tone({ freq: 659, dur: 0.12, vol: 0.24, type: 'triangle' });
    this.tone({ freq: 988, dur: 0.28, vol: 0.24, type: 'triangle', delay: 0.1 });
    if (remaining === 0) {
      [1047, 1319, 1568, 2093].forEach((freq, i) => this.tone({ freq, dur: 0.22, vol: 0.16, type: 'triangle', delay: 0.35 + i * 0.07 }));
    }
  }

  /** You are on the finish but it does not count yet. */
  finishLocked(): void {
    this.tone({ freq: 196, dur: 0.16, vol: 0.2, type: 'square' });
    this.tone({ freq: 147, dur: 0.24, vol: 0.2, type: 'square', delay: 0.15 });
  }

  markerPlaced(index: number): void {
    this.tone({ freq: 520 + index * 130, dur: 0.12, vol: 0.2, type: 'triangle' });
  }

  denied(): void {
    this.tone({ freq: 180, dur: 0.12, vol: 0.15, type: 'square' });
  }

  markerReached(): void {
    this.tone({ freq: 880, dur: 0.14, vol: 0.2, type: 'triangle' });
    this.tone({ freq: 1320, dur: 0.25, vol: 0.2, type: 'triangle', delay: 0.09 });
  }

  /** A rival's footsteps: you can hear the ghost before (or without) seeing it. */
  rivalStep(pan: number, closeness: number): void {
    this.noise({ dur: 0.05, freq: 900, q: 1.5, vol: 0.02 + 0.1 * closeness, pan });
  }

  // --- Race ---------------------------------------------------------------

  countdown(): void {
    this.tone({ freq: 440, dur: 0.18, vol: 0.28, type: 'triangle' });
  }

  go(): void {
    this.tone({ freq: 880, dur: 0.5, vol: 0.3, type: 'triangle' });
    this.tone({ freq: 1320, dur: 0.5, vol: 0.12, type: 'sine' });
  }

  /** Clock tick when time is running out. */
  timeWarning(urgent: boolean): void {
    this.tone({ freq: urgent ? 1400 : 1000, dur: 0.04, vol: urgent ? 0.2 : 0.12, type: 'square' });
  }

  finish(newBest: boolean): void {
    [523, 659, 784, 1047].forEach((freq, i) => this.tone({ freq, dur: 0.3, vol: 0.22, type: 'triangle', delay: i * 0.1 }));
    if (newBest) {
      [1568, 2093, 2637].forEach((freq, i) => this.tone({ freq, dur: 0.4, vol: 0.12, delay: 0.5 + i * 0.08 }));
    }
  }

  /** Someone else crossed the line: the clock is now running for everyone still out. */
  rivalFinished(): void {
    this.tone({ freq: 587, dur: 0.16, vol: 0.2, type: 'triangle' });
    this.tone({ freq: 440, dur: 0.3, vol: 0.2, type: 'triangle', delay: 0.14 });
  }

  timeUp(): void {
    this.tone({ freq: 300, to: 110, dur: 0.7, vol: 0.25, type: 'sawtooth' });
  }

  // --- Obstacles ------------------------------------------------------------

  /** A boulder nearby, panned and louder when closer; higher while it is coming towards you. */
  rumble(pan: number, closeness: number, approaching: boolean): void {
    this.noise({ dur: 0.3, freq: approaching ? 140 : 95, filter: 'lowpass', q: 0.7, vol: 0.05 + 0.3 * closeness * closeness, pan, attack: 0.06 });
  }

  /** A barrier passing a quarter turn: a rhythm you can time. */
  barrierClick(pan: number, closeness: number): void {
    this.tone({ freq: 1900, dur: 0.03, vol: 0.04 + 0.16 * closeness, type: 'square', pan });
    this.noise({ dur: 0.04, freq: 3000, q: 4, vol: 0.03 + 0.1 * closeness, pan });
  }

  /** A gate opening (rising) or closing (a heavier falling clunk). */
  gate(closing: boolean, pan: number, closeness: number): void {
    const vol = 0.05 + 0.25 * closeness;
    this.noise({ dur: 0.12, freq: closing ? 400 : 700, filter: 'lowpass', vol, pan });
    this.tone({ freq: closing ? 240 : 180, to: closing ? 120 : 300, dur: 0.18, vol: vol * 0.7, type: 'square', pan });
  }

  /** An armed trap very close by: a faint tick, panned. */
  trapTell(pan: number, closeness: number): void {
    this.tone({ freq: 2600, dur: 0.025, vol: 0.015 + 0.06 * closeness, type: 'sine', pan });
  }

  /** A trap springs under you: a sharp mechanical snap (its effect has its own sound). */
  trapSpring(): void {
    this.noise({ dur: 0.06, freq: 2500, q: 3, vol: 0.3 });
    this.tone({ freq: 900, to: 300, dur: 0.08, vol: 0.18, type: 'square' });
  }

  // --- Treasures and skills -------------------------------------------------

  treasure(): void {
    [1319, 1760, 2349].forEach((freq, i) => this.tone({ freq, dur: 0.18, vol: 0.14, type: 'triangle', delay: i * 0.05 }));
  }

  /** Skill cards on offer. */
  offer(): void {
    this.tone({ freq: 523, dur: 0.12, vol: 0.12, type: 'triangle' });
    this.tone({ freq: 784, dur: 0.18, vol: 0.12, type: 'triangle', delay: 0.08 });
  }

  /** A card taken. */
  skill(): void {
    [392, 523, 659, 784].forEach((freq, i) => this.tone({ freq, dur: 0.16, vol: 0.14, type: 'square', delay: i * 0.04 }));
  }

  /** Reveal showing the hazards round a checkpoint. */
  reveal(): void {
    this.tone({ freq: 880, to: 1760, dur: 0.5, vol: 0.12, type: 'sine' });
  }

  /** Trap sense: a trap underfoot clicked. Get off it! */
  trapClick(): void {
    this.tone({ freq: 2400, dur: 0.03, vol: 0.25, type: 'square' });
    this.tone({ freq: 1800, dur: 0.03, vol: 0.25, type: 'square', delay: 0.07 });
  }

  // --- Enemies --------------------------------------------------------------

  /** A patroller's heavy, regular step. */
  patrollerStep(pan: number, closeness: number): void {
    this.noise({ dur: 0.07, freq: 260, filter: 'lowpass', vol: 0.03 + 0.22 * closeness, pan });
    this.tone({ freq: 90, dur: 0.08, vol: 0.02 + 0.12 * closeness, type: 'sine', pan });
  }

  /** A chaser or turret. A growl rises in pitch when it is after you. */
  foe(sound: string, pan: number, closeness: number, aimed: boolean): void {
    const vol = 0.03 + 0.27 * closeness;
    switch (sound) {
      case 'snore':
        this.noise({ dur: 0.9, freq: 300, filter: 'lowpass', vol: vol * 0.5, pan, attack: 0.4 });
        break;
      case 'wake':
        this.tone({ freq: 120, to: 260, dur: 0.4, vol, type: 'sawtooth', pan });
        this.noise({ dur: 0.35, freq: 500, q: 2, vol: vol * 0.6, pan });
        break;
      case 'growl':
        this.tone({ freq: aimed ? 150 : 95, to: aimed ? 190 : 85, dur: 0.35, vol: vol * (aimed ? 1.2 : 0.8), type: 'sawtooth', pan, attack: 0.03 });
        this.noise({ dur: 0.3, freq: aimed ? 420 : 260, q: 3, vol: vol * 0.5, pan });
        break;
      case 'whir':
        this.tone({ freq: 300, to: 1400, dur: 0.75, vol: vol * 0.7, type: 'triangle', pan, attack: 0.1 });
        break;
      case 'fire':
        this.tone({ freq: 1600, to: 400, dur: 0.15, vol, type: 'square', pan });
        this.noise({ dur: 0.08, freq: 3000, q: 2, vol: vol * 0.6, pan });
        break;
    }
  }

  // --- Effects --------------------------------------------------------------

  /** An effect took hold. Each kind has its own sound, so you know what hit you without reading. */
  effect(kind: string): void {
    switch (kind) {
      case 'slow':
        this.tone({ freq: 330, to: 165, dur: 0.45, vol: 0.2, type: 'sawtooth' });
        this.noise({ dur: 0.4, freq: 300, q: 2, vol: 0.12 });
        break;
      case 'haste':
        this.tone({ freq: 440, to: 1320, dur: 0.3, vol: 0.18, type: 'triangle' });
        break;
      case 'stun':
        this.noise({ dur: 0.12, freq: 160, filter: 'lowpass', vol: 0.4 });
        [1760, 2093, 1760].forEach((freq, i) => this.tone({ freq, dur: 0.12, vol: 0.08, delay: 0.06 + i * 0.09 }));
        break;
      case 'reversed':
        this.tone({ freq: 880, to: 330, dur: 0.18, vol: 0.18, type: 'square' });
        this.tone({ freq: 330, to: 880, dur: 0.18, vol: 0.14, type: 'square', delay: 0.17 });
        break;
      case 'confused':
        [600, 760, 520, 700].forEach((freq, i) => this.tone({ freq, dur: 0.1, vol: 0.12, type: 'triangle', delay: i * 0.07 }));
        break;
      case 'blind':
        this.noise({ dur: 0.6, freq: 1200, filter: 'lowpass', vol: 0.2, attack: 0.05 });
        this.tone({ freq: 220, to: 110, dur: 0.6, vol: 0.12 });
        break;
    }
  }

  /** Lost a heart: lower and harsher as health runs low. */
  hurt(health: number): void {
    this.noise({ dur: 0.18, freq: 220, filter: 'lowpass', vol: 0.4 });
    this.tone({ freq: health <= 1 ? 180 : 260, to: health <= 1 ? 90 : 160, dur: 0.3, vol: 0.25, type: 'sawtooth' });
  }

  /** Out of hearts and back at the last checkpoint. */
  respawn(): void {
    this.tone({ freq: 1200, to: 300, dur: 0.35, vol: 0.18, type: 'sine' });
    this.tone({ freq: 523, dur: 0.2, vol: 0.18, type: 'triangle', delay: 0.38 });
    this.tone({ freq: 784, dur: 0.3, vol: 0.18, type: 'triangle', delay: 0.5 });
  }

  /** A loss-of-control effect has ended: your controls are your own again. */
  controlBack(): void {
    this.tone({ freq: 660, dur: 0.1, vol: 0.14, type: 'triangle' });
    this.tone({ freq: 990, dur: 0.14, vol: 0.12, type: 'triangle', delay: 0.07 });
  }

  /** A loss-of-control effect bounced off the guard. */
  resisted(): void {
    this.tone({ freq: 1200, to: 1500, dur: 0.12, vol: 0.1, type: 'sine' });
  }

  click(): void {
    this.tone({ freq: 700, dur: 0.05, vol: 0.12, type: 'triangle' });
  }
}

export const audio = new AudioEngine();
