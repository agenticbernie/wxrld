import type { GameContext } from '../core/context';
import type { GameEventMap } from '../types/game';

export class AudioFacade {
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private effects: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicVolume = 0.25;
  private effectsVolume = 0.55;
  private muted = false;
  private heartbeatAt = 0;
  private ambientAt = 0;
  private voices = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly ctx: GameContext) {
    this.unsubscribe = ctx.events.on('audio:cue', payload => this.cue(payload.cue));
  }
  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.audio) {
      if (typeof AudioContext === 'undefined') return;
      this.audio = new AudioContext();
      this.master = this.audio.createGain();
      this.effects = this.audio.createGain();
      this.ambience = this.audio.createGain();
      const compressor = this.audio.createDynamicsCompressor();
      compressor.threshold.value = -16; compressor.knee.value = 12; compressor.ratio.value = 5;
      this.effects.connect(this.master); this.ambience.connect(this.master); this.master.connect(compressor); compressor.connect(this.audio.destination);
      this.noise = this.audio.createBuffer(1, this.audio.sampleRate, this.audio.sampleRate);
      const values = this.noise.getChannelData(0);
      for (let i = 0; i < values.length; i++) values[i] = (Math.random() * 2 - 1) * 0.75;
      this.applyVolume();
    }
    if (this.audio.state === 'suspended') await this.audio.resume();
  }
  setVolumes(music: number, sfx: number): void { this.musicVolume = Math.max(0, Math.min(1, music)); this.effectsVolume = Math.max(0, Math.min(1, sfx)); this.applyVolume(); }
  setMuted(muted: boolean): void { this.muted = muted; this.applyVolume(); }
  private applyVolume(): void {
    if (!this.audio || !this.master || !this.effects || !this.ambience) return;
    const now = this.audio.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.65, now, 0.03);
    this.effects.gain.setTargetAtTime(this.effectsVolume, now, 0.03);
    this.ambience.gain.setTargetAtTime(this.musicVolume, now, 0.05);
  }
  update(_dt: number): void {
    if (!this.audio || this.audio.state !== 'running' || this.muted || this.disposed) return;
    const now = this.audio.currentTime;
    const active = this.ctx.state.phase === 'playing';
    if (active && this.ctx.state.player.overdrive && now >= this.heartbeatAt) {
      const danger = 1 - this.ctx.state.player.hp / Math.max(1, this.ctx.state.player.maxHp * 0.3);
      this.heartbeatAt = now + 0.7 - Math.max(0, danger) * 0.25;
      const volume = this.ctx.state.settings.reducedMotion ? 0.06 : 0.12;
      this.tone(66, 35, 0.13, 'sine', volume, now);
      this.tone(52, 32, 0.12, 'sine', volume * 0.65, now + 0.16);
    }
    if (now >= this.ambientAt && this.ctx.state.phase !== 'paused') {
      this.ambientAt = now + 6;
      const root = this.ctx.state.dayPhase === 'night' ? 55 : 73.42;
      this.tone(root, root * 0.999, 5.5, 'sine', 0.045, now, true);
      this.tone(root * 1.5, root * 1.502, 4.5, 'triangle', 0.022, now + 0.4, true);
      this.noiseBurst(1.5, 340, 0.015, now, true);
    }
  }
  private cue(cue: GameEventMap['audio:cue']['cue']): void {
    if (!this.audio || this.audio.state !== 'running' || this.muted || this.disposed || this.voices >= 36) return;
    const now = this.audio.currentTime;
    switch (cue) {
      case 'swing': this.noiseBurst(0.16, 950, 0.10, now); break;
      case 'wood': this.tone(180, 65, 0.09, 'triangle', 0.15, now); this.noiseBurst(0.08, 450, 0.13, now); break;
      case 'stone': case 'mine': this.tone(1450, 800, 0.12, 'sine', 0.07, now); this.tone(870, 640, 0.09, 'triangle', 0.06, now); break;
      case 'hit': this.tone(100, 35, 0.1, 'triangle', 0.17, now); this.noiseBurst(0.07, 2100, 0.14, now); break;
      case 'dash': this.noiseBurst(0.19, 1800, 0.10, now); break;
      case 'bow': this.tone(260, 85, 0.13, 'triangle', 0.08, now); this.noiseBurst(0.12, 2700, 0.045, now); break;
      case 'magic': case 'lightning': this.tone(620, 1200, 0.12, 'sawtooth', 0.025, now); this.noiseBurst(0.12, 4800, 0.09, now); break;
      case 'night': case 'boss': this.tone(55, 48, 3.2, 'sawtooth', 0.045, now, true); this.tone(82.4, 72, 3.8, 'triangle', 0.04, now, true); break;
      case 'beacon': case 'extract': for (let i = 0; i < 4; i++) this.tone(220 * 2 ** (i / 4), 220 * 2 ** (i / 4), 0.7, 'sine', 0.08, now + i * 0.15); break;
      case 'craft': case 'draft': this.tone(440, 660, 0.3, 'sine', 0.055, now); this.tone(880, 880, 0.35, 'sine', 0.035, now + 0.08); break;
      case 'death': this.tone(120, 32, 1.6, 'triangle', 0.13, now); this.noiseBurst(0.8, 180, 0.05, now); break;
      case 'overdrive': this.tone(80, 45, 0.45, 'sine', 0.10, now); break;
    }
  }
  private tone(start: number, end: number, duration: number, wave: OscillatorType, volume: number, at: number, ambient = false): void {
    if (!this.audio || !this.effects || !this.ambience || this.voices >= 36) return;
    const oscillator = this.audio.createOscillator(); const gain = this.audio.createGain();
    oscillator.type = wave; oscillator.frequency.setValueAtTime(start, at); oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), at + duration);
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + Math.min(0.03, duration / 3)); gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain); gain.connect(ambient ? this.ambience : this.effects); this.voices++;
    oscillator.onended = () => { this.voices--; oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at); oscillator.stop(at + duration + 0.02);
  }
  private noiseBurst(duration: number, frequency: number, volume: number, at: number, ambient = false): void {
    if (!this.audio || !this.noise || !this.effects || !this.ambience || this.voices >= 36) return;
    const source = this.audio.createBufferSource(); const filter = this.audio.createBiquadFilter(); const gain = this.audio.createGain();
    source.buffer = this.noise; filter.type = 'bandpass'; filter.frequency.setValueAtTime(frequency, at); filter.Q.value = 0.6;
    gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter); filter.connect(gain); gain.connect(ambient ? this.ambience : this.effects); this.voices++;
    source.onended = () => { this.voices--; source.disconnect(); filter.disconnect(); gain.disconnect(); }; source.start(at); source.stop(at + Math.min(duration, 0.98));
  }
  dispose(): void { this.disposed = true; this.unsubscribe(); void this.audio?.close(); this.audio = null; this.noise = null; }
}
