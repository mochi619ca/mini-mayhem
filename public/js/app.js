// App shell: landing → lobby → countdown → game → results → finale.
// One route per server phase; the game screens are separate modules.

import { h, clear, toast, buzz } from './dom.js';
import { Net } from './net.js';
import { unlockAudio, sTick, sWin } from './sound.js';
import { stageShell, countdownOverlay } from './games/shell.js';
import * as GReaction from './games/reaction.js';
import * as GTargets from './games/targets.js';
import * as GMemory from './games/memory.js';
import * as GStop from './games/stop.js';
import * as GStroop from './games/stroop.js';

const SCREENS = { reaction: GReaction, targets: GTargets, memory: GMemory, stop: GStop, stroop: GStroop };

const app = document.getElementById('app');
const net = new Net();

const store = {
  get(key, fallback = '') {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {}
  },
};

let state = null;
let screen = null; // { el, destroy, onAck, gameId }
let mountedKey = '';
let landingSubmit = null;
const pendingCode = codeFromPath();

function codeFromPath() {
  const m = location.pathname.match(/^\/([A-Za-z0-9]{4})$/);
  return m ? m[1].toUpperCase() : '';
}

function pushPath(code) {
  const target = code ? `/${code}` : '/';
  if (location.pathname !== target) history.replaceState(null, '', target);
}

// The token is what survives a phone sleeping: it reattaches to the same seat.
function saveIdentity(code, tok) {
  store.set(`mm.token.${code}`, tok);
}

// ---------- Landing ----------
function renderLanding() {
  const nameInput = h('input', {
    id: 'nm',
    maxlength: '14',
    placeholder: 'Your name',
    value: store.get('mm.name'),
    autocomplete: 'nickname',
    autocapitalize: 'words',
    enterkeyhint: 'go',
  });
  const codeInput = h('input', {
    id: 'cd',
    maxlength: '4',
    placeholder: 'CODE',
    autocomplete: 'off',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: 'false',
    inputmode: 'text',
    'aria-label': 'Room code',
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const remember = () => {
    const n = nameInput.value.trim();
    if (n) store.set('mm.name', n);
    return n;
  };

  const create = () => {
    unlockAudio();
    const n = remember();
    if (!n) return toast('Enter a name first');
    net.send({ t: 'create', name: n });
  };
  const join = () => {
    unlockAudio();
    const n = remember();
    const code = codeInput.value.trim().toUpperCase();
    if (!n) return toast('Enter a name first');
    if (code.length !== 4) return toast('Room codes are 4 characters');
    net.send({ t: 'join', code, name: n, token: store.get(`mm.token.${code}`) || null });
  };

  const el = h(
    'div',
    { class: 'landing' },
    h('div', { class: 'logo' }, 'MINI', h('br'), h('span', { class: 'a' }, 'MAY'), h('span', { class: 'b' }, 'HEM')),
    h('div', { class: 'lede', text: 'Five rapid mini-games. Everyone plays at once. One champion.' }),
    h('div', { class: 'chips' }, ['⚡ Reaction', '🎯 Targets', '🧠 Memory', '🎚️ Precision', '🎨 Colour'].map((t) => h('span', { class: 'chip on', text: t }))),
    h('div', { class: 'panel' },
      h('div', { class: 'field' }, h('label', { for: 'nm', text: 'Nickname' }), nameInput),
      h('button', { class: 'btn primary', onclick: create, text: 'Create a room' }),
      h('div', { class: 'rule', text: 'or join one' }),
      h('div', { class: 'field' }, h('label', { for: 'cd', text: 'Room code' }), codeInput),
      h('button', { class: 'btn', onclick: join, text: 'Join room' }),
    ),
    h('div', { class: 'center muted', style: { fontSize: '12px', marginTop: '14px' }, text: 'Best on two or more phones. Up to 12 players.' }),
  );

  clear(app).append(el);
  if (pendingCode) codeInput.value = pendingCode;
  nameInput.focus();
  landingSubmit = () => (codeInput.value.length === 4 ? join() : create());
}

// Enter submits only while the landing form is the visible screen; leaving the
// form clears the shortcut so Enter cannot fire a stale join later.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && landingSubmit) landingSubmit();
});

