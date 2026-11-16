// Reaction Duel: grey until goAt, then green. One tap. Early tap loses.
import { h, buzz } from '../dom.js';
import { sGo, sBad } from '../sound.js';

export function render(session, net, api) {
  const { el, body, timer, prog } = api.shell();
  // The server chose the lead-in; goAt must come from it, never from a local timer.
  const goAt = api.startsAt + (session.config?.leadMs ?? 2000);
  const area = h('div', { class: 'react' }, h('div', { class: 'msg', text: 'Wait for green…' }));
  body.append(area);

  const msg = area.firstChild;
  let state = 'wait';
  let tapped = !!session.mine?.tapped;
  let early = !!session.mine?.early;

  // Rejoining mid-game: show what already happened instead of re-arming.
  if (tapped) {
    area.className = early ? 'react early' : 'react armed';
    msg.innerHTML = early ? 'Too early<div class="sub">You finish last for this game</div>' : 'Tap registered<div class="sub">Waiting for everyone…</div>';
  }

  function paint() {
    const now = net.now();
    timer.textContent = `${Math.max(0, (api.endsAt - now) / 1000).toFixed(1)}s`;
    prog.style.width = `${Math.min(100, ((now - api.startsAt) / (api.endsAt - api.startsAt)) * 100)}%`;

    if (tapped) return;
    if (state === 'wait' && now >= goAt) {
      state = 'armed';
      area.className = 'react armed';
      msg.textContent = 'TAP!';
      sGo();
      buzz(30);
    }
  }

  const tap = (e) => {
    e.preventDefault();
    api.unlock();
    if (tapped) return;
    tapped = true;
    const now = net.now();
    if (state === 'wait') {
      // Send it anyway; the server stamps the true verdict from its own clock.
      api.send({ kind: 'tap', early: true });
      area.className = 'react early';
      msg.innerHTML = 'Too early<div class="sub">You finish last for this game</div>';
      sBad();
      buzz([20, 60, 20]);
      return;
    }
    api.send({ kind: 'tap' });
    const ms = Math.max(0, Math.round(now - goAt));
    area.className = 'react armed';
    msg.innerHTML = `${ms} ms<div class="sub">Waiting for everyone…</div>`;
    timer.textContent = `${ms} ms`;
    buzz(18);
  };

  area.addEventListener('pointerdown', tap);

  const iv = setInterval(paint, 48);
  paint();

  return {
    el,
    destroy() {
      clearInterval(iv);
      area.removeEventListener('pointerdown', tap);
    },
  };
}
