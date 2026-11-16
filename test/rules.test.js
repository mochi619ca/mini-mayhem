import test from 'node:test';
import assert from 'node:assert/strict';

import {
  targetPlan,
  memoryPattern,
  memoryTimeline,
  stopPos,
  stopPoints,
  stroopPlan,
  TARGETS,
  STOP,
  STROOP,
  MEMORY,
} from '../shared/games.js';
import { GAMES } from '../lib/games.js';
import { finishOrder } from '../lib/rank.js';

test('target plan is deterministic and inside the playable area', () => {
  const a = targetPlan('seed-1');
  const b = targetPlan('seed-1');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, targetPlan('seed-2'));
  assert.equal(a.length, TARGETS.count);
  for (const t of a) {
    assert.ok(t.x - t.r > 0 && t.x + t.r < 1, `x ${t.x} r ${t.r}`);
    assert.ok(t.y - t.r > 0 && t.y + t.r < 1, `y ${t.y} r ${t.r}`);
  }
});

test('memory patterns are fixed length, unique cells, and grow per round', () => {
  for (let r = 0; r < MEMORY.rounds; r++) {
    const p = memoryPattern('s', r);
    assert.equal(p.length, MEMORY.startLen + r);
    assert.equal(new Set(p).size, p.length);
    assert.deepEqual(p, memoryPattern('s', r));
  }
});

test('memory timeline is contiguous and ends before the game ends', () => {
  const tl = memoryTimeline(1000);
  assert.equal(tl.length, MEMORY.rounds);
  for (let i = 1; i < tl.length; i++) assert.equal(tl[i].at, tl[i - 1].until);
  assert.ok(tl.at(-1).until > tl.at(-1).inputUntil);
});

test('stop position sweeps 0..1..0 and centre scores best', () => {
  const start = 0;
  assert.equal(stopPos(start, 0), 0);
  assert.equal(stopPos(start, STOP.period / 2), 1);
  assert.ok(Math.abs(stopPos(start, STOP.period) - 0) < 1e-9);
  assert.ok(stopPoints(0) > stopPoints(0.2));
  assert.ok(stopPoints(0.2) > stopPoints(0.5));
  assert.ok(stopPoints(0.5) >= 5);
});

test('stroop plan is mostly incongruent and deterministic', () => {
  const p = stroopPlan('x');
  assert.equal(p.length, STROOP.count);
  assert.deepEqual(p, stroopPlan('x'));
  const incongruent = p.filter((i) => i.word !== i.ink).length;
  assert.ok(incongruent > p.length * 0.6, `only ${incongruent} incongruent`);
  for (const i of p) {
    assert.ok(i.ink >= 0 && i.ink <= 3 && i.word >= 0 && i.word <= 3);
  }
});

test('rank points: average for exact ties, descending otherwise', () => {
  const rows = [
    { id: 'a', score: 10, tiebreak: 0 },
    { id: 'b', score: 10, tiebreak: 0 },
    { id: 'c', score: 5, tiebreak: 0 },
    { id: 'd', score: 1, tiebreak: 0 },
  ];
  const { placeOf, pointsOf, sorted } = finishOrder(rows);
  assert.deepEqual(sorted.map((r) => r.id).slice(0, 2).sort(), ['a', 'b']);
  assert.equal(pointsOf.get('a'), 3.5);
  assert.equal(pointsOf.get('b'), 3.5);
  assert.equal(pointsOf.get('c'), 2);
  assert.equal(pointsOf.get('d'), 1);
  // Both tied players are shown in the better place they share.
  assert.equal(placeOf.get('a'), 1);
  assert.equal(placeOf.get('b'), 1);
  assert.equal(placeOf.get('c'), 3);
});

test('rank points: a tiebreak separates equal scores without averaging', () => {
  const { pointsOf, placeOf } = finishOrder([
    { id: 'slow', score: 500, tiebreak: 700 },
    { id: 'fast', score: 500, tiebreak: 300 },
    { id: 'low', score: 100, tiebreak: 0 },
  ]);
  assert.equal(placeOf.get('fast'), 1);
  assert.equal(placeOf.get('slow'), 2);
  assert.equal(pointsOf.get('fast'), 3);
  assert.equal(pointsOf.get('slow'), 2);
  assert.equal(pointsOf.get('low'), 1);
});

test('rank points: total awarded per game is fixed for the player count', () => {
  for (const n of [2, 3, 5, 8]) {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, score: i, tiebreak: 0 }));
    const total = [...finishOrder(rows).pointsOf.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, (n * (n + 1)) / 2, `n=${n}`);
  }
});

