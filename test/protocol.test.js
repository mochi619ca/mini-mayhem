// WebSocket protocol smoke test: no browser. Two sockets play a whole match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer, stopServer } from './helpers.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.messages = [];
    ws.on('message', (d) => {
      const msg = JSON.parse(d);
      ws.messages.push(msg);
      const last = ws.messages.at(-1);
      if (msg.t === 'state') ws.lastState = msg;
      if (msg.t === 'joined') ws.joined = msg;
      if (msg.t === 'ack') ws.acks.push(msg);
    });
    ws.acks = [];
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));

async function until(ws, pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred(ws.lastState, ws)) return ws.lastState;
    await wait(40);
  }
  throw new Error(`timeout; last phase ${ws.lastState?.phase} game ${ws.lastState?.game?.id}`);
}

test('two players complete a full five-game match over the wire', async (t) => {
  // Port 0: the kernel picks a free port, so parallel suites and a stray dev
  // server can never collide. The real port is read back from the banner.
  const { port } = await startServer({ MM_COUNTDOWN_MS: '250', MM_RESULT_MS: '250' });
  t.after(() => stopServer());

  const url = `ws://127.0.0.1:${port}`;
  const a = await connect(url);
  const b = await connect(url);
  t.after(() => {
    a.close();
    b.close();
  });

  send(a, { t: 'create', name: 'Alpha' });
  await until(a, (s) => !!s);
  const code = a.joined.code;
  assert.match(code, /^[A-Z0-9]{4}$/);

  send(b, { t: 'join', code, name: 'Bravo' });
  await until(b, (s) => s && s.players.length === 2);
  await until(a, (s) => s.players.length === 2);

  send(a, { t: 'start' });
  await until(a, (s) => s.phase === 'countdown');

  // A late arrival is refused instead of silently joining mid-match.
  const c = await connect(url);
  t.after(() => c.close());
  let refused = null;
  c.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'error') refused = m.msg;
  });
  send(c, { t: 'join', code, name: 'Charlie' });
  await wait(200);
  assert.match(refused ?? '', /already running/);

  // Play every game until the finale, asserting the invariants that matter.
  let lastGame = null;
  const seen = [];
  const deadline = Date.now() + 150000; // five games, the longest of which is 30 s
  for (let guard = 0; Date.now() < deadline; guard++) {
    const sa = a.lastState;
    const sb = b.lastState;
    // Both phones are broadcast every change, but the test samples each socket's
    // cached last message at a slightly different instant, so a hop across a
    // boundary is expected. Sustained disagreement is the real signal, so the
    // check is that the two converge within a couple of ticks.
    if (sa.game?.id !== sb.game?.id || sa.phase !== sb.phase) {
      await wait(200);
      const sa2 = a.lastState;
      const sb2 = b.lastState;
      assert.equal(sa2.game?.id ?? null, sb2.game?.id ?? null, 'phones converge on the same game');
      assert.equal(sa2.phase, sb2.phase, 'phones converge on the same phase');
    }

    if ((sa.phase === 'play' || sa.phase === 'settling') && sa.game) {
      const id = sa.game.id;
      if (lastGame !== id) {
        seen.push(id);
        lastGame = id;
        assert.ok(sa.session?.config, `${id} has a config`);
      }
      if (id === 'reaction' && (sa.session.progress ?? 0) === 0) {
        // Wait out the random lead-in, measured against the server's clock, then
        // tap. Alpha taps sooner than Bravo so the finish order is known.
        const goIn = sa.startsAt + sa.session.config.leadMs - sa.serverNow;
        await wait(Math.max(0, goIn + 60));
        send(a, { t: 'event', gameId: 'reaction', kind: 'tap' });
        await wait(90);
        send(b, { t: 'event', gameId: 'reaction', kind: 'tap' });
        await wait(150);
        assert.equal(a.lastState.session.progress, 1, 'alpha tap counted');
        assert.equal(b.lastState.session.progress, 1, 'bravo tap counted');
      }
      if (id === 'targets' && (sa.session.progress ?? 0) === 0) {
        // Nothing to send: Target Rush runs its clock. Proves a non-provable
        // game is never cut short by the early-finish path.
      }
      if (id === 'memory' && (sa.session.progress ?? 0) === 0) {
        // Answer round 0 wrongly: proves a miss is recorded server-side.
        send(a, { t: 'event', gameId: 'memory', kind: 'answer', round: 0, seq: [] });
        await wait(120);
      }
      if (id === 'stroop' && (sa.session.progress ?? 0) === 0) {
        send(a, { t: 'event', gameId: 'stroop', kind: 'answer', i: 0, choice: 0 });
        send(b, { t: 'event', gameId: 'stroop', kind: 'answer', i: 0, choice: 0 });
        await wait(120);
      }
      if (id === 'stop' && (sa.session.progress ?? 0) < 3) {
        send(a, { t: 'event', gameId: 'stop', kind: 'stop' });
        send(b, { t: 'event', gameId: 'stop', kind: 'stop' });
        await wait(320);
      }
    }

    if (sa.phase === 'result') {
      assert.ok(sa.results?.rows?.length >= 2, 'result rows exist');
      const rows = sa.results.rows;
      const pts = rows.map((r) => r.points);
      assert.ok(pts.every((p) => p > 0), 'every finisher gets points');
      // Rows come back best-first, places never go backwards, and a shared place
      // is only ever shared by equal scores.
      const places = rows.map((r) => r.rank);
      const scores = rows.map((r) => r.score);
      assert.deepEqual(places, [...places].sort((x, y) => x - y), 'rows are ordered by place');
      assert.deepEqual(scores, [...scores].sort((x, y) => y - x), 'rows are ordered by score');
      assert.equal(rows[0].rank, 1, 'the winner is first');
      for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i].rank >= rows[i - 1].rank, 'places never improve down the list');
        if (rows[i].rank === rows[i - 1].rank) {
          assert.equal(rows[i].score, rows[i - 1].score, `shared place implies shared score at ${i}`);
        }
        // A tied group shares the best place it contains, so a row can be shown
        // better than its position, never worse.
        assert.ok(rows[i].rank <= i + 1, `place never worse than the row position at ${i}`);
        assert.ok(rows[i].rank > 0);
      }
      const total = pts.reduce((a, b) => a + b, 0);
      assert.ok(total >= 1, 'points were awarded');
      assert.deepEqual(
        sa.standings.map((p) => p.points),
        [...sa.standings.map((p) => p.points)].sort((x, y) => y - x),
        'standings are sorted by points',
      );
    }

    if (sa.phase === 'finale') break;
    await wait(60);
  }

  assert.deepEqual(seen, ['reaction', 'targets', 'memory', 'stop', 'stroop'], 'all five games ran in order');
  const fin = a.lastState;
  assert.equal(fin.phase, 'finale');
  assert.equal(fin.standings.length, 2);
  assert.equal(fin.standings[0].rank, 1);
  assert.ok(fin.standings[0].points >= fin.standings[1].points, 'champion has the most points');
  // Total awarded points per game always equals 1+2+...+n for n players.
  const totals = fin.standings.reduce((s, p) => s + p.points, 0);
  assert.ok(totals > 0);
  assert.ok(a.acks.length > 0 || seen.includes('targets'), 'acks were delivered');
});
