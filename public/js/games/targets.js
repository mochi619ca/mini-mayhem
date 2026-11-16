// Target Rush: one target at a time, equally spaced for everyone.
import { h, buzz } from '../dom.js';
import { sGood, sBad } from '../sound.js';

export function render(session, net, api) {
  const { el, body, timer, prog } = api.shell();
  const board = h('div', { class: 'board' });
  const count = h('div', {
    style: { position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', fontWeight: '900', fontSize: '22px', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', zIndex: '3' },
    text: '0',
  });
  board.append(count);
  body.append(board);

  const cfg = session.config;
  const plan = cfg.plan;
  const spawnMs = cfg.spawnMs;
  const lifeMs = cfg.lifeMs;

  const nodes = new Map(); // plan index -> {el, popped}
  let hits = session.mine?.count ?? 0;
  count.textContent = String(hits);

  const relToBoard = (clientX, clientY) => {
    const r = board.getBoundingClientRect();
    return { nx: (clientX - r.left) / r.width, ny: (clientY - r.top) / r.height };
  };

  function spawn(i) {
    const t = plan[i];
    const size = `${t.r * 2 * 100}%`;
    const node = h(
      'div',
      {
        class: 'tgt',
        style: { left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: size, aspectRatio: '1' },
      },
      h('div', { class: 'ring' }),
      h('div', { class: 'fill' }),
    );
    const onHit = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (node.dataset.done) return;
      const { nx, ny } = relToBoard(e.clientX, e.clientY);
      api.send({ kind: 'hit', i, x: nx, y: ny });
      node.dataset.done = '1';
      node.classList.add('gone');
      hits++;
      count.textContent = String(hits);
      const pop = h('div', { class: 'pop', style: { left: `${t.x * 100}%`, top: `${t.y * 100}%` }, text: '+1' });
      board.append(pop);
      setTimeout(() => pop.remove(), 600);
      sGood();
      buzz(10);
      setTimeout(() => {
        node.remove();
        nodes.delete(i);
      }, 90);
    };
    node.addEventListener('pointerdown', onHit);
    board.append(node);
    nodes.set(i, node);
    setTimeout(() => {
      if (node.dataset.done) return;
      node.classList.add('fade');
      setTimeout(() => {
        node.remove();
        nodes.delete(i);
      }, 850);
    }, lifeMs);
  }

  let spawnedUpTo = -1;
  function paint() {
    const now = net.now();
    const elapsed = now - api.startsAt;
    timer.textContent = `${Math.max(0, (api.endsAt - now) / 1000).toFixed(1)}s`;
    prog.style.width = `${Math.min(100, (elapsed / cfg.duration) * 100)}%`;

    while (spawnedUpTo + 1 < plan.length && elapsed >= (spawnedUpTo + 1) * spawnMs) {
      spawnedUpTo++;
      spawn(spawnedUpTo);
    }
    if (elapsed > cfg.duration + 400) {
      clearInterval(iv);
      timer.textContent = '0.0s';
    }
  }

  const iv = setInterval(paint, 32);
  paint();

  return {
    el,
    destroy() {
      clearInterval(iv);
      for (const n of nodes.values()) n.remove();
      nodes.clear();
    },
  };
}