test('reaction exposes the deadline it enforces, so the client can close with it', () => {
  const def = GAMES.reaction;
  const s = def.newSession({ seed: 'win', startsAt: 1_000_000 });
  const cfg = def.config(s);
  assert.equal(cfg.windowMs, 3000);
  assert.ok(cfg.leadMs >= 1400 && cfg.leadMs <= 3200);
  // A tap inside the last accepted millisecond still counts...
  const last = s.goAt + cfg.windowMs - 1;
  assert.equal(def.covers({ kind: 'tap' }, { session: s, pid: 'p1', at: last, room: {} }).ok, true);
  // ...and one after it does not. This is the boundary the phone must mirror.
  const late = def.newSession({ seed: 'win', startsAt: 1_000_000 });
  assert.equal(def.covers({ kind: 'tap' }, { session: late, pid: 'p1', at: late.goAt + cfg.windowMs + 900, room: {} }).ok, false);
});

test('reaction: a slow but real tap still outranks a false start', () => {
  const def = GAMES.reaction;
  const s = def.newSession({ seed: 'slow', startsAt: 1_000_000 });
  def.covers({ kind: 'tap' }, { session: s, pid: 'slow', at: s.goAt + 1500, room: {} });
  def.covers({ kind: 'tap', early: true }, { session: s, pid: 'jumpy', at: s.goAt - 200, room: {} });
  const rows = def.settle(s, ['slow', 'jumpy', 'absent']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(by.slow.score > by.jumpy.score, 'slow tap beats false start');
  // A false start is the deliberate failure, so it ranks below never tapping.
  assert.ok(by.absent.score > by.jumpy.score, 'no tap beats a false start');
  assert.ok(by.slow.score >= 0, 'a slow tap is never negative');
});

test('reaction scoring ranks a fast tap over a slow one and a false start last', () => {
  const def = GAMES.reaction;
  const startsAt = 1_000_000;
  const s = def.newSession({ seed: 'r1', startsAt });
  const goAt = s.goAt;
  const ctx = (pid, at) => ({ session: s, pid, at, room: {} });

  assert.equal(def.covers({ kind: 'tap', early: true }, ctx('p1', goAt - 500)).ok, true);
  assert.equal(def.covers({ kind: 'tap' }, ctx('p2', goAt + 90)).ok, true);
  assert.equal(def.covers({ kind: 'tap' }, ctx('p3', goAt + 300)).ok, true);
  assert.equal(def.covers({ kind: 'tap' }, ctx('p2', goAt + 400)).ok, false, 'second tap ignored');

  const rows = def.settle(s, ['p1', 'p2', 'p3', 'p4']).sort((a, b) => b.score - a.score);
  assert.deepEqual(rows.map((r) => r.id), ['p2', 'p3', 'p4', 'p1']);
  assert.equal(rows[2].detail, 'No tap');
  assert.equal(rows[3].detail, 'False start', 'false start ranks below no tap');
});

test('targets reject off-target and out-of-window taps', () => {
  const def = GAMES.targets;
  const startsAt = 5_000_000;
  const s = def.newSession({ seed: 't1', startsAt });
  const t = s.plan[0];
  const ctx = (at) => ({ session: s, pid: 'p1', at, room: {} });

  // Before it spawns: no foreknowledge allowed.
  assert.equal(def.covers({ kind: 'hit', i: 0, x: t.x, y: t.y }, ctx(startsAt - 300)).ok, false, 'pre-spawn tap rejected');
  // After it fades, beyond the network grace window.
  assert.equal(def.covers({ kind: 'hit', i: 0, x: t.x, y: t.y }, ctx(startsAt + TARGETS.lifeMs + 1400)).ok, false, 'post-fade rejected');
  // Wrong coordinate.
  assert.equal(def.covers({ kind: 'hit', i: 0, x: 0.99, y: 0.99 }, ctx(startsAt + 100)).ok, false, 'off-target rejected');
  // Out-of-range index.
  assert.equal(def.covers({ kind: 'hit', i: 9999, x: t.x, y: t.y }, ctx(startsAt + 100)).ok, false);
  // Real hit, then the same one again.
  assert.equal(def.covers({ kind: 'hit', i: 0, x: t.x, y: t.y }, ctx(startsAt + 100)).ok, true);
  assert.equal(def.covers({ kind: 'hit', i: 0, x: t.x, y: t.y }, ctx(startsAt + 120)).ok, false, 'duplicate rejected');
  assert.equal(def.settle(s, ['p1'])[0].score, 1);

  // A tap that arrives a hair early because of network reordering still counts.
  const s2 = def.newSession({ seed: 't1', startsAt });
  const r = def.covers({ kind: 'hit', i: 0, x: t.x, y: t.y }, { session: s2, pid: 'p2', at: startsAt - 50, room: {} });
  assert.equal(r.ok, true, 'jitter tolerance');
});

test('memory: correct sequence advances, one wrong answer ends the run', () => {
  const def = GAMES.memory;
  const startsAt = 9_000_000;
  const s = def.newSession({ seed: 'm1', startsAt });
  const r0 = s.rounds[0];
  const good = memoryPattern('m1', 0);
  const at = r0.inputFrom + 500;
  const ctx = (ev) => ({ session: s, pid: 'p1', at, room: {} });

  assert.equal(def.covers({ kind: 'answer', round: 0, seq: [9, 9, 9] }, ctx()).correct, false);
  assert.equal(s.out.has('p1'), true);
  // A second answer after failing is ignored.
  assert.equal(def.covers({ kind: 'answer', round: 1, seq: memoryPattern('m1', 1) }, ctx()).ok, false);
  assert.equal(def.settle(s, ['p1'])[0].score, 0);

  const s2 = def.newSession({ seed: 'm1', startsAt });
  const at2 = (r) => ({ session: s2, pid: 'p2', at: s2.rounds[r].inputFrom + 300, room: {} });
  // Skipping ahead must not count: only the round actually reached is accepted.
  assert.equal(def.covers({ kind: 'answer', round: 3, seq: memoryPattern('m1', 3) }, at2(3)).ok, false, 'round skipped');
  assert.equal(def.covers({ kind: 'answer', round: 0, seq: good }, at2(0)).correct, true);
  assert.equal(def.covers({ kind: 'answer', round: 1, seq: memoryPattern('m1', 1) }, at2(1)).correct, true);
  assert.equal(def.settle(s2, ['p2'])[0].score, 2);
});

test('stop: three attempts max, graded by distance from centre', () => {
  const def = GAMES.stop;
  const startsAt = 2_000_000;
  const s = def.newSession({ seed: 's1', startsAt });
  // The marker crosses the centre line a quarter of the way through each period.
  const centre = startsAt + STOP.period / 4;
  const r1 = def.covers({ kind: 'stop' }, { session: s, pid: 'p1', at: centre, room: {} });
  assert.equal(r1.ok, true);
  assert.equal(r1.points, 100);
  // Too soon after the first tap.
  assert.equal(def.covers({ kind: 'stop' }, { session: s, pid: 'p1', at: centre + 50, room: {} }).ok, false);
  // Next crossings: 3/4 period (centre again) and 5/4 (centre again).
  def.covers({ kind: 'stop' }, { session: s, pid: 'p1', at: centre + STOP.period / 2, room: {} });
  def.covers({ kind: 'stop' }, { session: s, pid: 'p1', at: centre + STOP.period, room: {} });
  assert.equal(def.covers({ kind: 'stop' }, { session: s, pid: 'p1', at: centre + 1.5 * STOP.period, room: {} }).ok, false, 'fourth attempt rejected');
  const row = def.settle(s, ['p1'])[0];
  assert.ok(row.score >= 100, `score ${row.score}`);
});

test('stroop: answers must arrive in order and score +10/-5', () => {
  const def = GAMES.stroop;
  const startsAt = 3_000_000;
  const s = def.newSession({ seed: 'c1', startsAt });
  const ctx = (ev, at = startsAt + 100) => ({ session: s, pid: 'p1', at, room: {} });
  const ink = s.plan[0].ink;
  const wrong = (s.plan[1].ink + 1) % 4;

  assert.equal(def.covers({ kind: 'answer', i: 1, choice: 0 }, ctx()).ok, false, 'out of order');
  assert.equal(def.covers({ kind: 'answer', i: 0, choice: ink }, ctx()).correct, true);
  const repeat = def.covers({ kind: 'answer', i: 0, choice: ink }, ctx());
  assert.equal(repeat.stale, true, 'a repeat answers with the true progress instead of silence');
  assert.equal(s.at.get('p1'), 1, 'a repeat does not double-score');
  assert.equal(def.covers({ kind: 'answer', i: 1, choice: wrong }, ctx()).correct, false);
  const row = def.settle(s, ['p1'])[0];
  assert.equal(row.score, 5);
  assert.match(row.detail, /1 right, 1 wrong/);
});

test('bot results stay inside each game’s legal range', () => {
  let n = 0;
  const rng = () => {
    n = (n * 1664525 + 1013904223) % 4294967296;
    return n / 4294967296;
  };
  for (const [id, def] of Object.entries(GAMES)) {
    for (const skill of [0, 0.5, 1]) {
      const r = def.botResult(skill, rng);
      assert.ok(Number.isFinite(r.score), `${id} score`);
      assert.ok(typeof r.detail === 'string' && r.detail.length, `${id} detail`);
      assert.ok(Number.isFinite(r.tiebreak), `${id} tiebreak`);
      if (id === 'targets') assert.ok(r.score >= 0 && r.score <= TARGETS.count);
      if (id === 'memory') assert.ok(r.score >= 0 && r.score <= MEMORY.rounds);
      if (id === 'stroop') assert.ok(r.score >= -100 && r.score <= STROOP.count * 10);
      if (id === 'reaction') assert.ok(r.score > 0);
      if (id === 'stop') assert.ok(r.score > 0);
    }
  }
});

test('early finish fires only when every player is provably done', () => {
  // Games that can prove completion must not fire on a partial set.
  for (const id of ['reaction', 'memory', 'stop', 'stroop']) {
    const def = GAMES[id];
    assert.equal(typeof def.complete, 'function', `${id} exposes complete`);
    const s = def.newSession({ seed: 'done', startsAt: 1_000_000 });
    assert.equal(def.complete(s, []), false, `${id} empty player list is not complete`);
    assert.equal(def.complete(s, ['a', 'b']), false, `${id} fresh session is not complete`);
  }
  // Target Rush has no provable end, so it intentionally has no predicate and
  // always runs its full clock.
  assert.equal(GAMES.targets.complete, undefined);
});

test('every game exposes a config the client can draw from', () => {
  for (const [id, def] of Object.entries(GAMES)) {
    const s = def.newSession({ seed: 'cfg', startsAt: 1_000_000 });
    const cfg = def.config(s);
    assert.ok(cfg && typeof cfg === 'object', `${id} config`);
    JSON.stringify(cfg); // must be serialisable: it goes over the wire
    assert.ok(def.total > 0, `${id} total`);
    assert.ok(Array.isArray(def.how) && def.how.length >= 2, `${id} how`);
  }
});

test('stroop heals a lost ack: a duplicate answer reports the true progress', () => {
  const def = GAMES.stroop;
  const s = def.newSession({ seed: 'heal', startsAt: 1_000_000 });
  const ctx = (ev) => ({ session: s, pid: 'p1', at: 1_000_100, room: {} });
  const ink = s.plan[0].ink;

  const first = def.covers({ kind: 'answer', i: 0, choice: ink }, ctx());
  assert.equal(first.correct, true);
  // The phone never saw that ack and retries the same question.
  const retry = def.covers({ kind: 'answer', i: 0, choice: ink }, ctx());
  assert.equal(retry.ok, true, 'retry answers with a healing payload');
  assert.equal(retry.stale, true);
  assert.equal(retry.done, 1, 'points at the next question');
  assert.equal(retry.score, 10, 'carries the real score');
  assert.equal(s.at.get('p1'), 1, 'no double advance');
  // A forward skip is still rejected: healing must not become a shortcut.
  assert.equal(def.covers({ kind: 'answer', i: 5, choice: 0 }, ctx()).ok, false);
});

// The finale rule lives in server.js; exercise it through the same comparison
// the server uses so a two-way tie cannot be reported as a win for both.
test('match standings: points, then wins, then best finish, then join order', async () => {
  const { comparePlayers } = await import('../lib/standings.js');
  const mk = (id, points, wins, bestFinish, joinedAt = 0) => ({ id, points, wins, bestFinish, joinedAt });
  const sorted = [
    mk('fewerWins', 20, 1, 1),
    mk('moreWins', 20, 3, 2),
    mk('bestFinish', 20, 1, 1),
    mk('lower', 10, 5, 1),
  ].sort(comparePlayers).map((p) => p.id);
  assert.equal(sorted[0], 'moreWins', 'wins break a points tie first');
  // Two players equal on points, wins and best finish are separated only by join
  // order, which is arbitrary: the standings mark them as sharing a place.
  assert.deepEqual(sorted.slice(1, 3).sort(), ['bestFinish', 'fewerWins']);
  assert.equal(sorted[3], 'lower');
});

test('match standings: a drawn match shares first place and says so', async () => {
  const { matchStandings } = await import('../lib/standings.js');
  const players = [
    { id: 'a', name: 'A', points: 7.5, wins: 1, bestFinish: 1, joinedAt: 1, bot: false },
    { id: 'b', name: 'B', points: 7.5, wins: 1, bestFinish: 1, joinedAt: 2, bot: false },
    { id: 'c', name: 'C', points: 3, wins: 0, bestFinish: 2, joinedAt: 3, bot: false },
  ];
  const table = matchStandings(players);
  assert.deepEqual(table.map((p) => p.rank), [1, 1, 3]);
  assert.equal(table[0].shared, true);
  assert.equal(table[1].shared, true);
  assert.equal(table[2].shared, false);
  // A clear winner is not marked shared.
  const clear = matchStandings([{ ...players[0], points: 9 }, players[1], players[2]]);
  assert.deepEqual(clear.map((p) => p.rank), [1, 2, 3]);
  assert.equal(clear[0].shared, false);
});