// ---------- Lobby ----------
function renderLobby() {
  mountedKey = 'lobby';
  const s = state;
  const url = `${location.origin}/${s.code}`;
  const isHost = s.isHost;

  const players = h('ul', { class: 'list' });
  for (const p of s.players) {
    players.append(
      h(
        'li',
        {},
        h('i', { class: `dot${p.online || p.bot ? '' : ' off'}` }),
        h('span', { class: 'pname', text: p.name }),
        // Bots leave with "− Bot"; a human gets an explicit small remove control.
        isHost && p.id !== s.me && !p.bot
          ? h('button', { class: 'tag', 'aria-label': `Remove ${p.name}`, onclick: () => net.send({ t: 'kick', id: p.id }), text: '×', style: { cursor: 'pointer', fontSize: '14px', padding: '2px 8px' } })
          : null,
        p.id === s.me ? h('span', { class: 'tag me', text: 'you' }) : null,
        p.bot ? h('span', { class: 'tag bot', text: 'bot' }) : null,
        p.isHost ? h('span', { class: 'tag host', text: 'host' }) : null,
      ),
    );
  }

  const games = h(
    'div',
    { class: 'games-list' },
    s.games.map((g) =>
      h('div', { class: 'g' }, h('span', { class: 'ico', text: g.icon }), h('div', {}, h('div', { class: 't', text: g.title }), h('div', { class: 's', text: g.tagline }))),
    ),
  );

  // "+ Bot" is the only way two people can play the five games tonight, so it
  // reads as a real action and disappears once the room is full.
  const canAddBot = s.players.length < 12;
  const humanCount = s.players.filter((p) => !p.bot).length;

  const share = async () => {
    const text = `Join me on Mini Mayhem — code ${s.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Mini Mayhem', text, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast(url);
    }
  };

  const botify = () => net.send({ t: 'addBot' });
  const unbottify = () => net.send({ t: 'removeBot' });
  const botCount = s.players.filter((p) => p.bot).length;

  const el = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', gap: '10px' } },
    h(
      'div',
      { class: 'top' },
      h('div', { class: 'codebox' }, h('div', {}, h('div', { class: 'lbl', text: 'Room' }), h('div', { class: 'code', text: s.code }))),
      h('div', { class: 'row', style: { flex: '0 0 auto' } }, h('button', { class: 'btn small', onclick: share, text: 'Share' })),
    ),
    h(
      'div',
      { class: 'panel', style: { display: 'flex', flexDirection: 'column', minHeight: '0', flex: '1' } },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { class: 'tiny', text: `Players ${s.players.length}/12` })),
      h('div', { class: 'grow scroll' }, players),
      isHost
        ? h(
            'div',
            { class: 'row', style: { marginTop: '10px' } },
            h('button', { class: 'btn', style: { flex: '0 0 auto', padding: '14px 16px' }, onclick: botify, text: '+ Bot', title: 'Add a bot', disabled: !canAddBot }),
            botCount > 0 ? h('button', { class: 'btn ghost', style: { flex: '0 0 auto', padding: '14px 16px' }, onclick: unbottify, text: '− Bot', title: 'Remove a bot' }) : null,
            h('button', {
              class: 'btn primary',
              style: { flex: '1 1 auto' },
              onclick: () => net.send({ t: 'start' }),
              text: s.players.length < 2 ? 'Need 2+ players' : humanCount === 1 && s.players.length > 1 ? 'Start vs bots' : 'Start match',
              disabled: s.players.length < 2,
            }),
          )
        : h('div', { class: 'center muted', style: { padding: '16px 0', fontSize: '14px' }, text: 'Waiting for the host to start…' }),
    ),
    h('div', { class: 'grow scroll' }, h('h3', { class: 'tiny', style: { margin: '4px 0 6px' } , text: 'Five games, in order' }), games),
  );

  clear(app).append(el);
}

// ---------- Countdown ----------
function renderCountdown(game, startsAt) {
  const { el, num } = countdownOverlay(game);
  document.body.append(el);
  let last = null;
  let raf = 0;
  const tick = () => {
    const left = startsAt - net.now();
    const secs = Math.max(1, Math.ceil(left / 1000));
    if (secs !== last) {
      last = secs;
      num.textContent = String(secs);
      num.classList.toggle('hot', secs === 1);
      sTick();
      buzz(10);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    el.remove();
  };
}

// ---------- Play ----------
function mountGame() {
  const s = state;
  const game = s.game;
  const mod = SCREENS[game.id];
  if (!mod) return;
  const key = `play:${s.gameIndex}:${s.game.id}`;
  if (mountedKey === key) return;
  unmountGame();
  mountedKey = key;

  // Live place, so a player can see the race and not just their own number.
  const myPlace = () => {
    const st = state?.standings ?? [];
    const i = st.findIndex((p) => p.id === state.me);
    return i === -1 ? '' : `${i + 1}/${st.length}`;
  };
  const hud = stageShell({ game, startsAt: s.startsAt, hudRight: null });
  const placeTag = hud.el.querySelector('.hud .tag') ?? h('span', { class: 'tag' });
  if (!placeTag.isConnected) hud.el.querySelector('.hud').append(placeTag);
  const refreshPlace = () => { placeTag.textContent = myPlace(); };
  refreshPlace();
  const api = {
    shell: () => hud,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    mine: s.session?.mine ?? {},
    send: (ev) => net.send({ t: 'event', gameId: s.game.id, ...ev }),
    unlock: unlockAudio,
  };
  let inst;
  try {
    inst = mod.render(
      {
        game,
        config: s.session?.config ?? {},
        mine: s.session?.mine ?? {},
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        gameIndex: s.gameIndex,
      },
      net,
      api,
    );
  } catch (e) {
    console.error(`${game.id} screen failed:`, e);
    inst = {
      el: h('div', { class: 'center muted', style: { padding: '40px 16px' } }, `${game.title} could not start on this device.`),
    };
  }
  screen = { ...inst, gameId: s.game.id, refreshPlace };
  // Games draw inside the shared HUD element; a screen that failed to build
  // supplies its own element instead, so the stage is never blank.
  const stage = inst.el ?? hud.el;
  clear(app).append(stage);
  stage.dataset.game = s.game.id;
}

function unmountGame() {
  if (screen?.destroy) screen.destroy();
  screen = null;
}

// ---------- Results ----------
function renderResult() {
  const s = state;
  const res = s.results;
  if (!res) return;
  const game = s.games.find((g) => g.id === res.gameId) ?? s.game;
  const my = res.rows.find((r) => r.id === s.me);
  const won = my?.rank === 1;

  const rows = h('ul', { class: 'ranklist' });
  for (const r of res.rows) {
    rows.append(
      h(
        'li',
        { class: `rankrow${r.id === s.me ? ' me' : ''}${r.rank === 1 ? ' win' : ''}` },
        h('span', { class: 'pos', text: r.rank === 1 ? '🏆' : String(r.rank) }),
        h('span', { class: 'nm' }, r.name, r.bot ? h('span', { class: 'tag bot', style: { marginLeft: '6px' }, text: 'bot' }) : null),
        h('span', { class: 'dt', text: r.detail }),
        h('span', { class: 'pts', text: `+${r.points}` }),
      ),
    );
  }

  const standings = h(
    'div',
    { class: 'standings' },
    s.standings.map((p) =>
      h(
        'div',
        { class: 'standrow' },
        h('span', { class: 'tag', text: `#${p.rank}` }),
        h('span', { class: 'nm', text: p.name }),
        h('span', { class: 'dt', style: { fontSize: '11px', color: 'var(--muted)' }, text: `${p.wins ?? 0}W` }),
        h('span', { class: 'pt', text: `${p.points} pts` }),
      ),
    ),
  );

  const nextGame = s.games[s.gameIndex + 1];
  const progress = h(
    'div',
    { style: { display: 'flex', gap: '6px', justifyContent: 'center', margin: '2px 0 4px' } },
    s.games.map((g, i) =>
      h('i', {
        title: g.title,
        style: {
          width: '26px',
          height: '4px',
          borderRadius: '2px',
          background: i < s.gameIndex + 1 ? 'var(--accent)' : 'rgba(255,255,255,.12)',
        },
      }),
    ),
  );
  const el = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', gap: '10px' } },
    h(
      'div',
      { style: { textAlign: 'center', marginTop: '6px' } },
      progress,
      h('div', { style: { fontSize: '26px' } }, game.icon),
      h('div', { style: { fontWeight: '850', fontSize: '20px' }, text: `${game.title} — result` }),
      h('div', {
        class: 'muted',
        style: { fontSize: '14px', color: won ? 'var(--warning)' : '' },
        text: won ? 'You took this game!' : my ? `You finished #${my.rank} · +${my.points} pts` : 'No result for you',
      }),
    ),
    h('div', { class: 'grow scroll' }, rows),
    h('div', { class: 'panel', style: { padding: '12px' } }, h('div', { class: 'tiny', style: { marginBottom: '6px' } , text: 'Standings' }), standings),
    h(
      'div',
      { class: 'row' },
      s.isHost ? h('button', { class: 'btn ghost', style: { flex: '0 0 auto', padding: '14px' }, onclick: () => net.send({ t: 'skip' }), text: 'Next ▸' }) : null,
      h('div', { class: 'center muted', style: { flex: '1', fontSize: '13px' }, text: nextGame ? `Next: ${nextGame.icon} ${nextGame.title}` : 'Final standings next…' }),
    ),
  );

  clear(app).append(el);
  if (won) sWin();
}

