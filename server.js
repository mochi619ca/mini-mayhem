// Mini Mayhem — one Node process serves the page and runs every room.
// Rooms live in memory. The server owns all timing and scoring; phones only
// draw boards from shared/games.js and send the taps they make.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { GAMES, GAME_IDS, gameMeta } from './lib/games.js';
import { finishOrder } from './lib/rank.js';
import { matchStandings } from './lib/standings.js';
import { mulberry32, hash32 } from './shared/games.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 12;
const ROOM_IDLE_MS = 45 * 60 * 1000;
// Countdown and result dwell can be shortened for automated runs; game lengths
// are fixed because both phones and server derive their pacing from them.
const COUNTDOWN_MS = Number(process.env.MM_COUNTDOWN_MS || 3200);
const RESULT_MS = Number(process.env.MM_RESULT_MS || 9000);
const SETTLE_GRACE_MS = 550;

// ---------- HTTP ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(res, file) {
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  // The browser imports the same board-generation module the server validates
  // against, so the two can never disagree about a target or a pattern.
  if (url.pathname === '/shared/games.js') return serveFile(res, path.join(SHARED, 'games.js'));
  const clean = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC, clean);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC, 'index.html');
  }
  serveFile(res, file);
});

// ---------- Helpers ----------
const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));

// ---------- Rooms ----------
const rooms = new Map();

