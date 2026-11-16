// Reconnect contract, at the socket level: a phone that drops mid-match must
// come back to the same seat with its points, and its taps must still count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer, stopServer } from './helpers.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.lastState = null;
    ws.joined = null;
    ws.acks = [];
    ws.errors = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'state') ws.lastState = m;
      if (m.t === 'joined') ws.joined = m;
      if (m.t === 'ack') ws.acks.push(m);
      if (m.t === 'error') ws.errors.push(m.msg);
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));

async function until(ws, pred, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred(ws.lastState)) return ws.lastState;
    await wait(40);
  }
  throw new Error(`timeout; phase ${ws.lastState?.phase} game ${ws.lastState?.game?.id}`);
}

test('a dropped phone rejoins its own seat and keeps its points', async (t) => {
  const { port } = await startServer({ MM_COUNTDOWN_MS: '150', MM_RESULT_MS: '150' });
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
  const { code, token, id } = a.joined;
  send(b, { t: 'join', code, name: 'Bravo' });
  await until(a, (s) => s.players.length === 2);

  send(a, { t: 'start' });
  const playing = await until(a, (s) => s.phase === 'play');
  assert.equal(playing.game.id, 'reaction');

  // Tap in time through a real socket, so Alpha has a result to protect.
  const goIn = playing.startsAt + playing.session.config.leadMs - playing.serverNow;
  await wait(Math.max(0, goIn + 80));
  send(a, { t: 'event', gameId: 'reaction', kind: 'tap' });
  await wait(200);
  assert.equal(a.lastState.session.progress, 1, 'Alpha tap accepted');

  // Drop Alpha's socket hard: no close handshake, the way a phone loses signal.
  a.terminate();
  await wait(250);

  // Bravo still sees Alpha in the room with a seat while Alpha is offline.
  assert.ok(
    b.lastState.players.some((p) => p.id === id),
    'Alpha keeps a seat while offline',
  );

  // Rejoin with the saved token: same identity, no duplicate player.
  const a2 = await connect(url);
  t.after(() => a2.close());
  send(a2, { t: 'join', code, name: 'Alpha', token });
  await until(a2, (s) => !!s);
  assert.equal(a2.joined.id, id, 'same player id after reconnect');
  assert.equal(a2.joined.token, token, 'same token after reconnect');
  await wait(200);
  assert.equal(a2.lastState.players.length, 2, 'no duplicate seat');

  // A wrong token must not be able to steal the seat.
  const thief = await connect(url);
  t.after(() => thief.close());
  send(thief, { t: 'join', code, name: 'Alpha', token: 'not-a-real-token' });
  await wait(300);
  assert.match(thief.errors.join(' '), /already in the room|already running/i, 'name/token reuse refused');

  // Finish the match quickly enough to prove Alpha still scores in it.
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const s = a2.lastState;
    if (s.phase === 'result' && s.results) {
      const row = s.results.rows.find((r) => r.id === id);
      assert.ok(row, 'Alpha appears in the result');
      assert.ok(row.points > 0, 'Alpha kept points through the drop');
      break;
    }
    if (s.phase === 'finale') break;
    await wait(80);
  }
  assert.ok(a2.lastState.phase === 'result' || a2.lastState.phase === 'finale', 'match progressed after reconnect');
});