// ---------- Finale ----------
function renderFinale() {
  const s = state;
  const champ = s.standings[0];
  const top = s.standings.slice(0, 3);
  const max = Math.max(1, ...s.standings.map((p) => p.points));
  // A drawn match has more than one player in first place. Say so, and never
  // tell either of them they won it alone.
  const coChampions = s.standings.filter((p) => p.rank === 1);
  const drawn = coChampions.length > 1;
  const iAmChampion = coChampions.some((p) => p.id === s.me);

  const podium = h(
    'div',
    { class: 'podium' },
    [top[1], top[0], top[2]].filter(Boolean).map((p) =>
      h(
        'div',
        { class: `pod${p.rank === 1 ? ' first' : ''}`, style: { paddingTop: `${10 + (p.points / max) * 40}px` } },
        h('div', { class: 'place', text: p.rank === 1 ? '1ST' : p.rank === 2 ? '2ND' : '3RD' }),
        h('div', { class: 'nm', text: p.name }),
        h('div', { class: 'pt', text: String(p.points) }),
      ),
    ),
  );

  const standings = h(
    'div',
    { class: 'standings' },
    s.standings.map((p) =>
      h(
        'div',
        { class: 'standrow' },
        h('span', { class: 'tag', text: p.rank === 1 && drawn ? '=' : `#${p.rank}` }),
        h('span', { class: 'nm', text: p.name }),
        // Equal points but different places: show why, or the table looks broken.
        h('span', { class: 'dt', style: { fontSize: '11px', color: 'var(--muted)' }, text: `${p.wins ?? 0}W` }),
        h('span', { class: 'pt', text: `${p.points} pts` }),
      ),
    ),
  );

  const iWon = iAmChampion && !drawn;
  const el = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', gap: '8px' } },
    h('div', { class: 'trophy', text: iWon ? '🏆' : '🎉' }),
    h('div', { class: 'center tiny', style: { marginTop: '4px' }, text: 'Champion' }),
    h('div', {
      class: 'champ',
      style: { color: iAmChampion ? 'var(--warning)' : '' },
      text: drawn
        ? `${coChampions.map((p) => p.name).join(' & ')} draw`
        : iAmChampion
          ? 'You win!'
          : champ?.name ?? '—',
    }),
    h('div', {
      class: 'center muted',
      style: { fontSize: '13px' },
      text: drawn ? `${champ?.points ?? 0} points each — nobody broke the tie` : `${champ?.points ?? 0} points across five games`,
    }),
    podium,
    h('div', { class: 'grow scroll' }, standings),
    s.isHost
      ? h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => net.send({ t: 'lobby' }), text: 'Lobby' }),
          h('button', { class: 'btn primary', onclick: () => net.send({ t: 'playAgain' }), text: 'Play again' }),
        )
      : h('div', { class: 'center muted', style: { fontSize: '13px', padding: '10px' }, text: 'Waiting for the host…' }),
  );

  clear(app).append(el);
  sWin();
}

