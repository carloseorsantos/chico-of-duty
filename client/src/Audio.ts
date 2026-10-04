// Áudio do jogo com Web Audio API. Cada efeito tem uma versão sintetizada
// proceduralmente; se existir um arquivo em /sfx/<nome>.mp3 (ex.: gerado com
// ElevenLabs via `npm run sfx`), ele é usado no lugar da síntese.

import type { WeaponId } from '../../shared/weapons.ts';

export type Sfx =
  | 'rifle' | 'pump' | 'sniper' | 'melee' | 'reload' | 'rack' | 'bolt' | 'dry'
  | 'step' | 'jump' | 'land' | 'slide' | 'hit' | 'headshot' | 'kill' | 'hurt' | 'death'
  | 'radio' | 'switch' | 'spawn' | 'win' | 'lose'
  | 'boom' | 'whistle' | 'coo' | 'flap';

/** Som do disparo de cada arma (o bombardeio não dispara: o som vem do bando de pombos). */
export const WEAPON_SFX: Record<WeaponId, Sfx | null> = { 0: 'rifle', 1: 'pump', 2: 'sniper', 3: 'melee', 4: null };

const SAMPLE_NAMES: string[] = [
  'rifle', 'pump', 'sniper', 'melee', 'reload', 'hurt', 'death',
  'slide', 'win', 'lose', 'radio', 'purr', 'music', // music.mp3 é opcional
  'radio_0', 'radio_1', 'radio_2', 'radio_3', 'radio_4', 'radio_5',
];

/** Duração máxima (s) de cada sample: tiros rápidos não podem empilhar caudas longas. */
const MAX_DUR: Record<string, number> = { rifle: 0.35, pump: 0.9, sniper: 1.2, melee: 0.5, hurt: 0.8, slide: 0.8, radio: 0.45 };

