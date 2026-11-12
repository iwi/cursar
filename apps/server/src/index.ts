import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, parseClientMessage } from '@cursar/game-core';
import { type WebSocket, WebSocketServer } from 'ws';
import { type Member, Room } from './room';

// Port: `--port 1234` on the command line, or the PORT environment variable, or 3000.
const portFlag = process.argv.indexOf('--port');
const PORT = Number((portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT) ?? 3000);
const CLIENT_DIR = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

// Serves the built game, so one address gives both the page and the connection.
const http = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  let file = normalize(join(CLIENT_DIR, path === '/' ? 'index.html' : path));
  // Never serve anything outside the built client folder.
  if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) file = join(CLIENT_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Cursar game server is running.\nThe game page has not been built yet: run "npm start", or use "npm run dev" and open the address it prints.\n');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const room = new Room({ addresses: lanAddresses() });
const sockets = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });

sockets.on('connection', (socket: WebSocket) => {
  let member: Member | null = null;
  let alive = true;
  let recent = 0;
  const send = (message: unknown) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  socket.on('message', (data, isBinary) => {
    // A browser sends at most ~60 inputs a second; far more than that is not a browser.
    if (isBinary || ++recent > 400) {
      socket.close(1008, 'Too many messages');
      return;
    }
    const message = parseClientMessage(data.toString());
    if (!message) return;
    if (!member) {
      if (message.t === 'hello') member = room.join(send, message);
      return;
    }
    room.receive(member, message);
  });
  socket.on('pong', () => (alive = true));
  socket.on('error', () => socket.terminate());

  const heartbeat = setInterval(() => {
    recent = 0;
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, 5000);
  const rate = setInterval(() => (recent = 0), 1000);

  socket.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(rate);
    if (member) room.leave(member);
  });
});

// Fixed-rate simulation that catches up if a timer fires late.
const stepMs = 1000 / DEFAULT_CONFIG.tickRate;
let last = performance.now();
let owed = 0;
setInterval(() => {
  const now = performance.now();
  owed = Math.min(owed + now - last, stepMs * 10);
  last = now;
  while (owed >= stepMs) {
    owed -= stepMs;
    room.tick();
  }
}, 4);

http.listen(PORT, () => {
  const built = existsSync(join(CLIENT_DIR, 'index.html'));
  console.log(`\nCursar game server listening on port ${PORT}.`);
  if (built) {
    console.log(`\n  On this computer:   http://localhost:${PORT}`);
    for (const address of lanAddresses()) console.log(`  On your network:    http://${address}:${PORT}`);
    console.log('\nGive the network address to the other players. Press Ctrl+C to stop.\n');
  }
});
