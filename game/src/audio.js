// Synthesized WebAudio for Wispwarden. No audio assets: every sound is built
// from oscillators and one locally generated noise buffer. The AudioContext is
// created only after the first real user gesture, and screenshot mode never
// creates one. Audio never affects the simulation.

const MASTER_GAIN = 0.18;
const MAX_VOICES = 24;
const KILL_CHIME_MIN_GAP_MS = 40;

export function createAudio() {
  return {
    ctx: null, // AudioContext, created lazily on first gesture
    master: null, // GainNode feeding the compressor
    noiseBuffer: null, // locally generated white-noise buffer
    muted: false,
    voices: 0, // currently sounding voices, capped at MAX_VOICES
    lastKillMs: -Infinity, // audio-clock time of the last kill chime
  };
}

// Create the context and the master chain. Call only from a real user gesture.
export function ensureAudio(audio) {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') void audio.ctx.resume();
    return true;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = audio.muted ? 0 : MASTER_GAIN;
    master.connect(comp);
    audio.ctx = ctx;
    audio.master = master;
    // One second of white noise, generated locally, reused by the hurt sound.
    const len = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    audio.noiseBuffer = buffer;
    return true;
  } catch {
    audio.ctx = null;
    return false;
  }
}

export function setMuted(audio, muted) {
  audio.muted = muted;
  if (audio.ctx && audio.master) {
    const t = audio.ctx.currentTime;
    audio.master.gain.cancelScheduledValues(t);
    audio.master.gain.setValueAtTime(audio.master.gain.value, t);
    audio.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, t + 0.02);
  }
}

// A tone voice: one oscillator through a gain envelope, disconnected on end.
function tone(audio, { type, from, to, at, dur, gain }) {
  const ctx = audio.ctx;
  if (!ctx || !audio.master || audio.voices >= MAX_VOICES) return;
  const t0 = ctx.currentTime + (at || 0);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== undefined && to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(audio.master);
  audio.voices++;
  osc.onended = () => {
    audio.voices--;
    osc.disconnect();
    g.disconnect();
  };
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(audio, { dur, gain, cutoff }) {
  const ctx = audio.ctx;
  if (!ctx || !audio.master || !audio.noiseBuffer || audio.voices >= MAX_VOICES) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(audio.master);
  audio.voices++;
  src.onended = () => {
    audio.voices--;
    src.disconnect();
    filter.disconnect();
    g.disconnect();
  };
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// Shoot: triangle 880 -> 440 Hz over 55 ms, one voice per volley.
export function playShoot(audio) {
  if (!audio.ctx) return;
  tone(audio, { type: 'triangle', from: 880, to: 440, dur: 0.07, gain: 0.5 });
}

// Kill: two sines a perfect fifth apart for 110 ms. The root rises with the
// combo, one semitone per combo step. At most one chime per 40 ms of audio time.
export function playKill(audio, combo) {
  if (!audio.ctx) return;
  const nowMs = audio.ctx.currentTime * 1000;
  if (nowMs - audio.lastKillMs < KILL_CHIME_MIN_GAP_MS) return;
  audio.lastKillMs = nowMs;
  const root = 330 * Math.pow(2, (combo - 1) / 12);
  tone(audio, { type: 'sine', from: root, dur: 0.11, gain: 0.4 });
  tone(audio, { type: 'sine', from: root * 1.5, dur: 0.11, gain: 0.3 });
}

// Hurt: low triangle 150 -> 55 Hz over 180 ms plus 90 ms of low-passed noise.
export function playHurt(audio) {
  if (!audio.ctx) return;
  tone(audio, { type: 'triangle', from: 150, to: 55, dur: 0.18, gain: 0.7 });
  noiseBurst(audio, { dur: 0.09, gain: 0.5, cutoff: 400 });
}

// Wave horn: triangle notes 220, 277.18, 329.63 Hz staggered by 80 ms.
export function playHorn(audio) {
  if (!audio.ctx) return;
  const notes = [220, 277.18, 329.63];
  notes.forEach((f, i) => tone(audio, { type: 'triangle', from: f, at: i * 0.08, dur: 0.45 - i * 0.08, gain: 0.45 }));
}

// Upgrade pick: ascending sine arpeggio, notes 65 ms apart.
export function playUpgrade(audio) {
  if (!audio.ctx) return;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => tone(audio, { type: 'sine', from: f, at: i * 0.065, dur: 0.12, gain: 0.4 }));
}

// Game over: descending triangle notes, 180 ms apart, about one second total.
export function playGameOver(audio) {
  if (!audio.ctx) return;
  const notes = [329.63, 261.63, 196, 130.81];
  notes.forEach((f, i) => tone(audio, { type: 'triangle', from: f, at: i * 0.18, dur: 0.3, gain: 0.5 }));
}

// Pause: fade sustained tails quickly so nothing rings over the pause panel.
export function fadeTails(audio) {
  if (!audio.ctx || !audio.master) return;
  const t = audio.ctx.currentTime;
  audio.master.gain.cancelScheduledValues(t);
  audio.master.gain.setValueAtTime(audio.master.gain.value, t);
  audio.master.gain.linearRampToValueAtTime(audio.muted ? 0 : MASTER_GAIN, t + 0.15);
}