function newRoom() {
  let code;
  do code = newCode();
  while (rooms.has(code));
  const room = {
    code,
    hostId: null,
    players: new Map(),
    phase: 'lobby', // lobby | countdown | play | result | finale
    gameIndex: -1,
    matchNo: 0,
    startsAt: 0,
    endsAt: 0,
    seed: null,
    session: null,
    history: [], // per game: {id, rows, points}
    timers: new Set(),
    advanceTimer: null,
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function later(room, ms, fn) {
  const t = setTimeout(() => {
    room.timers.delete(t);
    if (!rooms.has(room.code)) return;
    try {
      fn();
    } catch (e) {
      console.error(`room ${room.code}:`, e);
    }
  }, ms);
  t.unref?.();
  room.timers.add(t);
  return t;
}

function clearTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers.clear();
  clearTimeout(room.advanceTimer);
  room.advanceTimer = null;
}

const online = (p) => !!p && (p.bot || p.sockets.size > 0);
const humanOnline = (room) => [...room.players.values()].filter((p) => !p.bot && p.sockets.size > 0);
const participants = (room) => [...room.players.values()].filter(online);

function addPlayer(room, name, { bot = false } = {}) {
  const player = {
    id: (bot ? 'bot-' : '') + crypto.randomUUID().slice(0, 8),
    token: bot ? null : crypto.randomUUID(),
    name,
    bot,
    points: 0,
    wins: 0,
    bestFinish: null,
    sockets: new Set(),
    joinedAt: Date.now(),
  };
  room.players.set(player.id, player);
  return player;
}

function ensureHost(room) {
  const host = room.players.get(room.hostId);
  if (online(host)) return;
  const next = humanOnline(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  room.hostId = next ? next.id : null;
}

const BOT_NAMES = ['Byte', 'Nova', 'Pixel', 'Bolt', 'Echo', 'Juno', 'Ziggy', 'Moxie', 'Tango', 'Vex'];
function addBot(room) {
  const used = new Set([...room.players.values()].map((p) => norm(p.name)));
  const name = BOT_NAMES.find((n) => !used.has(norm(n))) || `Bot ${room.players.size}`;
  const bot = addPlayer(room, name, { bot: true });
  // Skill is fixed per match so the same bot is not wildly inconsistent.
  bot.skill = 0.45 + crypto.randomInt(0, 50) / 100;
  bot.brain = crypto.randomInt(1, 1e9);
  return bot;
}

// ---------- Match flow ----------
function startMatch(room) {
  const players = participants(room);
  if (players.length < 2) return 'Need at least 2 players. Add a bot to fill a seat.';
  room.matchNo++;
  room.history = [];
  room.gameIndex = -1;
  room.seed = crypto.randomUUID().slice(0, 8);
  for (const p of room.players.values()) {
    p.points = 0;
    p.wins = 0;
    p.bestFinish = null;
  }
  nextGame(room);
  return null;
}

function nextGame(room) {
  clearTimeout(room.advanceTimer);
  room.advanceTimer = null;
  room.gameIndex++;
  if (room.gameIndex >= GAME_IDS.length) {
    room.phase = 'finale';
    room.session = null;
    broadcast(room);
    return;
  }
  const id = GAME_IDS[room.gameIndex];
  const def = GAMES[id];
  const startsAt = Date.now() + COUNTDOWN_MS;
  room.phase = 'countdown';
  room.ending = false;
  room.startsAt = startsAt;
  room.endsAt = startsAt + def.total;
  room.session = def.newSession({ seed: `${room.seed}:${room.matchNo}:${id}`, startsAt });
  room.gameId = id;
  room.results = null;
  broadcast(room);

  later(room, COUNTDOWN_MS, () => {
    room.phase = 'play';
    broadcast(room);
  });
  later(room, COUNTDOWN_MS + def.total + SETTLE_GRACE_MS, () => settle(room));
}

// Everyone is done with the running game: do not make them sit out the rest of
// the clock. Only games that can prove it (every player tapped, every player out
// of attempts, every pattern solved) call this; the rest simply run to the end.
function maybeSettleEarly(room) {
  if (room.phase !== 'play') return;
  const s = room.session;
  if (!s) return;
  const def = GAMES[s.gameId];
  if (!def.complete) return;
  const humans = [...room.players.values()].filter((p) => !p.bot).map((p) => p.id);
  if (!humans.length || !def.complete(s, humans)) return;
  if (room.ending) return;
  room.ending = true;
  room.phase = 'settling';
  broadcast(room);
  later(room, SETTLE_GRACE_MS, () => settle(room));
}

function settle(room) {
  // A game settles exactly once: either everyone finished early or the clock ran
  // out. Without this guard both timers would award the same points twice.
  if (room.phase !== 'play' && room.phase !== 'settling') return;
  const def = GAMES[room.gameId];
  // Every human in the room is scored, even one whose phone dropped mid-game:
  // their taps already happened, and dropping should not erase points.
  const pids = [...room.players.values()].filter((p) => !p.bot).map((p) => p.id);
  const rows = def.settle(room.session, pids);

  const botRows = [...room.players.values()]
    .filter((p) => p.bot)
    .map((bot) => {
      const rng = mulberry32(hash32(`${room.seed}:${room.matchNo}:${room.gameId}:${bot.id}:${bot.brain}`));
      const res = def.botResult(bot.skill, rng);
      return { id: bot.id, score: res.score, detail: res.detail, tiebreak: res.tiebreak };
    });

  const { sorted: all, placeOf, pointsOf } = finishOrder([...rows, ...botRows]);
  all.forEach((row) => {
    const p = room.players.get(row.id);
    if (!p) return;
    p.points += pointsOf.get(row.id);
    const place = placeOf.get(row.id);
    if (place === 1) p.wins++;
    if (p.bestFinish === null || place < p.bestFinish) p.bestFinish = place;
  });

  room.ending = false;
  room.phase = 'result';
  room.results = {
    gameId: room.gameId,
    rows: all.map((row) => ({
      id: row.id,
      name: room.players.get(row.id)?.name ?? '?',
      score: row.score,
      detail: row.detail,
      rank: placeOf.get(row.id),
      points: pointsOf.get(row.id),
      bot: !!room.players.get(row.id)?.bot,
    })),
  };
  room.history.push({ gameId: room.gameId, results: room.results });
  broadcast(room);
  // One pending advance at a time: a host pressing Next must not be followed by
  // a stale timer advancing a second game.
  clearTimeout(room.advanceTimer);
  room.advanceTimer = later(room, RESULT_MS, () => {
    room.advanceTimer = null;
    if (room.phase !== 'result') return;
    nextGame(room);
  });
}

// ---------- Views ----------
function publicResults(room) {
  if (!room.results) return null;
  return {
    gameId: room.results.gameId,
    rows: room.results.rows.map((r) => ({ id: r.id, name: r.name, score: r.score, detail: r.detail, rank: r.rank, points: r.points, bot: r.bot })),
  };
}

function viewFor(room, me) {
  const players = [...room.players.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ id: p.id, name: p.name, points: p.points, bot: !!p.bot, online: online(p), isHost: p.id === room.hostId }));

  const view = {
    t: 'state',
    code: room.code,
    me,
    hostId: room.hostId,
    isHost: room.hostId === me,
    phase: room.phase,
    matchNo: room.matchNo,
    gameIndex: room.gameIndex,
    game: room.gameId ? gameMeta(room.gameId) : null,
    games: GAME_IDS.map(gameMeta),
    players,
    serverNow: Date.now(),
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    results: room.phase === 'result' ? publicResults(room) : null,
    standings: matchStandings(room.players.values()),
  };

  const s = room.session;
  if (s && ['countdown', 'play', 'settling', 'result'].includes(room.phase)) {
    view.session = {
      gameId: s.gameId,
      config: GAMES[s.gameId].config(s),
      progress: GAMES[s.gameId].progress(s, me),
      // My own in-game feedback, so a phone can show its score live.
      mine: mineFor(room, me, s),
    };
  }
  return view;
}

