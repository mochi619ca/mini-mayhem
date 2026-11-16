// Shared chrome for a game screen: title, countdown, HUD.
import { h } from '../dom.js';

export function stageShell({ game, startsAt, hudRight }) {
  const timer = h('span', { class: 'timer', text: '0.0' });
  const prog = h('i', { style: { width: '0%' } });
  const hud = h(
    'div',
    { class: 'hud' },
    h('span', { class: 'name', text: `${game.icon} ${game.title}` }),
    h('div', { class: 'prog' }, prog),
    timer,
    hudRight ? h('span', { class: 'tag', text: hudRight }) : null,
  );
  const body = h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', minHeight: '0' } });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } }, hud, body);
  return { el, body, timer, prog };
}

export function countdownOverlay(game) {
  const num = h('div', { class: 'count', text: '3' });
  const el = h(
    'div',
    { class: 'overlay' },
    h(
      'div',
      { style: { padding: '0 24px', maxWidth: '520px' } },
      h('div', { style: { fontSize: '46px', textAlign: 'center' } }, game.icon),
      h('div', { class: 'gamename', text: game.title, style: { marginBottom: '6px' } }),
      h('div', { class: 'center muted', style: { marginBottom: '26px', fontSize: '15px' }, text: game.tagline }),
      num,
      h('div', { class: 'howto', style: { marginTop: '26px' } }, game.how.map((line, i) => h('div', {}, h('b', { text: `${i + 1}. ` }), line))),
    ),
  );
  return { el, num };
}
