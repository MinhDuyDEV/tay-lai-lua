// Engine sound for bài 1, as an AudioWorklet processor. Plain JS on purpose: no bundler, no
// imports, so the page loads it with one `addModule(url)` call and the same file runs anywhere.
//
// The page creates the AudioContext on a user gesture (browsers require it); this file only
// synthesises. It owns no clock of its own: everything comes from the page's per-frame message.
//
//     await ctx.audioWorklet.addModule('/audio/engine-processor.js');
//     const node = new AudioWorkletNode(ctx, 'engine', {
//       numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
//     });
//     node.connect(ctx.destination);
//
// Message interface — send one object per frame with the fields the snapshot carries
// (`sim_state`, crates/sim-core/src/lib.rs: rpm 8, engine_on 10, cranking 11, clutch 15,
// engine_load_nm 20). Missing fields keep their previous value.
//
//     node.port.postMessage({
//       rpm: 850,       // engine speed, rev/min; 0 when the engine is off
//       load: 42,       // Nm the clutch drags the engine down with; negative = wheels drive it
//       clutch: 0.65,   // pedal travel 0..1; 1 = fully pressed (clutch open)
//       engineOn: true,
//       cranking: false, // the starter is turning
//     });
//
// What it makes audible and why:
// * idle and revs — a harmonic stack at the firing frequency of a 4-cylinder four-stroke,
//   rpm/30 Hz (two firings per revolution: rpm/60 × 2). Its harmonics and the cutoff rise with
//   rpm and load, so the timbre brightens as the learner opens the throttle.
// * lugging — below ~700 rpm with the clutch dragging (positive load) the amplitude is modulated
//   at a wobbling 7–12 Hz and a rumble is mixed in: the "about to stall" judder.
// * starter — while cranking, a slow chug plus a small whine, independent of rpm (the engine is
//   not running yet).
// * stall — when the engine goes off and the starter is not turning, the output is cut with a
//   ~40 ms fade so it stops rather than clicks.
//
// The noise source is a fixed-seed PRNG, so a given message sequence renders the same samples
// every time and the sound can be checked offline (see the handback, not a committed test).

const TAU = Math.PI * 2;
// Idle's firing tone is ~28 Hz, which laptop speakers barely reproduce; the harmonics up to the
// 12th (~340 Hz at idle) are what a small speaker actually plays.
const HARMONICS = 12;
/// Firing frequency is rpm/30 Hz for a 4-cylinder four-stroke.
const FIRING_HZ_PER_RPM = 1 / 30;
/// Below this the engine is being dragged down by the clutch, not revving freely.
const LUG_RPM = 700;
/// Smallest clutch drag worth calling lugging, in Nm.
const LUG_LOAD_NM = 15;
/// Peak output. Leaves headroom for the rest of the mix.
const PEAK = 0.22;

