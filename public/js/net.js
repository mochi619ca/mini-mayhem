// WebSocket transport + clock sync. Every timer in the UI is driven by
// `net.now()`, which is the server's clock as best we can estimate it, so all
// phones agree on when a game starts even with very different latencies.

const SAMPLES = 6;

export class Net {
  constructor() {
    this.ws = null;
    this.offset = 0;
    this.rtt = 120;
    this.samples = [];
    this.handlers = new Map();
    this.queue = [];
    this.hasConnected = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload);
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    this.ws = ws;
    ws.onopen = () => {
      // The queue only exists for the very first connection, before the socket
      // is open. After a drop, queued events are stale by definition: they carry
      // no timestamp and would be judged against the wrong moment.
      const pending = this.hasConnected ? [] : this.queue.splice(0);
      this.hasConnected = true;
      for (const msg of pending) this.send(msg);
      this.emit('open');
      this.sync();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') return this.onPong(msg);
      this.emit('msg', msg);
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      this.emit('close');
      // A phone that slept can be back seconds or minutes later; retry until it
      // works rather than giving up after one attempt.
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(), 1200);
    };
    ws.onerror = () => {};
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    // Only the pre-first-connect window may queue: later, a queued event would
    // arrive minutes stale and be scored against the wrong moment.
    else if (!this.hasConnected && this.queue.length < 20) this.queue.push(msg);
  }

  sync() {
    this.samples = [];
    let n = 0;
    const tick = () => {
      if (n++ >= SAMPLES) return;
      this.send({ t: 'ping', c: Date.now() });
      setTimeout(tick, 140);
    };
    tick();
    // Keep a light heartbeat: a phone that slept comes back with a stale clock
    // estimate, and a fresh sample is far cheaper than a wrong timer.
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      this.samples = [];
      this.send({ t: 'ping', c: Date.now() });
    }, 20000);
  }

  onPong(msg) {
    const now = Date.now();
    const rtt = now - msg.c;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 4000) return;
    this.samples.push({ rtt, offset: msg.s - (msg.c + rtt / 2), at: now });
    if (this.samples.length > 12) this.samples.shift();
    // Lowest-RTT sample is the least distorted estimate of the true offset.
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rtt = Math.round(best.rtt);
  }

  now() {
    return Date.now() + this.offset;
  }
}
