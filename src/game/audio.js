/**
 * Tiny procedural sound kit. No files, no dependencies: the pistol, the dry
 * click, the reload and the station pickups are all built from oscillators and
 * one shared noise buffer.
 *
 * The context is created lazily and resumed on the first gesture, which is
 * what browser autoplay policies require.
 */
let context = null;
let master = null;
let noiseBuffer = null;

function ensureContext() {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);
  }
  if (context.state === "suspended") context.resume();
  return context;
}

function noiseSource(ctx) {
  if (!noiseBuffer) {
    const length = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  return source;
}

function burst({ duration = 0.14, gain = 0.5, cutoff = 2400, drop = 180 } = {}) {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const source = noiseSource(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, now);
  filter.frequency.exponentialRampToValueAtTime(drop, now + duration);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(gain, now);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function tone({ from = 200, to = 80, duration = 0.2, gain = 0.2, type = "sine", delay = 0 } = {}) {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export const audio = {
  /** Call once after load; the actual resume happens on the first gesture. */
  unlock() {
    ensureContext();
    if (typeof window === "undefined") return;
    const resume = () => ensureContext();
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
  },

  shoot() {
    burst({ duration: 0.16, gain: 0.55, cutoff: 2600, drop: 160 });
    tone({ from: 150, to: 42, duration: 0.18, gain: 0.3, type: "triangle" });
  },

  dry() {
    burst({ duration: 0.035, gain: 0.18, cutoff: 5000, drop: 3200 });
    tone({ from: 1800, to: 1200, duration: 0.03, gain: 0.05, type: "square" });
  },

  reloadStart() {
    tone({ from: 700, to: 500, duration: 0.05, gain: 0.09, type: "square" });
    burst({ duration: 0.12, gain: 0.14, cutoff: 1500, drop: 500 });
  },

  reloadEnd() {
    tone({ from: 520, to: 760, duration: 0.06, gain: 0.08, type: "square" });
    burst({ duration: 0.06, gain: 0.1, cutoff: 2200, drop: 900 });
  },

  stun() {
    tone({ from: 420, to: 70, duration: 0.55, gain: 0.16, type: "sawtooth" });
    burst({ duration: 0.3, gain: 0.12, cutoff: 900, drop: 120 });
  },

  pickup() {
    tone({ from: 660, to: 660, duration: 0.09, gain: 0.09, type: "sine" });
    tone({ from: 990, to: 990, duration: 0.12, gain: 0.07, type: "sine", delay: 0.08 });
  },
};
