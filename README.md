# Mini Mayhem

Online party mini-games for phones. Everyone plays the same five games at the
same time on their own screen; points decide one champion.

## Run
```sh
npm install
npm start          # http://localhost:3000
```
Friends open `http://<your-lan-ip>:3000`, or the live link once deployed. One
player creates a room to get a 4-letter code; everyone else joins with the code.
The host can add bots to fill empty seats.

## The five games
| Game | What you do | Scored by |
|---|---|---|
| ⚡ Reaction Duel | Tap the moment the screen turns green | Milliseconds, false start loses |
| 🎯 Target Rush | Tap each target before it fades | Targets hit |
| 🧠 Memory Grid | Repeat the flashing pattern, one longer each round | Rounds cleared |
| 🎚️ Precision Stop | Stop a sweeping bar closest to centre | Distance, 3 attempts |
| 🎨 Colour Clash | Tap the ink colour, not the word | Right +10, wrong −5 |

Finish-order points: with *n* players, 1st gets *n* points and last gets 1.
Exact ties share the averaged points. After all five games the highest total
wins; ties on total points are broken by best single-game finish. A game ends as
soon as every player is provably finished with it (everyone tapped, everyone is
out of attempts, or everyone is solved), so a match does not sit on a clock.

## Screens
What each screen shows and how to capture it: `docs/screens.md`.

## Layout
- `server.js`: HTTP + WebSocket. Holds every room in memory, owns all timing and
  scoring, and sends each phone only its own view.
- `shared/games.js`: pure board generation (target positions, memory patterns,
  colour sequences) plus game lengths. The server imports it directly; the
  browser imports the same file from `/shared/games.js`, so every phone draws an
  identical board and the server re-derives it to validate what a phone claims.
- `lib/games.js`: per-game validation, scoring and bot results.
- `lib/rank.js`: finish-order point awarding with averaged ties.
- `public/`: the client. No build step. `js/net.js` syncs the phone clock to the
  server so all screens start and end a game together.
- `test/`: `rules.test.js` (rules, validation, scoring, rank maths), `client.test.js`
  (module shape and import graph), `protocol.test.js` and `reconnect.test.js`
  (two real sockets playing a full match, and a phone rejoining its seat).
  `npm test` runs all of them.

Rooms live in memory: restarting the server ends every room.

## Fairness, and what it does not defend against
Every phone receives the same board (`plan`, `patterns`, `colors`) so it can draw
it without a round trip, and the server re-derives that board to judge each claim.
A consequence: a scripted client could read the target list and strike every
target instantly, or pre-compute the Colour Clash answers. The server still bounds
what is possible — one hit per target, one answer per prompt, taps inside the
target's own lifetime, three stop attempts — but it cannot hide a board it must
broadcast. Closing that would mean per-player hidden state or per-tap server
timing, which would cost the simultaneous, latency-free feel. For a party game
among friends this is the right trade; it is not a competitive ranking system.

## Hosting
**Live now:** <https://working.tail573a0f.ts.net/> — served from this Mac through
Tailscale Funnel while `npm start` is running. Works on any phone on any network,
HTTPS and `wss://` included. It stops when the Mac sleeps or the server stops.

One-click blueprint deploy (the repo is public and `render.yaml` is read
automatically): <https://render.com/deploy?repo=https://github.com/mochi619ca/mini-mayhem>

That creates a Render free web service (Node runtime, `npm start`, health check
`/health`); open the link once and the URL is live.

Any Node host works: one process, in-memory rooms, a WebSocket upgrade on the
same port. Free tiers sleep when idle, so the first visitor after a quiet spell
waits for a cold start.

For a match on the same Wi-Fi, `npm start` and have everyone open
`http://<your-lan-ip>:3000` — no account, no deploy.

## Mobile notes
- Fixed viewport, no page scrolling during play, `touch-action: manipulation`,
  safe-area insets for notched phones, haptics where supported.
- Input is `pointerdown`, not `click`, so taps register without the 300 ms delay.
- Clock sync uses the lowest-RTT sample of a short ping burst, so a slow phone
  is not given a late start.