// ---------- Route ----------
// A fresh DOM every time a state message arrives would reset scroll position and
// replay the entrance on the static screens. Static screens therefore render
// once per meaningful change; live screens keep their own timers.
let staticKey = '';

function render() {
  const s = state;
  if (!s) return;

  // The room code lives in the path so a phone can share or bookmark the room.
  pushPath(s.code);

  // The countdown overlay is independent of whatever is underneath it.
  if (s.phase === 'countdown' && !document.querySelector('.overlay')) {
    clear(app).append(h('div', { style: { flex: '1' } }));
    cleanupRef = renderCountdown(s.game, s.startsAt);
  }

  switch (s.phase) {
    case 'lobby': {
      const key = `lobby:${s.players.map((p) => `${p.id}${p.name}${p.online}${p.isHost}`).join(',')}:${s.isHost}`;
      if (key === staticKey) break;
      staticKey = key;
      clearOverlay();
      unmountGame();
      mountedKey = '';
      renderLobby();
      break;
    }
    case 'countdown':
      break;
    case 'play':
    case 'settling':
      clearOverlay();
      mountGame();
      screen?.refreshPlace?.();
      // A phone that sleeps through the countdown wakes into a running game
      // with no stage at all; mount again if the element is gone.
      if (!document.querySelector('[data-game]')) {
        mountedKey = '';
        mountGame();
      }
      break;
    case 'result': {
      const key = `result:${s.gameIndex}:${s.game?.id}:${s.standings.map((p) => p.points).join(',')}`;
      if (key === staticKey) break;
      staticKey = key;
      clearOverlay();
      unmountGame();
      mountedKey = '';
      renderResult();
      break;
    }
    case 'finale': {
      const key = `finale:${s.matchNo}:${s.standings.map((p) => `${p.id}${p.points}`).join(',')}`;
      if (key === staticKey) break;
      staticKey = key;
      clearOverlay();
      unmountGame();
      mountedKey = '';
      renderFinale();
      break;
    }
    default:
      break;
  }
}

