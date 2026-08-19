/**
 * Tiny WebAudio synth: no asset files, everything is generated.
 * All nodes hang off a master gain so muting is a single knob.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenPhase = 0;

  muted = false;

  /** Must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private burst(duration: number, gain: number, filterHz: number, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterHz;

    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'square', slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  gunshot(kind: 'pistol' | 'smg' | 'shotgun'): void {
    if (kind === 'shotgun') this.burst(0.24, 0.7, 1600);
    else if (kind === 'smg') this.burst(0.07, 0.32, 2600, 'highpass');
    else this.burst(0.12, 0.45, 2200);
  }

  punch(): void {
    this.tone(180, 0.09, 0.2, 'sine', 90);
  }

  hit(): void {
    this.burst(0.06, 0.22, 900);
  }

  ricochet(): void {
    this.tone(1400 + Math.random() * 500, 0.06, 0.08, 'triangle', 400);
  }

  explosion(): void {
    this.burst(0.9, 0.9, 700);
    this.tone(80, 0.6, 0.35, 'sawtooth', 30);
  }

  pickup(): void {
    this.tone(660, 0.09, 0.16, 'square');
    setTimeout(() => this.tone(990, 0.11, 0.14, 'square'), 70);
  }

  cash(): void {
    this.tone(880, 0.07, 0.14, 'triangle');
    setTimeout(() => this.tone(1320, 0.12, 0.12, 'triangle'), 60);
  }

  missionPass(): void {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 0.14, 'square'), i * 110));
  }

  missionFail(): void {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 0.14, 'sawtooth'), i * 130));
  }

  horn(): void {
    this.tone(420, 0.25, 0.14, 'square');
  }

  /** Continuous engine drone; call every frame with 0..1 load. */
  engine(active: boolean, load: number): void {
    if (!this.ctx || !this.master) return;
    if (active && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
    }
    if (!active && this.engineOsc) {
      this.engineOsc.stop();
      this.engineOsc.disconnect();
      this.engineOsc = null;
      this.engineGain = null;
      return;
    }
    if (this.engineOsc && this.engineGain) {
      const now = this.ctx.currentTime;
      this.engineOsc.frequency.setTargetAtTime(55 + load * 150, now, 0.08);
      this.engineGain.gain.setTargetAtTime(0.035 + load * 0.05, now, 0.1);
    }
  }

  /** Two-tone police siren; call every frame while cops are close. */
  siren(active: boolean, dt: number, intensity: number): void {
    if (!this.ctx || !this.master) return;
    if (active && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenOsc.type = 'sine';
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
    }
    if (!active && this.sirenOsc) {
      this.sirenOsc.stop();
      this.sirenOsc.disconnect();
      this.sirenOsc = null;
      this.sirenGain = null;
      return;
    }
    if (this.sirenOsc && this.sirenGain) {
      this.sirenPhase += dt;
      const high = this.sirenPhase % 0.9 < 0.45;
      const now = this.ctx.currentTime;
      this.sirenOsc.frequency.setTargetAtTime(high ? 760 : 560, now, 0.02);
      this.sirenGain.gain.setTargetAtTime(0.05 * intensity, now, 0.08);
    }
  }

  dispose(): void {
    this.engine(false, 0);
    this.siren(false, 0, 0);
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }
}
