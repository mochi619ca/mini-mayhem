// Starts the real server on an ephemeral port and reports the port it got.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let child = null;

export function startServer(env = {}) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = proc;
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (d) => {
      out += d.toString();
      const m = out.match(/localhost:(\d+)/);
      if (!m) return;
      clearTimeout(timer);
      resolve({ port: Number(m[1]), proc });
    });
    proc.stderr.on('data', (d) => (out += d.toString()));
    proc.on('exit', (c) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${c}: ${out.slice(-300)}`));
    });
  });
}

export function stopServer() {
  child?.kill('SIGKILL');
  child = null;
}
