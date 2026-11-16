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
wins; ties on total points are broken by best single-game finish.

## Layout
- `server.js`: HTTP + WebSocket. Holds every room in memory, owns all timing and
  scoring, and sends each phone only its own view.
- `shared/games.js`: pure board generation (target positions, memory patterns,
  colour sequences) plus game lengths. Imported by **both** the server and the
  browser, so every phone draws an identical board; the server re-derives the
  same board to validate what a phone claims.
- `lib/games.js`: per-game validation, scoring and bot results.
- `lib/rank.js`: finish-order point awarding with averaged ties.
- `public/`: the client. No build step. `js/net.js` syncs the phone clock to the
  server so all screens start and end a game together.
- `test/rules.test.js`: rules, validation and scoring tests (`npm test`).

Rooms live in memory: restarting the server ends every room.

## Mobile notes
- Fixed viewport, no page scrolling during play, `touch-action: manipulation`,
  safe-area insets for notched phones, haptics where supported.
- Input is `pointerdown`, not `click`, so taps register without the 300 ms delay.
- Clock sync uses the lowest-RTT sample of a short ping burst, so a slow phone
  is not given a late start.
