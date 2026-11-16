#!/bin/sh
# Deploy Mini Mayhem to the always-on Linux box and publish it over Tailscale
# Funnel. Idempotent: safe to re-run after a code change.
#
#   sh deploy/linux.sh status     # what is running and where
#   sh deploy/linux.sh update     # pull, install, restart
#   sh deploy/linux.sh install    # first-time setup (unit + funnel)
#   sh deploy/linux.sh remove     # stop, disable, unpublish
#
# Prereqs: SSH access to $HOST, Node 18+, and `tailscale` with the funnel
# capability on that machine. Port 8443 is the funnel entry because 443 is often
# already claimed by another service on a shared box.
set -eu

HOST=${HOST:-aiagent@flash-ms-7b98}
DIR=${DIR:-/home/aiagent/projdev/mini-mayhem}
REPO=${REPO:-https://github.com/mochi619ca/mini-mayhem.git}
PORT=${PORT:-3000}
FUNNEL_PORT=${FUNNEL_PORT:-8443}
UNIT=mini-mayhem.service

remote() { ssh -o BatchMode=yes "$HOST" "$@"; }

status() {
  remote "systemctl --user is-active $UNIT 2>/dev/null || echo inactive"
  remote "systemctl --user show $UNIT -p MainPID -p NRestarts --value 2>/dev/null | tr '\n' ' '; echo"
  remote "curl -s -m 3 http://127.0.0.1:$PORT/health || echo 'no answer'"
  remote "tailscale funnel status 2>/dev/null | grep -A1 ':$FUNNEL_PORT' || echo 'no funnel on $FUNNEL_PORT'"
}

install() {
  remote "mkdir -p ~/.config/systemd/user ~/projdev"
  remote "test -d $DIR/.git || git clone '$REPO' '$DIR'"
  remote "cd $DIR && git pull --ff-only && npm install --silent --omit=dev"
  remote "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/$UNIT" < deploy/mini-mayhem.service
  remote "systemctl --user daemon-reload && systemctl --user enable --now $UNIT"
  remote "systemctl --user restart $UNIT"
  remote "tailscale funnel --bg --https=$FUNNEL_PORT http://127.0.0.1:$PORT"
  echo
  echo "Live at: https://$(remote 'tailscale status --json | python3 -c \"import sys,json;print(json.load(sys.stdin)[\\\"Self\\\"][\\\"DNSName\\\"].rstrip(\\\".\\\"))\"'):$FUNNEL_PORT/"
}

update() {
  remote "cd $DIR && git pull --ff-only && npm install --silent --omit=dev && systemctl --user restart $UNIT"
  sleep 2
  status
}

remove() {
  remote "systemctl --user disable --now $UNIT 2>/dev/null || true"
  remote "tailscale funnel --https=$FUNNEL_PORT off 2>/dev/null || true"
  echo "stopped and unpublished"
}

case "${1:-status}" in
  install) install ;;
  update) update ;;
  status) status ;;
  remove) remove ;;
  *) echo "usage: $0 [install|update|status|remove]" >&2; exit 2 ;;
esac
