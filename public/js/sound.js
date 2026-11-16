// Synthesised feedback sounds. No assets, no build step. The AudioContext is
// created on the first real tap, which every phone requires anyway.
let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function tone(freq, ms = 90, { type = 'sine', gain = 0.16, slideTo = null } = {}) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + ms / 1000);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

export const sGood = () => tone(880, 90, { type: 'triangle', gain: 0.14, slideTo: 1320 });
export const sBad = () => tone(200, 200, { type: 'sawtooth', gain: 0.1, slideTo: 90 });
export const sTap = () => tone(660, 45, { type: 'square', gain: 0.06 });
export const sGo = () => tone(520, 260, { type: 'triangle', gain: 0.2, slideTo: 1040 });
export const sTick = () => tone(440, 70, { type: 'square', gain: 0.07 });
export const sWin = () => {
  tone(660, 120, { type: 'triangle', gain: 0.16 });
  setTimeout(() => tone(880, 120, { type: 'triangle', gain: 0.16 }), 110);
  setTimeout(() => tone(1320, 240, { type: 'triangle', gain: 0.16 }), 220);
};
