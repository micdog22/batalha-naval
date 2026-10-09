/**
 * Efeitos sonoros sintetizados com a Web Audio API, sem arquivos de áudio:
 * água (ruído filtrado que desce), acerto (baque grave mais estouro),
 * afundou (baque mais um tom que despenca) e fanfarras de fim de jogo.
 * O contexto só é criado depois de um clique ou tecla.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noise = null;
  }

  ensure() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  noiseBurst(start, duration, { from, to, type = 'bandpass', gain = 0.6, q = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(env).connect(this.out);
    src.start(start);
    src.stop(start + duration + 0.05);
  }

  tone(start, duration, { from, to, type = 'sine', gain = 0.5 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(this.out);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  play(name) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'miss':
        this.noiseBurst(t, 0.45, { from: 2200, to: 300, gain: 0.35, q: 0.8 });
        break;
      case 'hit':
        this.tone(t, 0.35, { from: 140, to: 45, gain: 0.8 });
        this.noiseBurst(t, 0.3, { from: 1800, to: 200, type: 'lowpass', gain: 0.5 });
        break;
      case 'sunk':
        this.tone(t, 0.4, { from: 120, to: 40, gain: 0.8 });
        this.noiseBurst(t, 0.6, { from: 1500, to: 120, type: 'lowpass', gain: 0.55 });
        this.tone(t + 0.15, 0.9, { from: 520, to: 70, type: 'sawtooth', gain: 0.12 });
        break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.12, 0.3, { from: f, to: f, type: 'triangle', gain: 0.3 }));
        break;
      case 'lose':
        [392, 349.23, 311.13, 261.63].forEach((f, i) => this.tone(t + i * 0.18, 0.4, { from: f, to: f * 0.98, type: 'triangle', gain: 0.3 }));
        break;
      default:
        break;
    }
  }
}