/// mulberry32: small, fast, fixed seed — the same render every run.
function makeNoise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Targets, as last sent by the page.
    this.rpm = 0;
    this.load = 0;
    this.clutch = 1;
    this.engineOn = false;
    this.cranking = false;
    // Smoothed values: the page sends ~60 updates a second, the audio runs at block rate.
    this.rpmSm = 0;
    this.loadSm = 0;
    this.engagementSm = 0;
    this.onSm = 0;
    this.crankSm = 0;
    // Oscillator phases, 0..1.
    this.firePhase = 0;
    this.judderPhase = 0;
    this.wobblePhase = 0;
    this.starterPhase = 0;
    this.whinePhase = 0;
    // One-pole filters, and the output gain envelope.
    this.lp = 0;
    this.rumble = 0;
    this.env = 0;
    this.noise = makeNoise(0x9e3779b9);

    this.port.onmessage = (event) => {
      const d = event.data || {};
      if (typeof d.rpm === 'number') this.rpm = d.rpm;
      if (typeof d.load === 'number') this.load = d.load;
      if (typeof d.clutch === 'number') this.clutch = d.clutch;
      if (d.engineOn !== undefined) this.engineOn = Boolean(d.engineOn);
      if (d.cranking !== undefined) this.cranking = Boolean(d.cranking);
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const n = out[0].length;
    const sr = sampleRate;
    // Block-rate smoothing: ~25 ms for the engine state, ~10 ms for pedals.
    const aSlow = 1 - Math.exp(-n / sr / 0.025);
    const aFast = 1 - Math.exp(-n / sr / 0.010);

    this.rpmSm += (this.rpm - this.rpmSm) * aSlow;
    this.loadSm += (this.load - this.loadSm) * aSlow;
    this.engagementSm += (1 - clamp(this.clutch, 0, 1) - this.engagementSm) * aFast;
    this.onSm += ((this.engineOn ? 1 : 0) - this.onSm) * aSlow;
    this.crankSm += ((this.cranking ? 1 : 0) - this.crankSm) * aSlow;

    const rpm = Math.max(this.rpmSm, 0);
    const firing = rpm * FIRING_HZ_PER_RPM;
    const rev = clamp((rpm - 600) / 4000, 0, 1);
    const drag = Math.max(this.loadSm, 0);
    const loadAmt = clamp(drag / 160, 0, 1); // 160 Nm = clutch_capacity_nm

    // Lugging: low rpm plus a clutch that is dragging the engine down.
    const lugDepth =
      this.onSm *
      clamp((LUG_RPM - rpm) / 400, 0, 1) *
      clamp((drag - LUG_LOAD_NM) / 80, 0, 1) *
      clamp(this.engagementSm, 0, 1);

    // Pitch of the harmonic stack: firings per sample.
    const dFire = (firing / sr) % 1;
    // Judder rate wanders between ~7 and ~12 Hz (a slow 0.9 Hz LFO moves it), so it reads as
    // rough rather than a clean tremolo.
    const dWobble = 0.9 / sr;
    const dStarter = (250 * FIRING_HZ_PER_RPM) / sr; // ~250 rpm of cranking: an ~8 Hz chug
    const dWhine = 210 / sr;

    // Timbre: brighter with load, warmer at idle.
    const tilt = 0.74 + 0.20 * loadAmt;
    let norm = 0;
    for (let h = 1, a = 1; h <= HARMONICS; h++, a *= tilt) norm += a;

    // Output gain envelope: fast cut at stall, soft start when the engine catches.
    const envTau = this.onSm > 0.5 ? 0.03 : 0.04;
    const aEnv = 1 - Math.exp(-1 / sr / envTau);
    const cutoff = 700 + 2600 * rev + 2200 * loadAmt;
    const aLp = 1 - Math.exp((-TAU * cutoff) / sr);
    const aRumble = 1 - Math.exp((-TAU * 90) / sr);

    const ch0 = out[0];
    const ch1 = out.length > 1 ? out[1] : null;

    for (let i = 0; i < n; i++) {
      // ---- engine: harmonic stack at the firing frequency ----
      this.firePhase += dFire;
      if (this.firePhase >= 1) this.firePhase -= 1;

      let engine = 0;
      // Slight odd/even phase offsets keep the stack from looking like a plain sawtooth.
      for (let h = 1, a = 1; h <= HARMONICS; h++, a *= tilt) {
        engine += a * Math.sin(TAU * h * this.firePhase + (h & 1 ? 0.35 : 0));
      }
      engine /= norm;

      // Amplitude: louder as it revs and as the clutch pulls it down.
      const engineAmp = (0.55 + 0.45 * rev) * (0.6 + 0.4 * loadAmt);

      // ---- lugging: wobbling amplitude plus low rumble ----
      this.wobblePhase += dWobble;
      if (this.wobblePhase >= 1) this.wobblePhase -= 1;
      this.judderPhase += (7 + 5 * (0.5 + 0.5 * Math.sin(TAU * this.wobblePhase))) / sr;
      if (this.judderPhase >= 1) this.judderPhase -= 1;
      this.rumble += (this.noise() * 2 - 1 - this.rumble) * aRumble;
      let lug = 0;
      if (lugDepth > 0) {
        const wobble = 0.5 + 0.5 * Math.sin(TAU * this.judderPhase);
        lug = -engine * lugDepth * (0.35 + 0.55 * wobble) + this.rumble * lugDepth * 0.9;
      }

      // ---- starter: chug while cranking, independent of a running engine ----
      this.starterPhase += this.crankSm > 0.01 ? dStarter : 0;
      if (this.starterPhase >= 1) this.starterPhase -= 1;
      this.whinePhase += dWhine;
      if (this.whinePhase >= 1) this.whinePhase -= 1;
      let starter = 0;
      if (this.crankSm > 0.01) {
        const chug = Math.sin(TAU * this.starterPhase);
        const whine = Math.sin(TAU * this.whinePhase);
        starter =
          this.crankSm *
          (0.5 * chug * chug * chug + 0.10 * whine + 0.18 * (this.noise() * 2 - 1));
      }

      // ---- mix, filter, envelope ----
      let s = engine * engineAmp * this.onSm + lug + starter;
      this.lp += (s - this.lp) * aLp;
      s = this.lp;
      this.env = this.env + (Math.max(this.onSm, this.crankSm) - this.env) * aEnv;
      s *= this.env * PEAK;

      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      ch0[i] = s;
      if (ch1) ch1[i] = s;
    }
    return true;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

registerProcessor('engine', EngineProcessor);
