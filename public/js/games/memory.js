// Memory Grid: watch the flash sequence, then repeat it. One miss ends the run.
import { h, buzz } from '../dom.js';
import { sGood, sBad, sTap, sTick } from '../sound.js';

export function render(session, net, api) {
  const { el, body, timer, prog } = api.shell();
  const cfg = session.config;
  const status = h('div', { class: 'center', style: { fontWeight: '700', margin: '4px 0 10px', minHeight: '22px' } });
  const grid = h('div', { class: 'grid3' });
  const cells = Array.from({ length: cfg.cells }, (_, i) => {
    const c = h('button', { class: 'cell', 'aria-label': `Square ${i + 1}` });
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tapCell(i);
    });
    grid.append(c);
    return c;
  });
  const dots = h('div', { style: { display: 'flex', gap: '5px', justifyContent: 'center', marginTop: '12px' } });
  body.append(status, grid, dots);

  let round = -1;
  let input = [];
  let accepting = false;
  let cleared = session.mine?.cleared ?? 0;
  let dead = !!session.mine?.out;
  let lastPlayed = -1;
  let answered = false; // this round has been answered correctly
  const flashTimers = [];
  let settled = false;

  function renderDots() {
    dots.replaceChildren(
      ...cfg.rounds.map((_, i) =>
        h('i', {
          style: {
            width: '16px',
            height: '4px',
            borderRadius: '2px',
            background: i < cleared ? 'var(--accent2)' : 'rgba(255,255,255,.13)',
          },
        }),
      ),
    );
  }

  function setStatus(text, color = '') {
    status.textContent = text;
    status.style.color = color;
  }

  function playRound(r) {
    const pattern = cfg.patterns[r];
    const data = cfg.rounds[r];
    input = [];
    answered = false;
    accepting = false;
    setStatus('Watch…', 'var(--muted)');
    // The server's timeline puts the first flash exactly one full play window
    // (flashes + gaps) before the input window opens.
    const firstFlashAt = data.inputFrom - (cfg.flashMs + cfg.gapMs) * pattern.length;
    pattern.forEach((cell, idx) => {
      const onAt = firstFlashAt + idx * (cfg.flashMs + cfg.gapMs);
      flashTimers.push(
        setTimeout(() => {
          cells[cell].classList.add('lit');
          sTap();
          flashTimers.push(setTimeout(() => cells[cell].classList.remove('lit'), cfg.flashMs * 0.75));
        }, Math.max(0, onAt - net.now())),
      );
    });
    flashTimers.push(
      setTimeout(() => {
        if (dead || settled) return;
        accepting = true;
        setStatus(`Your turn — ${pattern.length} squares`);
        sTick();
      }, Math.max(0, data.inputFrom - net.now())),
    );
  }

  function tapCell(i) {
    api.unlock();
    if (!accepting || dead) return;
    const pattern = cfg.patterns[round];
    const idx = input.length;
    input.push(i);
    if (i !== pattern[idx]) {
      accepting = false;
      dead = true;
      cells[i].classList.add('bad');
      setTimeout(() => cells[i].classList.remove('bad'), 500);
      setStatus('Missed — your run ends here', 'var(--error)');
      sBad();
      buzz([30, 50, 30]);
      api.send({ kind: 'answer', round, seq: input });
      // Show the right square so the miss teaches instead of confusing.
      const want = pattern[idx];
      if (want !== undefined) {
        cells[want].classList.add('ok');
        setTimeout(() => cells[want].classList.remove('ok'), 900);
      }
      return;
    }
    cells[i].classList.add('ok');
    setTimeout(() => cells[i].classList.remove('ok'), 160);
    sTap();
    buzz(8);
    if (input.length === pattern.length) {
      accepting = false;
      answered = true;
      cleared = Math.max(cleared, round + 1);
      renderDots();
      setStatus('Correct!', 'var(--success)');
      sGood();
      api.send({ kind: 'answer', round, seq: input });
    }
  }

  function paint() {
    if (settled) return;
    const now = net.now();
    timer.textContent = `${Math.max(0, (api.endsAt - now) / 1000).toFixed(1)}s`;
    const total = api.endsAt - api.startsAt;
    prog.style.width = `${Math.min(100, ((now - api.startsAt) / total) * 100)}%`;

    const r = cfg.rounds.findIndex((x) => now >= x.at && now <= x.inputUntil);
    if (r !== -1 && r !== lastPlayed && !dead) {
      lastPlayed = r;
      round = r;
      playRound(r);
    }
    // If the answer window for the round just played closed unanswered, the run ends.
    if (!dead && !answered && lastPlayed !== -1) {
      const data = cfg.rounds[lastPlayed];
      if (data && now > data.inputUntil + 60) {
        dead = true;
        accepting = false;
        setStatus('Too slow — your run ends here', 'var(--error)');
        sBad();
      }
    }
  }

  const iv = setInterval(paint, 60);
  renderDots();
  paint();

  return {
    el,
    destroy() {
      settled = true;
      clearInterval(iv);
      for (const t of flashTimers) clearTimeout(t);
    },
  };
}
