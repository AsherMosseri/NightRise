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

/**
 * When this is an array, `tone()` records instead of playing.
 *
 * The market's sound cards used to be hand-written CSS — one
 * `.swatch--sounds.swatch--<id>` rule per pack — and three packs shipped
 * without one, so Kalimba, Temple Bell and Pulse showed an empty box on a card
 * that was charging 690 to 900 stardust. Adding three more rules would have
 * left the next pack to fail exactly the same way. Recording the real call
 * cannot: a pack that plays something has something to draw, because it is the
 * same function call answering both questions.
 */
let capture = null;

function tone({ freq = 440, dur = 0.18, type = 'sine', gain = 0.12, delay = 0, sweepTo = null, filter = null }) {
  if (capture) {
    capture.push({ freq, dur, type, gain, delay, sweepTo, filter });
    return;
  }
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
  // A thumb piece: short, woody, a little detuned so two in a row are not
  // identical. Triangle rather than sine because a kalimba has a hard onset.
  kalimba: {
    check: () => { tone({ freq: 587, dur: 0.5, type: 'triangle', gain: 0.07, filter: 2600 }); tone({ freq: 1174, dur: 0.3, gain: 0.03, delay: 0.01 }); },
    uncheck: () => tone({ freq: 392, dur: 0.3, type: 'triangle', gain: 0.05, filter: 1600 }),
    level: () => [523, 622, 784, 932].forEach((f, i) => tone({ freq: f, dur: 0.6, type: 'triangle', gain: 0.06, delay: i * 0.1, filter: 2800 })),
    complete: () => [440, 523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.8, type: 'triangle', gain: 0.055, delay: i * 0.12, filter: 3000 })),
  },
  // Low and long, and the one to have on when somebody else in the room is
  // already asleep — it was the quietest pack here until Music Box, which peaks
  // at 0.043 against this one's 0.080. Low is what carries it now, not faint.
  bell: {
    check: () => { tone({ freq: 196, dur: 1.6, gain: 0.06, filter: 900 }); tone({ freq: 294, dur: 1.1, gain: 0.025, delay: 0.02 }); },
    uncheck: () => tone({ freq: 147, dur: 0.7, gain: 0.04, filter: 700 }),
    level: () => [196, 262, 330].forEach((f, i) => tone({ freq: f, dur: 1.8, gain: 0.05, delay: i * 0.22, filter: 1100 })),
    complete: () => [131, 196, 262, 392].forEach((f, i) => tone({ freq: f, dur: 2.2, gain: 0.05, delay: i * 0.26, filter: 1200 })),
  },
  // Barely a note: a filtered thud with no pitch to speak of, for anyone who
  // wants to hear that something happened and nothing more than that.
  pulse: {
    check: () => tone({ freq: 150, sweepTo: 70, dur: 0.14, type: 'sine', gain: 0.09, filter: 400 }),
    uncheck: () => tone({ freq: 90, sweepTo: 60, dur: 0.12, type: 'sine', gain: 0.06, filter: 320 }),
    level: () => [110, 110, 165].forEach((f, i) => tone({ freq: f, sweepTo: f * 0.6, dur: 0.16, gain: 0.07, delay: i * 0.13, filter: 460 })),
    complete: () => [110, 147, 110, 220].forEach((f, i) => tone({ freq: f, sweepTo: f * 0.55, dur: 0.2, gain: 0.07, delay: i * 0.15, filter: 520 })),
  },
};

const SHARED = {
  buy: () => { tone({ freq: 660, dur: 0.12, gain: 0.07 }); tone({ freq: 990, dur: 0.2, gain: 0.06, delay: 0.08 }); },
  quest: () => [784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.28, gain: 0.07, delay: i * 0.08 })),
  error: () => tone({ freq: 180, dur: 0.18, type: 'square', gain: 0.05, filter: 800 }),
  star: () => tone({ freq: 1400, dur: 0.5, gain: 0.05, sweepTo: 2100 }),
};

/* Far Shelf. Very high, very short, very quiet — a comb tooth off a cylinder,
   heard through the lid. The only pack whose check is quieter than its uncheck,
   because a music box does not announce anything. */
PACKS.musicbox = {
  check: () => { tone({ freq: 2093, dur: 0.9, gain: 0.035, filter: 4200 }); tone({ freq: 3136, dur: 0.5, gain: 0.014, delay: 0.03, filter: 5200 }); },
  uncheck: () => tone({ freq: 1568, dur: 0.4, gain: 0.04, filter: 3200 }),
  level: () => [2093, 2349, 2637, 3136].forEach((f, i) => tone({ freq: f, dur: 1.1, gain: 0.03, delay: i * 0.16, filter: 4600 })),
  complete: () => [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone({ freq: f, dur: 1.4, gain: 0.028, delay: i * 0.2, filter: 5200 })),
};

export function play(event) {
  if (muted) return;
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  const fn = (PACKS[pack] || PACKS.chime)[event] || SHARED[event];
  if (fn) fn();
}

/**
 * The tones a pack plays for an event, without playing them.
 *
 * This is what the market's cards draw, so the picture on a sound card is a
 * transcript of the sound behind the Preview button rather than a decoration
 * that happens to sit near it. Returns `[]` for a pack that does not answer to
 * the event — which is itself the signal a card needs, and is checked by a test
 * so a silent shelf cannot ship.
 */
export function packTones(id, event = 'check') {
  const fn = (PACKS[id] || {})[event] || SHARED[event];
  if (!fn) return [];
  const recording = [];
  capture = recording;
  try { fn(); } finally { capture = null; }
  return recording;
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
