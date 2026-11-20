/** What the race music should be saying right now. Worked out by the race scene each frame. */
export interface MusicMood {
  /** Silent, the quiet base under the preview and countdown, or the race itself. */
  mode: 'off' | 'preview' | 'race';
  /** Share of your checkpoints touched, 0 to 1: the bass grows with it. */
  progress: number;
  /** How near the nearest rival you can hear is, 0 to 1 (the ghost counts in solo). */
  close: number;
  /** The last stretch: the finish is open for you, or 30 s or less are left. */
  final: boolean;
}

type Layer = 'pad' | 'bass' | 'tension' | 'drive';

const BPM = 96;
const FINAL_BPM = 112;
const LOOKAHEAD = 0.25;
/** Four bars in A minor: Am, F, C, G. Roots as MIDI notes, with a minor or major third. */
const CHORDS: { root: number; third: number }[] = [
  { root: 45, third: 3 },
  { root: 41, third: 4 },
  { root: 48, third: 4 },
  { root: 43, third: 4 },
];
const ARPEGGIO = [0, 7, 12, 1, 7, 12, 19, 12];

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Adaptive race music, synthesised like every other sound. A quiet pad always
 * plays during the race; the other layers fade in and out to say something:
 * the bass grows with your checkpoints, a ticking tension layer means a rival
 * is near enough to hear, and drums with an arpeggio mark the last stretch.
 * It stays low and below the pitch of the cues (beacon, chimes) so it never
 * hides them (docs/DECISIONS.md, "Audio").
 */
export class Music {
  private readonly layers: Record<Layer, GainNode>;
  private mood: MusicMood = { mode: 'off', progress: 0, close: 0, final: false };
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopAt = 0;
  private nextTime = 0;
  private step = 0;
  private bpm = BPM;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2400;
    soften.connect(out);
    const layer = (to: AudioNode): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(to);
      return gain;
    };
    // The ticking of the tension layer is high on purpose, so it skips the softening filter.
    this.layers = { pad: layer(soften), bass: layer(soften), tension: layer(out), drive: layer(soften) };
  }

  set(mood: MusicMood): void {
    const unit = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
    mood = { ...mood, progress: unit(mood.progress), close: unit(mood.close) };
    const before = this.mood;
    this.mood = mood;
    const changed = mood.mode !== before.mode || Math.abs(mood.progress - before.progress) > 0.01 || Math.abs(mood.close - before.close) > 0.02 || mood.final !== before.final;
    if (!changed) return;
    const race = mood.mode === 'race';
    this.fade('pad', mood.mode === 'off' ? 0 : race ? 1 : 0.55, mood.mode === 'off' ? 0.6 : 1.2);
    this.fade('bass', race && mood.progress > 0 ? 0.35 + 0.65 * mood.progress : 0, 1.5);
    this.fade('tension', race ? Math.min(1, mood.close * 1.4) : 0, 0.6);
    this.fade('drive', race && mood.final ? 1 : 0, 1);
    if (mood.mode === 'off') {
      this.stopAt = this.ctx.currentTime + 3;
    } else {
      this.stopAt = 0;
      this.start();
    }
  }

  private fade(layer: Layer, target: number, seconds: number): void {
    this.layers[layer].gain.setTargetAtTime(target, this.ctx.currentTime, seconds / 3);
  }

  private start(): void {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  private schedule(): void {
    const now = this.ctx.currentTime;
    if (this.stopAt && now >= this.stopAt) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    // A hidden tab slows timers down: rather than rush to catch up, pick up from now.
    if (this.nextTime < now) this.nextTime = now + 0.05;
    const target = this.mood.final ? FINAL_BPM : BPM;
    while (this.nextTime < now + LOOKAHEAD) {
      this.bpm += (target - this.bpm) * 0.04;
      const stepLength = 60 / this.bpm / 4;
      this.play(this.step, this.nextTime, stepLength);
      this.nextTime += stepLength;
      this.step = (this.step + 1) % 64;
    }
  }

  private audible(layer: Layer): boolean {
    return this.layers[layer].gain.value > 0.003 || this.target(layer) > 0;
  }

  private target(layer: Layer): number {
    const { mode, progress, close, final } = this.mood;
    if (mode === 'off') return 0;
    if (layer === 'pad') return 1;
    if (mode !== 'race') return 0;
    if (layer === 'bass') return progress;
    if (layer === 'tension') return close;
    return final ? 1 : 0;
  }

  /** Plays one sixteenth note of every layer that can be heard. */
  private play(step: number, time: number, stepLength: number): void {
    const chord = CHORDS[Math.floor(step / 16)]!;
    const beat = step % 16;
    const tones = [chord.root, chord.root + chord.third, chord.root + 7];

    if (beat === 0 && this.audible('pad')) {
      for (const tone of tones) this.note('pad', freq(tone + 12), time, stepLength * 16 + 0.3, 0.05, 'triangle', 0.6);
      this.note('pad', freq(chord.root), time, stepLength * 16 + 0.3, 0.05, 'sine', 0.4);
    }

    if (beat % 2 === 0 && this.audible('bass')) {
      const accent = beat % 8 === 0 ? 1 : 0.65;
      this.note('bass', freq(beat === 14 ? chord.root + 7 : chord.root), time, stepLength * 1.6, 0.14 * accent, 'triangle', 0.01);
    }

    if (this.audible('tension')) {
      this.hat(time, beat % 4 === 2 ? 0.05 : 0.022);
      if (beat === 6 || beat === 14) this.note('tension', freq(chord.root + 13), time, stepLength * 1.5, 0.03, 'square', 0.01);
    }

    if (this.audible('drive')) {
      if (beat % 4 === 0) this.kick(time);
      const tone = chord.root + 12 + (ARPEGGIO[beat % 8] === 1 ? chord.third : ARPEGGIO[beat % 8]!);
      this.note('drive', freq(tone), time, stepLength * 0.9, 0.035, 'triangle', 0.005);
    }
  }

  private note(layer: Layer, hz: number, time: number, dur: number, vol: number, type: OscillatorType, attack: number): void {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    gain.connect(this.layers[layer]);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    osc.connect(gain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private hat(time: number, vol: number): void {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(filter).connect(gain).connect(this.layers.tension);
    src.start(time, Math.random() * 0.5);
    src.stop(time + 0.05);
  }

  private kick(time: number): void {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    gain.connect(this.layers.drive);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.14);
    osc.connect(gain);
    osc.start(time);
    osc.stop(time + 0.2);
  }
}