function mineFor(room, me, s) {
  if (s.gameId === 'stop') {
    const row = s.rows?.get(me);
    return { points: row?.pts ?? 0, attempts: s.attempts.get(me) ?? 0, dists: row?.list.map((x) => x.dist) ?? [] };
  }
  if (s.gameId === 'stroop') {
    const row = s.rows?.get(me);
    return row ? { right: row.right, wrong: row.wrong, score: row.score } : { right: 0, wrong: 0, score: 0 };
  }
  if (s.gameId === 'memory') return { cleared: s.cleared.get(me) ?? 0, out: s.out.has(me) };
  if (s.gameId === 'targets') return { count: s.counts.get(me) ?? 0 };
  if (s.gameId === 'reaction') {
    const tap = s.taps.get(me);
    return tap ? { tapped: true, early: tap.early } : { tapped: false };
  }
  return {};
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players.values()) {
    if (p.bot) continue;
    if (!p.sockets.size) continue;
    const msg = JSON.stringify(viewFor(room, p.id));
    for (const ws of p.sockets) if (ws.readyState === 1) ws.send(msg);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.bucket = { tokens: 40, at: Date.now() };
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    if (!takeToken(ws)) return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    try {
      handle(ws, msg);
    } catch (e) {
      console.error(e);
    }
  });
  ws.on('close', () => drop(ws));
  ws.on('error', () => drop(ws));
});

// Simple token bucket: taps are bursty, so allow a generous ceiling.
function takeToken(ws) {
  const now = Date.now();
  const b = ws.bucket;
  b.tokens = Math.min(40, b.tokens + ((now - b.at) / 1000) * 30);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens--;
  return true;
}

