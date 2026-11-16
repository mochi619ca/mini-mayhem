# Deploying Mini Mayhem

The game is a single Node process with in-memory rooms, so "deploy" means: keep
one process alive on a machine that is always on, and put HTTPS in front of it.

## This workspace

`linux.sh` deploys to `aiagent@flash-ms-7b98` (the always-on Linux box) and
publishes it with Tailscale Funnel. That is the live instance:

**https://flash-ms-7b98.tail573a0f.ts.net:8443/**

| Command | Effect |
|---|---|
| `sh deploy/linux.sh status` | active state, PID, restart count, health, funnel |
| `sh deploy/linux.sh update` | `git pull`, `npm install --omit=dev`, restart |
| `sh deploy/linux.sh install` | first-time: clone, install, write and enable the unit, publish the funnel |
| `sh deploy/linux.sh remove` | stop, disable, unpublish |

Environment overrides: `HOST`, `DIR`, `REPO`, `PORT`, `FUNNEL_PORT`.

### Why it does not need a Mac

- `mini-mayhem.service` is a **systemd user unit** with `Restart=always`, so a
  crash is recovered in about two seconds.
- `Linger=yes` is set for that account, so user units start at boot without
  anyone logging in.
- The unit is `enable`d, so a reboot brings the game back by itself.
- Tailscale Funnel terminates TLS on the box; `wss://` works without a cert of
  our own.

Verified on 2026-11-15: process killed → systemd restarted it (new PID, health
`ok`); Mac server and Mac funnel both stopped → the public URL kept answering.

### Ports

Funnel entry is **8443** because 443 on that host already proxies the command
center. Tailscale allows 443, 8443 and 10000 for funnels; 8443 is the free one.

## Any other host

`render.yaml` deploys it as a Render free web service (`npm start`, health check
`/health`). Any Node 18+ host works: expose one port, allow WebSocket upgrade,
done. A free tier that sleeps will make the first visitor of the day wait for a
cold start, which is why the always-on box is the default.