interface PlayOpts {
  pos?: { x: number; y: number; z: number };
  volume?: number;
}

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private samples = new Map<string, AudioBuffer>();
  private purrGain: GainNode | null = null;
  private purrSrc: AudioScheduledSourceNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  listener = { x: 0, y: 0, z: 0, yaw: 0 };

  /** Precisa ser chamado a partir de um gesto do usuário (clique). */
  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    void this.loadSamples();
  }

  private async loadSamples(): Promise<void> {
    await Promise.all(SAMPLE_NAMES.map(async (name) => {
      try {
        const res = await fetch(`/sfx/${name}.mp3`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('audio')) return;
        const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        this.samples.set(name, buf);
      } catch { /* sem sample: usa síntese */ }
    }));
    if (this.samples.has('music') && !this.music) this.playMusic();
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  // ── Roteamento espacial simples ─────────────────────────────────────────

  private out(opts: PlayOpts): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let vol = opts.volume ?? 1;
    if (opts.pos) {
      const dx = opts.pos.x - this.listener.x, dz = opts.pos.z - this.listener.z;
      const dist = Math.hypot(dx, dz, opts.pos.y - this.listener.y);
      vol *= 1 / (1 + dist * 0.07);
      const pan = ctx.createStereoPanner();
      // Ângulo relativo à direção da câmera (yaw 0 = -Z)
      const ang = Math.atan2(-dx, -dz) - this.listener.yaw;
      pan.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang) * Math.min(1, dist / 3)));
      g.connect(pan).connect(this.sfxBus);
      if (dist > 8) {
        // Distância abafa os agudos
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(900, 12000 - dist * 180);
        lp.connect(g);
        g.gain.value = vol;
        return lp;
      }
    } else {
      g.connect(this.sfxBus);
    }
    g.gain.value = vol;
    return g;
  }

  /** Toca um efeito. Falha de áudio nunca pode interromper a lógica do jogo. */
  play(name: Sfx | string, opts: PlayOpts = {}): void {
    try { this.playUnsafe(name, opts); } catch (err) { console.warn('áudio falhou:', name, err); }
  }

  private playUnsafe(name: Sfx | string, opts: PlayOpts): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const dest = this.out(opts);
    const sample = this.samples.get(name);
    if (sample) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = name.startsWith('radio_') ? 1 : 0.95 + Math.random() * 0.1;
      let out: AudioNode = dest;
      if (name.startsWith('radio_')) out = this.radioFilter(dest);
      const max = MAX_DUR[name];
      if (max) {
        // Fade curto no fim para não estalar
        const env = this.ctx.createGain();
        const t = this.ctx.currentTime;
        env.gain.setValueAtTime(1, t + max * 0.7);
        env.gain.linearRampToValueAtTime(0, t + max);
        env.connect(out);
        out = env;
      }
      src.connect(out);
      src.start();
      if (max) src.stop(this.ctx.currentTime + max + 0.02); // stop só depois do start
      return;
    }
    const synth = (this as unknown as Record<string, (d: AudioNode) => void>)[`s_${name}`];
    if (synth) synth.call(this, dest);
  }

  /** Fala do rádio: usa a gravação se existir, senão o bipe de rádio. */
  radio(id: number): void {
    if (!this.ctx) return;
    this.play('radio');
    const key = `radio_${id}`;
    if (this.samples.has(key)) setTimeout(() => this.play(key, { volume: 1.1 }), 180);
    else setTimeout(() => this.s_meow(this.out({ volume: 0.5 }), true), 150);
  }

  /** Voz de rádio: passa-banda + leve saturação. */
  private radioFilter(dest: AudioNode): AudioNode {
    const ctx = this.ctx!;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    sh.curve = curve;
    hp.connect(sh).connect(lp).connect(dest);
    return hp;
  }

  // ── Blocos de síntese ───────────────────────────────────────────────────

  private noiseBurst(dest: AudioNode, t0: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, f0: number, f1: number, vol: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private get now(): number {
    return this.ctx!.currentTime;
  }

  s_rifle(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 0.16, 3200, 0.8, 0.9);
    this.noiseBurst(d, t, 0.05, 7000, 0.5, 0.5, 'highpass');
    this.tone(d, t, 0.12, 180, 45, 0.9, 'triangle');
  }

  s_pump(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 0.35, 1800, 0.7, 1.1);
    this.tone(d, t, 0.25, 120, 30, 1.0, 'sine');
    this.noiseBurst(d, t + 0.02, 0.5, 600, 0.5, 0.35);
  }

  s_sniper(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 0.08, 9000, 0.4, 0.8, 'highpass');
    this.noiseBurst(d, t, 0.6, 2400, 0.6, 1.0);
    this.tone(d, t, 0.4, 90, 28, 1.1, 'sine');
    this.noiseBurst(d, t + 0.12, 0.9, 400, 0.4, 0.25); // eco na sala
  }

  s_melee(d: AudioNode): void {
    const t = this.now;
    for (let i = 0; i < 3; i++) this.noiseBurst(d, t + i * 0.025, 0.07, 5000 + i * 900, 3, 0.35, 'bandpass');
    this.tone(d, t, 0.12, 900, 300, 0.1, 'sawtooth');
  }

  s_reload(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 0.05, 2500, 4, 0.5, 'bandpass');
    this.tone(d, t, 0.04, 1400, 900, 0.2, 'square');
    this.noiseBurst(d, t + 0.45, 0.06, 3000, 5, 0.6, 'bandpass');
    this.tone(d, t + 0.45, 0.05, 1800, 1200, 0.25, 'square');
    this.noiseBurst(d, t + 0.8, 0.07, 2000, 3, 0.5, 'bandpass');
  }

  s_rack(d: AudioNode): void {
    const t = this.now + 0.25;
    this.noiseBurst(d, t, 0.08, 1500, 3, 0.6, 'bandpass');
    this.noiseBurst(d, t + 0.14, 0.08, 2200, 3, 0.7, 'bandpass');
  }

  s_bolt(d: AudioNode): void {
    const t = this.now + 0.35;
    this.tone(d, t, 0.05, 2200, 1500, 0.2, 'square');
    this.noiseBurst(d, t + 0.12, 0.09, 1800, 4, 0.5, 'bandpass');
    this.tone(d, t + 0.3, 0.05, 2600, 1900, 0.2, 'square');
  }

  // ── Bombardeio de Pombos ──────────────────────────────────────────────────

  s_boom(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 1.4, 900, 0.5, 1.4);
    this.noiseBurst(d, t, 0.25, 4000, 0.6, 0.7);
    this.tone(d, t, 0.9, 85, 28, 1.4, 'sine');
    this.noiseBurst(d, t + 0.2, 1.6, 300, 0.4, 0.5); // eco/estrondo
  }

  s_whistle(d: AudioNode): void {
    this.tone(d, this.now, 0.75, 1900, 650, 0.12, 'sine');
  }

  s_coo(d: AudioNode): void {
    // Arrulho: dois "uuu" graves com vibrato
    const t = this.now;
    for (const [dt, f] of [[0, 330], [0.32, 290]] as const) {
      this.tone(d, t + dt, 0.28, f, f * 0.82, 0.25, 'triangle');
      this.tone(d, t + dt, 0.28, f * 1.5, f * 1.2, 0.06, 'sine');
    }
  }

  s_flap(d: AudioNode): void {
    const t = this.now;
    for (let i = 0; i < 10; i++) this.noiseBurst(d, t + i * 0.09 + Math.random() * 0.02, 0.06, 900 + Math.random() * 600, 1.5, 0.35, 'bandpass');
  }

  s_dry(d: AudioNode): void {
    this.tone(d, this.now, 0.03, 3000, 2000, 0.25, 'square');
  }

  s_step(d: AudioNode): void {
    // Passinho fofo de patinha: baque abafado bem curto
    const t = this.now;
    this.noiseBurst(d, t, 0.06, 380 + Math.random() * 120, 1.2, 0.28);
    this.tone(d, t, 0.05, 110, 70, 0.12);
  }

  s_jump(d: AudioNode): void {
    this.noiseBurst(d, this.now, 0.12, 900, 1, 0.15);
  }

  s_land(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 0.1, 300, 1, 0.45);
    this.tone(d, t, 0.08, 90, 50, 0.25);
  }

  s_slide(d: AudioNode): void {
    const t = this.now;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    src.connect(f).connect(g).connect(d);
    src.start(t, 0, 0.7);
  }

  s_hit(d: AudioNode): void {
    // O "tic" clássico do hitmarker
    const t = this.now;
    this.tone(d, t, 0.05, 2600, 2400, 0.35, 'square');
    this.noiseBurst(d, t, 0.03, 6000, 2, 0.3, 'bandpass');
  }

  s_headshot(d: AudioNode): void {
    const t = this.now;
    this.tone(d, t, 0.25, 1800, 1750, 0.3, 'sine');
    this.tone(d, t, 0.25, 2700, 2650, 0.15, 'sine');
    this.noiseBurst(d, t, 0.04, 5000, 2, 0.3, 'bandpass');
  }

  s_kill(d: AudioNode): void {
    const t = this.now;
    this.tone(d, t, 0.12, 880, 880, 0.2, 'triangle');
    this.tone(d, t + 0.09, 0.2, 1320, 1320, 0.2, 'triangle');
  }

  s_hurt(d: AudioNode): void {
    this.s_meow(d, false, 0.5, 1.25);
    this.noiseBurst(d, this.now, 0.1, 700, 1, 0.3);
  }

  s_death(d: AudioNode): void {
    this.s_meow(d, false, 0.6, 0.8, 0.9);
  }

  s_radio(d: AudioNode): void {
    // Bipe de rádio + chiado
    const t = this.now;
    this.tone(d, t, 0.08, 1400, 1400, 0.15, 'square');
    this.noiseBurst(d, t + 0.08, 0.25, 2500, 0.6, 0.12, 'bandpass');
  }

  s_switch(d: AudioNode): void {
    const t = this.now;
    this.noiseBurst(d, t, 0.05, 1800, 3, 0.35, 'bandpass');
    this.tone(d, t + 0.06, 0.04, 1100, 900, 0.12, 'square');
  }

  s_spawn(d: AudioNode): void {
    const t = this.now;
    [523, 659, 784].forEach((f, i) => this.tone(d, t + i * 0.07, 0.18, f, f, 0.12, 'triangle'));
  }

  s_win(d: AudioNode): void {
    const t = this.now;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.14, 0.4, f, f, 0.2, 'triangle'));
  }

  s_lose(d: AudioNode): void {
    const t = this.now;
    [392, 349, 311, 262].forEach((f, i) => this.tone(d, t + i * 0.18, 0.45, f, f * 0.98, 0.18, 'triangle'));
  }

  /** Miado sintetizado: formantes deslizando (mi-AU). */
  s_meow(d: AudioNode, radio = false, vol = 0.4, pitch = 1, dur = 0.5): void {
    const ctx = this.ctx!;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420 * pitch, t);
    o.frequency.linearRampToValueAtTime(720 * pitch, t + dur * 0.35);
    o.frequency.linearRampToValueAtTime(380 * pitch, t + dur);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(700, t);
    f1.frequency.linearRampToValueAtTime(1600, t + dur * 0.4);
    f1.frequency.linearRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let chain: AudioNode = o.connect(f1).connect(g);
    if (radio) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
      sh.curve = curve;
      chain = chain.connect(hp).connect(sh).connect(lp);
    }
    chain.connect(d);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ── Ronronado contínuo (cura) ───────────────────────────────────────────

  setPurring(on: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.purrGain) {
      this.purrGain = ctx.createGain();
      this.purrGain.gain.value = 0;
      this.purrGain.connect(this.sfxBus);
      const sample = this.samples.get('purr');
      if (sample) {
        const src = ctx.createBufferSource();
        src.buffer = sample; src.loop = true;
        src.connect(this.purrGain);
        src.start();
        this.purrSrc = src;
      } else {
        // Ruído grave modulado a ~25 Hz = ronronar
        const src = ctx.createBufferSource();
        src.buffer = this.noise; src.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
        const am = ctx.createGain(); am.gain.value = 0.5;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 24;
        const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
        lfo.connect(lfoGain).connect(am.gain);
        src.connect(lp).connect(am).connect(this.purrGain);
        src.start(); lfo.start();
        this.purrSrc = src;
      }
    }
    const target = on ? 0.9 : 0;
    this.purrGain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
  }

  // ── Música (opcional, só com sample) ────────────────────────────────────

  playMusic(): void {
    const buf = this.samples.get('music');
    if (!this.ctx || !buf || this.music) return;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.master);
    this.music = this.ctx.createBufferSource();
    this.music.buffer = buf;
    this.music.loop = true;
    this.music.connect(this.musicGain);
    this.music.start();
  }

  setMusicVolume(v: number): void {
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5);
  }
}

export const audio = new GameAudio();