function handle(ws, msg) {
  if (msg.t === 'ping') {
    send(ws, { t: 'pong', c: msg.c, s: Date.now() });
    return;
  }

  if (msg.t === 'create' || msg.t === 'join') {
    const name = clean(msg.name, 14);
    let room;
    if (msg.t === 'create') {
      room = newRoom();
    } else {
      const code = clean(msg.code, 4).toUpperCase();
      room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: "That room doesn't exist. Check the code." });
    }

    let player = msg.token ? [...room.players.values()].find((p) => p.token === msg.token && !p.bot) : null;
    if (!player) {
      if (!name) return send(ws, { t: 'error', msg: 'Enter a name first.' });
      if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'That room is full.' });
      if ([...room.players.values()].some((p) => norm(p.name) === norm(name) && online(p))) {
        return send(ws, { t: 'error', msg: 'That name is already in the room.' });
      }
      if (room.phase !== 'lobby') {
        return send(ws, { t: 'error', msg: 'A match is already running. Wait for it to finish, then join.' });
      }
      player = addPlayer(room, name);
    } else if (name && room.phase === 'lobby') {
      player.name = name;
    }

    if (ws.ctx) detach(ws);
    player.sockets.add(ws);
    ws.ctx = { room, player };
    ensureHost(room);

    send(ws, { t: 'joined', code: room.code, token: player.token, id: player.id });
    return broadcast(room);
  }

  const ctx = ws.ctx;
  if (!ctx) return;
  const { room, player } = ctx;
  const me = player.id;
  const isHost = room.hostId === me;
  const err = (m) => send(ws, { t: 'error', msg: m });

  switch (msg.t) {
    case 'addBot': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.size >= MAX_PLAYERS) return err('Room is full.');
      addBot(room);
      break;
    }
    case 'removeBot': {
      if (!isHost || room.phase !== 'lobby') return;
      // Remove the newest bot: the host pressed the button next to the last one.
      const bots = [...room.players.values()].filter((p) => p.bot);
      const bot = bots.at(-1);
      if (bot) room.players.delete(bot.id);
      break;
    }
    case 'kick': {
      if (!isHost || msg.id === me) return;
      const target = room.players.get(msg.id);
      if (!target) return;
      if (room.phase !== 'lobby') return err('Only in the lobby.');
      for (const s of target.sockets) {
        send(s, { t: 'kicked' });
        s.ctx = null;
      }
      room.players.delete(target.id);
      ensureHost(room);
      break;
    }
    case 'start': {
      if (!isHost || !['lobby', 'finale'].includes(room.phase)) return;
      const e = startMatch(room);
      if (e) return err(e);
      break;
    }
    case 'skip': {
      if (!isHost || room.phase !== 'result') return;
      nextGame(room);
      break;
    }
    case 'lobby': {
      if (!isHost) return;
      clearTimers(room);
      room.phase = 'lobby';
      room.session = null;
      room.results = null;
      room.gameIndex = -1;
      room.gameId = null;
      // no per-player reset needed here
      break;
    }
    case 'playAgain': {
      if (!isHost) return;
      clearTimers(room);
      room.phase = 'lobby';
      room.session = null;
      room.results = null;
      room.gameIndex = -1;
      for (const p of room.players.values()) {
        p.points = 0;
        p.bestFinish = null;
      }
      const e = startMatch(room);
      if (e) return err(e);
      break;
    }
    case 'event': {
      if (room.phase !== 'play' && room.phase !== 'settling') return;
      const s = room.session;
      if (!s) return;
      if (player.bot) return;
      if (msg.gameId !== s.gameId) return;
      const def = GAMES[s.gameId];
      const res = def.covers(msg, { session: s, pid: me, at: Date.now(), room });
      if (!res.ok) return;
      send(ws, { t: 'ack', kind: msg.kind, ...res });
      // The broadcast after the switch covers this event; settling early may
      // also change phase, so it runs first and its own broadcast wins.
      maybeSettleEarly(room);
      break;
    }
    case 'leave': {
      detach(ws, true);
      return;
    }
    default:
      return;
  }
  broadcast(room);
}

function detach(ws, forever = false) {
  const ctx = ws.ctx;
  if (!ctx) return;
  ws.ctx = null;
  const { room, player } = ctx;
  player.sockets.delete(ws);
  if (forever && !online(player)) room.players.delete(player.id);
  ensureHost(room);
  broadcast(room);
}

function drop(ws) {
  const ctx = ws.ctx;
  if (!ctx) return;
  const { room, player } = ctx;
  ws.ctx = null;
  player.sockets.delete(ws);
  // Keep the seat (and its points) for a rejoin; remove only lobby ghosts.
  if (room.phase === 'lobby' && !online(player)) room.players.delete(player.id);
  ensureHost(room);
  broadcast(room);
}

// ---------- Liveness ----------
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [code, room] of rooms) {
    const idle = Date.now() - room.lastActive;
    if (idle > ROOM_IDLE_MS && !humanOnline(room).length) {
      clearTimers(room);
      rooms.delete(code);
    }
  }
}, 30000).unref();

server.listen(PORT, () => console.log(`Mini Mayhem on http://localhost:${server.address().port}`));

export { server, rooms };
