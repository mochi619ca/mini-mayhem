// Precision Stop: the bar sweeps; tap to stop it near the centre. 3 attempts.
import { h, buzz } from '../dom.js';
import { sGood, sBad, sTick } from '../sound.js';

export function render(session, net, api) {
  const { el, body, timer, prog } = api.shell();
  const cfg = session.config;

  const track = h('div', { class: 'track' });
  // Zones drawn by distance from centre, widest first.
  const widths = [0.36, 0.18, 0.07, 0.035];
  for (const w of widths) {
    track.append(h('div', { class: `zone${w <= 0.035 ? ' perfect' : ''}`, style: { left: `${(0.5 - w) * 100}%`, width: `${w * 2 * 100}%` } }));
  }
  track.append(h('div', { class: 'mid' }));
  const bar = h('div', { class: 'bar', style: { left: '50%' } });
  track.append(bar);

  const bigpts = h('div', { class: 'bigpts', text: '0' });
  const grade = h('div', { class: 'grade' });
  const pips = h('div', { class: 'attempts' }, ...Array.from({ length: cfg.attempts }, () => h('i', { class: 'pip' })));
  const hint = h('div', { class: 'center muted', style: { fontSize: '13px' }, text: 'Tap anywhere when the bar is centred' });

  // Points sit high, the track sits in thumb reach at the bottom.
  const wrap = h('div', { class: 'stopwrap' }, bigpts, grade, h('div', { style: { flex: '1' } }), track, pips, hint);
  body.append(wrap);

  let attempts = session.mine?.attempts ?? 0;
  let total = session.mine?.points ?? 0;
  let busy = false;
  let finished = false;

  function paintPips() {
    [...pips.children].forEach((p, i) => p.classList.toggle('on', i < attempts));
  }

  function paint() {
    const now = net.now();
    timer.textContent = `${Math.max(0, (api.endsAt - now) / 1000).toFixed(1)}s`;
    prog.style.width = `${Math.min(100, ((now - api.startsAt) / (api.endsAt - api.startsAt)) * 100)}%`;
    if (finished) return;
    const period = cfg.period;
    const phase = ((((now - api.startsAt) / period) % 1) + 1) % 1;
    const pos = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    bar.style.left = `${pos * 100}%`;
  }

  function tap(e) {
    if (e.cancelable) e.preventDefault();
    api.unlock();
    if (finished || busy || attempts >= cfg.attempts) return;
    if (net.now() >= api.endsAt) return;
    busy = true;
    api.send({ kind: 'stop' });
    setTimeout(() => (busy = false), 300);
  }

  wrap.addEventListener('pointerdown', tap);
  paintPips();

  let iv = setInterval(paint, 24);
  paint();

  return {
    el,
    onAck(ack) {
      if (ack.kind !== 'stop') return;
      attempts = ack.dists?.length ?? attempts + 1;
      total = ack.pointsList?.reduce((a, b) => a + b, 0) ?? total + ack.points;
      bigpts.textContent = String(total);
      grade.textContent = `${ack.grade} +${ack.points}`;
      grade.style.color = ack.grade === 'PERFECT' ? 'var(--success)' : ack.grade === 'MISS' ? 'var(--error)' : 'var(--warning)';
      paintPips();
      if (ack.grade === 'PERFECT' || ack.grade === 'GREAT') {
        sGood();
        buzz(24);
      } else if (ack.grade === 'MISS') {
        sBad();
        buzz([16, 40, 16]);
      } else {
        sTick();
        buzz(10);
      }
      if (attempts >= cfg.attempts) {
        finished = true;
        grade.textContent = 'All attempts used';
        grade.style.color = 'var(--muted)';
        timer.textContent = 'done';
        hint.textContent = `Final score ${total}`;
      }
    },
    destroy() {
      clearInterval(iv);
      wrap.removeEventListener('pointerdown', tap);
    },
  };
}
