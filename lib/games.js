// Server-side rules for the five games: validate what a phone sends, then
// produce one comparable score per player. The room turns scores into points.

import {
  REACTION,
  TARGETS,
  targetPlan,
  MEMORY,
  memoryTimeline,
  memoryPattern,
  STOP,
  stopPos,
  stopPoints,
  stopGrade,
  STROOP,
  stroopPlan,
  STROOP_COLORS,
  randInt,
  clamp,
  hash32,
  mulberry32,
  GAME_ORDER,
} from '../shared/games.js';

const GRACE = 800; // network allowance on the closing edge of a game
// A target can appear exactly when a phone's clock says it should; a tap that
// arrives slightly before that is only network reordering, not foreknowledge.
const PRE_GRACE = 120;
const within = (at, from, until) => at >= from - GRACE && at <= until + GRACE;

export const GAMES = {
  reaction: {
    title: 'Reaction Duel',
    tagline: 'Tap the instant it turns green',
    color: '#2ecc8f',
    icon: '⚡',
    how: ['Thumb ready, screen grey.', 'It turns green at a random moment.', 'Tap the moment you see it. Tap early and you finish last.'],
    newSession({ seed, startsAt }) {
      const rng = mulberry32(hash32(`${seed}:reaction`));
      const lead = randInt(rng, REACTION.minLead, REACTION.maxLead);
      return {
        gameId: 'reaction',
        seed,
        startsAt,
        goAt: startsAt + lead,
        taps: new Map(),
      };
    },
    config(s) {
      return { leadMs: s.goAt - s.startsAt };
    },
    covers(ev, ctx) {
      if (ev.kind !== 'tap') return { ok: false };
      const { session: s, pid, at } = ctx;
      if (s.taps.has(pid)) return { ok: false };
      if (at < s.startsAt || !within(at, s.startsAt, s.goAt + REACTION.tapWindow)) return { ok: false };
      const early = at < s.goAt - 10;
      s.taps.set(pid, { at, early });
      return { ok: true, early, ms: early ? null : Math.round(at - s.goAt) };
    },
    settle(s, pids) {
      const rows = [];
      for (const pid of pids) {
        const tap = s.taps.get(pid);
        if (!tap || tap.early) {
          // A false start ranks below never tapping: it shows you were there and
          // jumped, which is the more deliberate failure.
          rows.push({ id: pid, score: tap ? -2 : -1, detail: tap ? 'False start' : 'No tap', tiebreak: tap ? 1e6 : 1e6 - 1 });
        } else {
          const ms = Math.max(60, Math.round(tap.at - s.goAt));
          rows.push({ id: pid, score: 1000 - ms, detail: `${ms} ms`, tiebreak: ms });
        }
      }
      return rows;
    },
    botResult(skill, rng) {
      const ms = Math.round(clamp(205 + (1 - skill) * 300 + (rng() - 0.5) * 60, 150, 900));
      return { id: null, score: 1000 - ms, detail: `${ms} ms`, tiebreak: ms };
    },
    progress(s, pid) {
      return s.taps.has(pid) ? 1 : 0;
    },
    total: REACTION.maxLead + REACTION.tapWindow,
  },

  targets: {
    title: 'Target Rush',
    tagline: 'Pop every target before it fades',
    color: '#ff4d6d',
    icon: '🎯',
    how: ['A target appears on the board.', 'Tap it before it fades away.', 'One point each. A missed target never comes back.'],
    newSession({ seed, startsAt }) {
      return { gameId: 'targets', seed, startsAt, plan: targetPlan(seed), counts: new Map(), hitKeys: new Set() };
    },
    config(s) {
      return { plan: s.plan, spawnMs: TARGETS.spawnMs, lifeMs: TARGETS.lifeMs, duration: TARGETS.duration };
    },
    covers(ev, ctx) {
      const { session: s, pid, at } = ctx;
      if (ev.kind !== 'hit') return { ok: false };
      const i = ev.i;
      if (!Number.isInteger(i) || i < 0 || i >= s.plan.length) return { ok: false };
      const key = `${pid}:${i}`;
      if (s.hitKeys.has(key)) return { ok: false };
      const elapsed = at - s.startsAt;
      const spawnAt = i * TARGETS.spawnMs;
      if (elapsed < spawnAt - PRE_GRACE || elapsed > spawnAt + TARGETS.lifeMs + GRACE) return { ok: false };
      const t = s.plan[i];
      const dx = Number(ev.x) - t.x;
      const dy = Number(ev.y) - t.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) > t.r + 0.06) return { ok: false };
      s.hitKeys.add(key);
      const n = (s.counts.get(pid) ?? 0) + 1;
      s.counts.set(pid, n);
      return { ok: true, count: n };
    },
    settle(s, pids) {
      return pids.map((pid) => {
        const n = s.counts.get(pid) ?? 0;
        return { id: pid, score: n, detail: `${n} target${n === 1 ? '' : 's'}`, tiebreak: -n };
      });
    },
    botResult(skill, rng) {
      const n = Math.round(clamp(TARGETS.count * (0.45 + skill * 0.5) + (rng() - 0.5) * 4, 1, TARGETS.count));
      return { id: null, score: n, detail: `${n} targets`, tiebreak: -n };
    },
    progress(s, pid) {
      return s.counts.get(pid) ?? 0;
    },
    total: TARGETS.duration,
  },

  memory: {
    title: 'Memory Grid',
    tagline: 'Repeat the pattern, one longer each round',
    color: '#7c5cff',
    icon: '🧠',
    how: ['Watch the squares flash in order.', 'Tap them back in the same order.', 'Each round adds one square. One mistake ends your run.'],
    newSession({ seed, startsAt }) {
      return {
        gameId: 'memory',
        seed,
        startsAt,
        rounds: memoryTimeline(startsAt),
        cleared: new Map(),
        out: new Set(),
        timeUsed: new Map(),
      };
    },
    config(s) {
      return {
        cells: MEMORY.cells,
        flashMs: MEMORY.flashMs,
        gapMs: MEMORY.gapMs,
        rounds: s.rounds.map((r) => ({ r: r.r, len: r.len, at: r.at, inputFrom: r.inputFrom, inputUntil: r.inputUntil })),
        patterns: s.rounds.map((r) => memoryPattern(s.seed, r.r)),
      };
    },
    covers(ev, ctx) {
      const { session: s, pid, at } = ctx;
      if (ev.kind !== 'answer') return { ok: false };
      if (s.out.has(pid)) return { ok: false };
      const round = s.rounds[ev.round];
      if (!round) return { ok: false };
      if (!within(at, round.inputFrom, round.inputUntil)) return { ok: false };
      const pattern = memoryPattern(s.seed, ev.round);
      const seq = Array.isArray(ev.seq) ? ev.seq.slice(0, pattern.length) : [];
      const correct = seq.length === pattern.length && seq.every((v, i) => v === pattern[i]);
      if (!correct) {
        s.out.add(pid);
        return { ok: true, correct: false };
      }
      s.cleared.set(pid, Math.max(s.cleared.get(pid) ?? 0, ev.round + 1));
      s.timeUsed.set(pid, (s.timeUsed.get(pid) ?? 0) + Math.max(0, at - round.inputFrom));
      return { ok: true, correct: true, clear: ev.round + 1 };
    },
    settle(s, pids) {
      return pids.map((pid) => {
        const n = s.cleared.get(pid) ?? 0;
        return { id: pid, score: n, detail: n ? `${n} round${n === 1 ? '' : 's'}` : 'No rounds', tiebreak: s.timeUsed.get(pid) ?? 1e9 };
      });
    },
    botResult(skill, rng) {
      const n = Math.round(clamp(1 + skill * (MEMORY.rounds - 1) + (rng() - 0.5) * 1.4, 0, MEMORY.rounds));
      return { id: null, score: n, detail: `${n} rounds`, tiebreak: 26000 - skill * 9000 };
    },
    progress(s, pid) {
      return s.cleared.get(pid) ?? 0;
    },
    total: memoryTimeline(0).at(-1).until,
  },

  stop: {
    title: 'Precision Stop',
    tagline: 'Stop the bar dead centre',
    color: '#ffcf4d',
    icon: '🎚️',
    how: ['A bar sweeps back and forth.', 'Tap when it is closest to the centre line.', 'Three attempts. Closer scores more.'],
    newSession({ seed, startsAt }) {
      return { gameId: 'stop', seed, startsAt, attempts: new Map(), lastAt: new Map() };
    },
    config() {
      return { period: STOP.period, attempts: STOP.attempts };
    },
    covers(ev, ctx) {
      const { session: s, pid, at } = ctx;
      if (ev.kind !== 'stop') return { ok: false };
      if (!within(at, s.startsAt, s.startsAt + STOP.duration)) return { ok: false };
      const n = s.attempts.get(pid) ?? 0;
      if (n >= STOP.attempts) return { ok: false };
      if (n > 0 && at - (s.lastAt.get(pid) ?? 0) < STOP.minGapMs) return { ok: false };
      const dist = Math.abs(stopPos(s.startsAt, at) - 0.5);
      const pts = stopPoints(dist);
      s.attempts.set(pid, n + 1);
      s.lastAt.set(pid, at);
      if (!s.rows) s.rows = new Map();
      const row = s.rows.get(pid) ?? { pts: 0, best: 1, list: [] };
      row.pts += pts;
      row.best = Math.min(row.best, dist);
      row.list.push({ pts, dist: +dist.toFixed(3), grade: stopGrade(dist) });
      s.rows.set(pid, row);
      return { ok: true, points: pts, grade: stopGrade(dist), dist: +dist.toFixed(4), dists: row.list.map((x) => x.dist), pointsList: row.list.map((x) => x.pts) };
    },
    settle(s, pids) {
      return pids.map((pid) => {
        const row = s.rows?.get(pid);
        return { id: pid, score: row?.pts ?? 0, detail: row ? `${row.pts} pts` : 'No attempts', tiebreak: row?.best ?? 1e9 };
      });
    },
    botResult(skill, rng) {
      let pts = 0;
      let best = 1;
      for (let i = 0; i < STOP.attempts; i++) {
        const dist = clamp((1 - skill) * 0.3 + rng() * 0.18, 0, 0.6);
        pts += stopPoints(dist);
        best = Math.min(best, dist);
      }
      return { id: null, score: pts, detail: `${pts} pts`, tiebreak: best };
    },
    progress(s, pid) {
      return s.attempts.get(pid) ?? 0;
    },
    total: STOP.duration,
  },

  stroop: {
    title: 'Colour Clash',
    tagline: 'Tap the ink colour, not the word',
    color: '#4da3ff',
    icon: '🎨',
    how: ['A colour name appears, painted in a colour.', 'Tap the colour of the ink, never the word.', 'Twenty words. Right +10, wrong −5.'],
    newSession({ seed, startsAt }) {
      return { gameId: 'stroop', seed, startsAt, plan: stroopPlan(seed), at: new Map(), out: new Set() };
    },
    config(s) {
      return { count: STROOP.count, colors: STROOP_COLORS, plan: s.plan };
    },
    covers(ev, ctx) {
      const { session: s, pid, at } = ctx;
      if (ev.kind !== 'answer') return { ok: false };
      if (s.out.has(pid)) return { ok: false };
      const i = s.at.get(pid) ?? 0;
      if (ev.i !== i) return { ok: false };
      if (!within(at, s.startsAt, s.startsAt + STROOP.duration)) return { ok: false };
      if (!Number.isInteger(ev.choice) || ev.choice < 0 || ev.choice > 3) return { ok: false };
      const item = s.plan[i];
      const correct = ev.choice === item.ink;
      if (!s.rows) s.rows = new Map();
      const row = s.rows.get(pid) ?? { right: 0, wrong: 0, score: 0 };
      if (correct) {
        row.right++;
        row.score += 10;
      } else {
        row.wrong++;
        row.score -= 5;
      }
      s.rows.set(pid, row);
      s.at.set(pid, i + 1);
      if (i + 1 >= s.plan.length) s.out.add(pid);
      return { ok: true, correct, score: row.score, right: row.right, wrong: row.wrong, done: i + 1 };
    },
    settle(s, pids) {
      return pids.map((pid) => {
        const row = s.rows?.get(pid);
        if (!row) return { id: pid, score: 0, detail: 'No answers', tiebreak: 0 };
        return { id: pid, score: row.score, detail: `${row.right} right${row.wrong ? `, ${row.wrong} wrong` : ''}`, tiebreak: -row.right };
      });
    },
    botResult(skill, rng) {
      const right = Math.round(clamp(STROOP.count * (0.55 + skill * 0.42) + (rng() - 0.5) * 3, 0, STROOP.count));
      const wrong = STROOP.count - right;
      return { id: null, score: right * 10 - wrong * 5, detail: `${right} right${wrong ? `, ${wrong} wrong` : ''}`, tiebreak: -right };
    },
    progress(s, pid) {
      return s.at.get(pid) ?? 0;
    },
    total: STROOP.duration,
  },
};

export const GAME_IDS = GAME_ORDER.filter((id) => GAMES[id]);

export const gameById = (id) => GAMES[id];

export const gameMeta = (id) => {
  const g = GAMES[id];
  return { id, title: g.title, tagline: g.tagline, color: g.color, icon: g.icon, how: g.how, total: g.total };
};
