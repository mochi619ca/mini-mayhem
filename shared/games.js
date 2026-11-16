// Pure, shared by server and browser. Same seed => same board on both sides.
// The server owns timing and scoring; these functions only build the boards.

export function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Reaction Duel ----------
export const REACTION = { minLead: 1400, maxLead: 3200, tapWindow: 3000 };

// ---------- Target Rush ----------
export const TARGETS = { spawnMs: 430, lifeMs: 980, count: 42, duration: 21000 };

export function targetPlan(seed) {
  const rng = mulberry32(hash32(`${seed}:targets`));
  const plan = [];
  for (let i = 0; i < TARGETS.count; i++) {
    plan.push({
      x: +(0.14 + rng() * 0.72).toFixed(4),
      y: +(0.16 + rng() * 0.66).toFixed(4),
      r: +(0.085 + rng() * 0.025).toFixed(4),
    });
  }
  return plan;
}

// ---------- Memory Grid ----------
export const MEMORY = {
  cells: 9,
  startLen: 3,
  rounds: 5,
  preMs: 600,
  flashMs: 340,
  gapMs: 130,
  answerMs: 2800,
  // A beat after answering closes so the hit/miss flash is visible before the
  // next pattern starts; without it a player who just failed sees nothing.
  settleMs: 350,
};

export const memoryPlayMs = (len) => MEMORY.preMs + len * (MEMORY.flashMs + MEMORY.gapMs);
export const memoryRoundMs = (len) => memoryPlayMs(len) + MEMORY.answerMs + MEMORY.settleMs;

export function memoryTimeline(startAt) {
  const rounds = [];
  let t = startAt;
  for (let r = 0; r < MEMORY.rounds; r++) {
    const len = MEMORY.startLen + r;
    const playMs = memoryPlayMs(len);
    rounds.push({
      r,
      len,
      at: t,
      inputFrom: t + playMs,
      inputUntil: t + playMs + MEMORY.answerMs,
      until: t + playMs + MEMORY.answerMs + MEMORY.settleMs,
    });
    t += memoryRoundMs(len);
  }
  return rounds;
}

export function memoryPattern(seed, round) {
  const rng = mulberry32(hash32(`${seed}:mem:${round}`));
  return shuffled(rng, Array.from({ length: MEMORY.cells }, (_, i) => i)).slice(0, MEMORY.startLen + round);
}

// ---------- Precision Stop ----------
export const STOP = { period: 2600, attempts: 3, duration: 13000, minGapMs: 280 };

export const STOP_BANDS = [
  [0.035, 100],
  [0.07, 85],
  [0.12, 70],
  [0.18, 50],
  [0.26, 30],
  [0.36, 15],
];

// Triangle wave 0 → 1 → 0 across one period.
export function stopPos(startAt, at, period = STOP.period) {
  const phase = ((((at - startAt) / period) % 1) + 1) % 1;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

export function stopPoints(dist) {
  for (const [d, p] of STOP_BANDS) if (dist <= d) return p;
  return 5;
}

export const stopGrade = (dist) =>
  dist <= 0.035 ? 'PERFECT' : dist <= 0.07 ? 'GREAT' : dist <= 0.18 ? 'GOOD' : dist <= 0.36 ? 'OFF' : 'MISS';

// ---------- Colour Clash ----------
export const STROOP = { count: 20, duration: 26000 };

export const STROOP_COLORS = [
  { id: 'red', label: 'RED', css: '#ff4d6d' },
  { id: 'blue', label: 'BLUE', css: '#4da3ff' },
  { id: 'green', label: 'GREEN', css: '#2ecc8f' },
  { id: 'yellow', label: 'YELLOW', css: '#ffcf4d' },
];

export function stroopPlan(seed) {
  const rng = mulberry32(hash32(`${seed}:stroop`));
  const items = [];
  for (let i = 0; i < STROOP.count; i++) {
    const ink = randInt(rng, 0, 3);
    const word = rng() < 0.8 ? (ink + 1 + randInt(rng, 0, 2)) % 4 : ink;
    items.push({ word, ink });
  }
  return items;
}

// ---------- Game order ----------
// The server and every phone must agree on the match order, so it lives here.
export const GAME_ORDER = ['reaction', 'targets', 'memory', 'stop', 'stroop'];