let cleanupRef = null;
function clearOverlay() {
  if (cleanupRef) {
    cleanupRef();
    cleanupRef = null;
  }
  document.querySelectorAll('.overlay').forEach((n) => n.remove());
}

// ---------- Net wiring ----------
net.on('msg', (msg) => {
  if (msg.t === 'state') {
    const prev = state;
    state = msg;
    if (prev?.phase !== msg.phase) mountedKey = '';
    render();
  }
});

net.on('joined', (msg) => {
  landingSubmit = null;
  saveIdentity(msg.code, msg.token);
  pushPath(msg.code);
});

net.on('ack', (msg) => {
  if (screen?.onAck) screen.onAck(msg);
  else if (msg.kind === 'answer' && msg.correct === false) {}
});

net.on('error', (msg) => toast(msg.msg ?? 'Something went wrong'));

net.on('kicked', () => {
  state = null;
  toast('The host removed you from the room');
  setTimeout(() => location.replace('/'), 1200);
});

net.on('close', () => {
  toast('Reconnecting…', 1500);
});

// A dropped socket loses the room association. Re-join the same seat with the
// saved token as soon as the socket is back, so a phone that slept or lost
// signal lands on the same screen instead of a dead one.
net.on('open', () => {
  if (!state?.code) return;
  const tok = store.get(`mm.token.${state.code}`);
  const name = store.get('mm.name');
  if (tok && name) net.send({ t: 'join', code: state.code, name, token: tok });
  else if (pendingCode) net.send({ t: 'join', code: pendingCode, name, token: null });
});

// ---------- Boot ----------
net.connect();
renderLanding();

// A phone that was in a room and got a link again rejoins its own seat without
// retyping anything. Without a saved token the code is prefilled but not joined,
// because joining needs the player to confirm their name.
const savedToken = pendingCode ? store.get(`mm.token.${pendingCode}`) : '';
const savedName = store.get('mm.name');
if (pendingCode && savedToken && savedName) net.send({ t: 'join', code: pendingCode, name: savedName, token: savedToken });

// Keep long games from scaling the page with a stray double-tap.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
