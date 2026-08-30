/**
 * The game's whole soundscape, synthesized — no audio files, no licensing,
 * no loading. One WebAudio graph: a master limiter, three buses (sfx /
 * ambient / music), and a bag of tiny synth recipes. The context unlocks on
 * the first user gesture (the title tap) because browsers demand it.
 *
 * Aesthetic: kawaii-voxel chiptune — square-wave pops, filtered-noise
 * whooshes, sub thumps. Nothing longer than it needs to be.
 */

type Bus = 'sfx' | 'ambient' | 'music';

export class Sound {
  private ctx: AudioContext | null = null;
  private buses!: Record<Bus, GainNode>;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private stepAcc = 0;

  // ambient + music state
  private ambientNodes: AudioNode[] = [];
  private ambientMode: 'off' | 'town' | 'arena' = 'off';
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private musicIntensity = 0; // 0 calm shooter · 1 low-HP frenzy

  constructor() {
    try { this.muted = localStorage.getItem('sfq-muted') === '1'; } catch { /* default on */ }
  }

  /** Call from any first user gesture; safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 12;
    limiter.connect(ctx.destination);
    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(limiter);
      return g;
    };
    this.buses = { sfx: mk(0.5), ambient: mk(0.16), music: mk(0.22) };
    if (this.muted) for (const b of Object.values(this.buses)) b.gain.value = 0;

    // one 2s noise buffer serves every hiss, whoosh and boom
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    if (this.ambientMode !== 'off') this.startAmbient(this.ambientMode);
  }

  get isMuted(): boolean { return this.muted; }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem('sfq-muted', this.muted ? '1' : '0'); } catch { /* fine */ }
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.buses.sfx.gain.setTargetAtTime(this.muted ? 0 : 0.5, t, 0.05);
      this.buses.ambient.gain.setTargetAtTime(this.muted ? 0 : 0.16, t, 0.05);
      this.buses.music.gain.setTargetAtTime(this.muted ? 0 : 0.22, t, 0.05);
    }
    return this.muted;
  }

  // ── tiny synth helpers ────────────────────────────────────────────────────

  /** One oscillator with an exponential-decay envelope. */
  private tone(bus: Bus, type: OscillatorType, f0: number, f1: number,
               dur: number, vol: number, when = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst — the workhorse for impacts and whooshes. */
  private noise(bus: Bus, dur: number, vol: number,
                filter: { type: BiquadFilterType; f0: number; f1?: number; q?: number },
                when = 0, rate = 1): void {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.f0, t);
    if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
    f.Q.value = filter.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // ── the fight ─────────────────────────────────────────────────────────────

  shot(): void {
    this.noise('sfx', 0.06, 0.5, { type: 'bandpass', f0: 2400, q: 1.4 });
    this.tone('sfx', 'square', 620 + Math.random() * 120, 180, 0.05, 0.18);
  }

  hit(): void {
    this.tone('sfx', 'square', 240, 140, 0.06, 0.2);
  }

  rocket(): void {
    this.noise('sfx', 0.9, 0.4, { type: 'bandpass', f0: 700, f1: 2600, q: 2.5 });
    this.tone('sfx', 'sawtooth', 90, 320, 0.9, 0.1);
  }

  explosion(big = false): void {
    const k = big ? 1.5 : 1;
    this.noise('sfx', 0.7 * k, 0.8, { type: 'lowpass', f0: 3200, f1: 120 }, 0, 0.5);
    this.tone('sfx', 'sine', 110, 34, 0.5 * k, 0.9);
    this.tone('sfx', 'triangle', 60, 28, 0.7 * k, 0.5, 0.03);
  }

  laserLock(): void {
    this.tone('sfx', 'sine', 1200, 1600, 0.07, 0.1);
    this.tone('sfx', 'sine', 1200, 1600, 0.07, 0.1, 0.1);
  }

  hurt(): void {
    this.tone('sfx', 'sawtooth', 320, 90, 0.3, 0.32);
    this.noise('sfx', 0.2, 0.3, { type: 'lowpass', f0: 900, f1: 200 });
  }

  countdownTick(last: boolean): void {
    if (last) {
      // the horn: the audit commences
      this.tone('sfx', 'sawtooth', 155, 150, 0.7, 0.3);
      this.tone('sfx', 'sawtooth', 233, 226, 0.7, 0.25);
      this.noise('sfx', 0.5, 0.25, { type: 'lowpass', f0: 1200, f1: 300 });
    } else this.tone('sfx', 'square', 880, 860, 0.08, 0.14);
  }

  verdict(correct: boolean): void {
    if (correct) {
      for (const [i, f] of [523, 659, 784, 1047].entries())
        this.tone('sfx', 'square', f, f, 0.14, 0.16, i * 0.08);
    } else {
      this.tone('sfx', 'sawtooth', 220, 210, 0.4, 0.25);
      this.tone('sfx', 'sawtooth', 233, 222, 0.4, 0.25);
    }
  }

  victory(): void {
    for (const [i, f] of [523, 659, 784, 1047, 784, 1047, 1319].entries())
      this.tone('sfx', 'square', f, f, 0.18, 0.18, i * 0.11);
    this.stopMusic();
  }

  defeat(): void {
    for (const [i, f] of [440, 415, 392, 330].entries())
      this.tone('sfx', 'sawtooth', f, f * 0.97, 0.3, 0.2, i * 0.18);
    this.stopMusic();
  }

  // ── the town ──────────────────────────────────────────────────────────────

  uiPop(): void { this.tone('sfx', 'triangle', 660, 880, 0.07, 0.12); }
  uiOpen(): void { this.tone('sfx', 'triangle', 440, 660, 0.09, 0.12); }
  knock(): void {
    this.noise('sfx', 0.09, 0.5, { type: 'lowpass', f0: 400, f1: 150 });
    this.noise('sfx', 0.09, 0.5, { type: 'lowpass', f0: 380, f1: 140 }, 0.16);
  }
  bubblePop(): void { this.tone('sfx', 'sine', 740 + Math.random() * 160, 990, 0.06, 0.07); }
  toast(): void { this.tone('sfx', 'triangle', 587, 784, 0.1, 0.08); }
  splash(): void {
    this.noise('sfx', 0.35, 0.4, { type: 'bandpass', f0: 1400, f1: 500, q: 1.2 });
  }
  hop(): void { this.tone('sfx', 'sine', 300, 520, 0.12, 0.12); }

  /** Feed the hero's gait every frame; emits soft footsteps in rhythm. */
  movement(anim: 'idle' | 'walk' | 'run', dt: number): void {
    if (anim === 'idle') { this.stepAcc = 0; return; }
    this.stepAcc += dt * (anim === 'run' ? 3.4 : 2.2);
    if (this.stepAcc >= 1) {
      this.stepAcc -= 1;
      this.noise('sfx', 0.05, 0.12, { type: 'lowpass', f0: 700, f1: 250 }, 0, 0.7 + Math.random() * 0.2);
    }
  }

  // ── ambient beds ──────────────────────────────────────────────────────────

  setAmbient(mode: 'town' | 'arena'): void {
    if (mode === this.ambientMode) return;
    this.ambientMode = mode;
    if (!this.ctx) return; // starts when unlocked
    this.startAmbient(mode);
  }

  private startAmbient(mode: 'town' | 'arena'): void {
    const ctx = this.ctx!;
    for (const n of this.ambientNodes) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* done */ } n.disconnect(); }
    this.ambientNodes = [];
    if (!this.noiseBuf) return;

    if (mode === 'town') {
      // wind: slow-breathing filtered noise
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      const g = ctx.createGain(); g.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 140;
      lfo.connect(lfoG).connect(f.frequency);
      src.connect(f).connect(g).connect(this.buses.ambient);
      src.start(); lfo.start();
      this.ambientNodes.push(src, lfo, f, g);
    } else {
      // the chamber: a low drone + fluorescent hum
      const drone = ctx.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 55;
      const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 160;
      const dg = ctx.createGain(); dg.gain.value = 0.4;
      drone.connect(df).connect(dg).connect(this.buses.ambient);
      const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 120;
      const hg = ctx.createGain(); hg.gain.value = 0.05;
      hum.connect(hg).connect(this.buses.ambient);
      drone.start(); hum.start();
      this.ambientNodes.push(drone, hum, df, dg, hg);
    }
  }

  // ── the boss music: a 16-step chiptune sequencer ──────────────────────────

  startMusic(): void {
    if (this.musicTimer || !this.ctx) return;
    this.musicStep = 0;
    const BASS = [55, 55, 0, 55, 65.4, 0, 55, 0, 55, 55, 0, 55, 49, 0, 62, 0];
    const ARP = [220, 0, 262, 0, 330, 0, 262, 0, 220, 0, 262, 0, 349, 0, 330, 0];
    this.musicTimer = setInterval(() => {
      const i = this.musicStep++ % 16;
      const swing = this.musicIntensity;
      const b = BASS[i];
      if (b) this.tone('music', 'triangle', b * (swing > 0.5 && i % 4 === 2 ? 2 : 1), b, 0.16, 0.5);
      const a = ARP[i];
      if (a && (swing > 0.5 || i % 2 === 0)) this.tone('music', 'square', a * (1 + swing), a, 0.08, 0.1);
      if (i % 4 === 0) this.noise('music', 0.04, 0.2, { type: 'highpass', f0: 6000 }); // hat
      if (swing > 0.5 && i % 8 === 4) this.noise('music', 0.12, 0.3, { type: 'lowpass', f0: 300, f1: 80 }); // kick
    }, 140);
  }

  setMusicIntensity(v: number): void { this.musicIntensity = v; }

  stopMusic(): void {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
}
