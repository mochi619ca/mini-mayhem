// Colour Clash: tap the ink colour, never the word.
import { h, buzz } from '../dom.js';
import { sGood, sBad } from '../sound.js';

export function render(session, net, api) {
  const { el, body, timer, prog } = api.shell();
  const cfg = session.config;
  const plan = cfg.plan;
  const colors = cfg.colors;

  const score = h('div', { style: { fontWeight: '900', fontSize: '20px', fontVariantNumeric: 'tabular-nums' } , text: '0' });
  const topRow = h(
    'div',
    { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' } },
    h('div', { class: 'tiny', text: 'Score' }),
    score,
  );
  const word = h('div', { class: 'word', text: 'RED' });
  const wordbox = h('div', { class: 'wordbox' }, word);
  const answers = h('div', { class: 'answers' });
  const buttons = colors.map((c, i) => {
    const b = h('button', { class: 'answer', style: { background: c.css, color: '#0d0b17' }, text: c.label });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      answer(i, b);
    });
    answers.append(b);
    return b;
  });
  const wrap = h('div', { class: 'stroop' }, topRow, wordbox, answers);
  body.append(wrap);

  let i = session.mine?.right !== undefined ? (session.mine.right + session.mine.wrong) : 0;
  let right = session.mine?.right ?? 0;
  let wrong = session.mine?.wrong ?? 0;
  let locked = false;
  let finished = false;
  let unlockTimer = null;

  function paintWord() {
    if (i >= plan.length) {
      word.textContent = 'DONE';
      word.style.color = 'var(--muted)';
      word.style.fontSize = '26px';
      finished = true;
      [...buttons].forEach((b) => (b.disabled = true));
      return;
    }
    const item = plan[i];
    word.textContent = colors[item.word].label;
    word.style.color = colors[item.ink].css;
    word.classList.remove('pop2');
    void word.offsetWidth;
    word.classList.add('pop2');
  }

  function answer(choice, btn) {
    if (locked || finished) return;
    api.unlock();
    locked = true;
    api.send({ kind: 'answer', i, choice });
    btn.style.outline = '3px solid #fff';
    setTimeout(() => (btn.style.outline = ''), 140);
    // A send during a reconnect is dropped by design, so an unanswered tap must
    // release the lock on its own; otherwise the screen freezes for the round.
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      locked = false;
    }, 1400);
  }

  function paint() {
    const now = net.now();
    timer.textContent = `${Math.max(0, (api.endsAt - now) / 1000).toFixed(1)}s`;
    prog.style.width = `${Math.min(100, ((now - api.startsAt) / (api.endsAt - api.startsAt)) * 100)}%`;
    if (now >= api.endsAt && !finished) {
      finished = true;
      [...buttons].forEach((b) => (b.disabled = true));
    }
  }

  const iv = setInterval(paint, 100);
  paintWord();
  paint();

  return {
    el,
    onAck(ack) {
      if (ack.kind !== 'answer') return;
      clearTimeout(unlockTimer);
      locked = false;
      if (ack.correct) {
        right++;
        sGood();
        buzz(8);
        score.textContent = String(ack.score);
      } else {
        wrong++;
        sBad();
        buzz([16, 36, 16]);
        score.textContent = String(ack.score);
      }
      i = ack.done;
      if (i >= plan.length) {
        finished = true;
        word.textContent = 'DONE';
        word.style.color = 'var(--muted)';
        word.style.fontSize = '26px';
        [...buttons].forEach((b) => (b.disabled = true));
      } else {
        paintWord();
      }
    },
    destroy() {
      clearInterval(iv);
      clearTimeout(unlockTimer);
    },
  };
}
