import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The client is ES modules with no build step; a missing export or a syntax
// error would only surface on a real phone. These checks catch the common
// breakages without a browser.
const root = new URL('../public/js/', import.meta.url);

const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

test('every game screen exports render()', async () => {
  for (const id of ['reaction', 'targets', 'memory', 'stop', 'stroop']) {
    const mod = await import(new URL(`${id}.js`, root).href.replace('/public/js/', '/public/js/games/'));
    assert.equal(typeof mod.render, 'function', `${id} render`);
  }
});

test('the app shell imports every game module it routes to', () => {
  const app = read('app.js');
  for (const id of ['reaction', 'targets', 'memory', 'stop', 'stroop']) {
    assert.ok(app.includes(`./games/${id}.js`), `app imports ${id}`);
    assert.ok(new RegExp(`\\b${id}: G`).test(app), `SCREENS maps ${id}`);
  }
});

test('the client never references a server-only module', () => {
  for (const file of ['app.js', 'net.js', 'dom.js', 'sound.js', 'games/shell.js', 'games/reaction.js', 'games/targets.js', 'games/memory.js', 'games/stop.js', 'games/stroop.js']) {
    const src = read(file);
    assert.ok(!src.includes('../lib/'), `${file} does not import lib/`);
    assert.ok(!src.includes('node:'), `${file} does not import node builtins`);
  }
});

test('shared constants expose what the screens use', async () => {
  const shared = await import('../shared/games.js');
  for (const name of ['TARGETS', 'MEMORY', 'STOP', 'STROOP', 'STROOP_COLORS', 'REACTION', 'GAME_ORDER']) {
    assert.ok(shared[name], `shared exports ${name}`);
  }
  assert.deepEqual(shared.GAME_ORDER, ['reaction', 'targets', 'memory', 'stop', 'stroop']);
});

test('a screen can be built against the shape the server actually sends', async () => {
  // Mirrors viewFor(): the fields screens read must exist for every game.
  const { GAMES } = await import('../lib/games.js');
  const shared = await import('../shared/games.js');
  for (const [id, def] of Object.entries(GAMES)) {
    const s = def.newSession({ seed: 'shape', startsAt: 1_000_000 });
    const config = def.config(s);
    const wire = JSON.parse(JSON.stringify({ config, progress: def.progress(s, 'p1') }));
    assert.ok(wire.config && typeof wire.config === 'object', `${id} config survives JSON`);
    assert.equal(wire.progress, 0, `${id} starts at zero progress`);

    if (id === 'targets') assert.equal(wire.config.plan.length, shared.TARGETS.count);
    if (id === 'memory') assert.equal(wire.config.patterns.length, wire.config.rounds.length, 'memory sends one pattern per round');
    if (id === 'stroop') assert.equal(wire.config.plan.length, wire.config.count, 'stroop sends a full plan');
    if (id === 'stop') assert.ok(wire.config.period > 0 && wire.config.attempts === 3);
    if (id === 'reaction') assert.ok(wire.config.leadMs >= REACTION_MIN && wire.config.leadMs <= REACTION_MAX);
  }
});

const REACTION_MIN = 1400;
const REACTION_MAX = 3200;
