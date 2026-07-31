/* WebAudio sound packs — synthesised on the fly, so nothing to download.
   Muted by default; the context is only created after a real user gesture. */

let ctx = null;
let muted = true;
let pack = 'chime';

function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function setMuted(value) {
  muted = Boolean(value);
  if (!muted) context()?.resume?.();
}

export function isMuted() {
  return muted;
}

export function setPack(id) {
  pack = id || 'chime';
}

function tone({ freq = 440, dur = 0.18, type = 'sine', gain = 0.12, delay = 0, sweepTo = null, filter = null }) {
  const audio = context();
  if (!audio) return;
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let node = osc;
  if (filter) {
    const biquad = audio.createBiquadFilter();
    biquad.type = 'lowpass';
    biquad.frequency.setValueAtTime(filter, t0);
    node.connect(biquad);
    node = biquad;
  }
  node.connect(amp).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function chirp(delay = 0) {
  // Crickets: a couple of very short high bursts.
  for (let i = 0; i < 3; i += 1) {
    tone({ freq: 4200, dur: 0.03, type: 'triangle', gain: 0.06, delay: delay + i * 0.05 });
  }
}

const PACKS = {
  chime: {
    check: () => { tone({ freq: 880, dur: 0.22 }); tone({ freq: 1320, dur: 0.3, gain: 0.06, delay: 0.04 }); },
    uncheck: () => tone({ freq: 420, dur: 0.16, gain: 0.07, sweepTo: 300 }),
    level: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.3, delay: i * 0.09, gain: 0.09 })),
    complete: () => [659, 784, 988, 1319].forEach((f, i) => tone({ freq: f, dur: 0.45, delay: i * 0.12, gain: 0.08 })),
  },
  crickets: {
    check: () => chirp(),
    uncheck: () => tone({ freq: 300, dur: 0.12, type: 'triangle', gain: 0.05 }),
    level: () => { chirp(); chirp(0.12); chirp(0.24); },
    complete: () => { chirp(); chirp(0.1); chirp(0.2); chirp(0.34); },
  },
  windchime: {
    // Three, because the pack is sold as "Three notes on a breeze" and the
    // shop's Preview button plays exactly this.
    check: () => [523, 698, 880].forEach((f, i) => tone({ freq: f, dur: 0.9, gain: 0.05, delay: i * 0.07, type: 'sine' })),
    uncheck: () => tone({ freq: 392, dur: 0.5, gain: 0.04 }),
    level: () => [523, 587, 698, 880, 1046].forEach((f, i) => tone({ freq: f, dur: 1.1, gain: 0.045, delay: i * 0.11 })),
    complete: () => [440, 523, 659, 880, 1174].forEach((f, i) => tone({ freq: f, dur: 1.4, gain: 0.05, delay: i * 0.14 })),
  },
  synth: {
    check: () => tone({ freq: 220, sweepTo: 660, dur: 0.16, type: 'sawtooth', gain: 0.07, filter: 2200 }),
    uncheck: () => tone({ freq: 440, sweepTo: 160, dur: 0.18, type: 'sawtooth', gain: 0.06, filter: 1400 }),
    level: () => [220, 330, 440, 660].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'square', gain: 0.05, delay: i * 0.08, filter: 2600 })),
    complete: () => [330, 440, 550, 880].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sawtooth', gain: 0.06, delay: i * 0.1, filter: 3000 })),
  },
};

const SHARED = {
  buy: () => { tone({ freq: 660, dur: 0.12, gain: 0.07 }); tone({ freq: 990, dur: 0.2, gain: 0.06, delay: 0.08 }); },
  quest: () => [784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.28, gain: 0.07, delay: i * 0.08 })),
  error: () => tone({ freq: 180, dur: 0.18, type: 'square', gain: 0.05, filter: 800 }),
  star: () => tone({ freq: 1400, dur: 0.5, gain: 0.05, sweepTo: 2100 }),
};

export function play(event) {
  if (muted) return;
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  const fn = (PACKS[pack] || PACKS.chime)[event] || SHARED[event];
  if (fn) fn();
}

/** Preview used by the shop so you can hear a pack before buying it. */
export function previewPack(id) {
  const previous = { pack, muted };
  pack = id;
  muted = false;
  play('check');
  setTimeout(() => {
    pack = previous.pack;
    muted = previous.muted;
  }, 600);
}
