import { createReadStream, existsSync, statSync } from 'node:fs';
import { type IncomingMessage, createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, MAX_MAP_MESSAGE, parseClientMessage } from '@cursar/game-core';
import { type WebSocket, WebSocketServer } from 'ws';
import { type Seat, Rooms } from './rooms';

// Port: `--port 1234` on the command line, or the PORT environment variable, or 3000.
const portFlag = process.argv.indexOf('--port');
const PORT = Number((portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT) ?? 3000);
/** Most rooms open at once. */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 50);
/**
 * Set TRUST_PROXY=1 when the server sits behind a reverse proxy that handles
 * HTTPS (Caddy, nginx, a hosting platform): visitors' addresses are then read
 * from the X-Forwarded-For header the proxy adds, instead of the proxy's own.
 */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
/** New connections allowed per visitor address per minute, and open at once. */
const CONNECTIONS_PER_MINUTE = 30;
const OPEN_CONNECTIONS_PER_ADDRESS = 12;
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
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path === '/health') {
    // For hosting platforms' health checks.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.count }));
    return;
  }
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
  // Built assets have a content hash in their name, so they can be cached for good; the page itself must not be.
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  createReadStream(file).pipe(res);
});

const rooms = new Rooms({ addresses: lanAddresses(), maxRooms: MAX_ROOMS });
const sockets = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MAP_MESSAGE * 2 });

function visitorAddress(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

// Per visitor address: connections opened this minute, and connections open now.
const recentConnections = new Map<string, number>();
const openConnections = new Map<string, number>();
setInterval(() => recentConnections.clear(), 60_000);

sockets.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  const address = visitorAddress(req);
  const recentCount = (recentConnections.get(address) ?? 0) + 1;
  const openCount = (openConnections.get(address) ?? 0) + 1;
  recentConnections.set(address, recentCount);
  if (recentCount > CONNECTIONS_PER_MINUTE || openCount > OPEN_CONNECTIONS_PER_ADDRESS) {
    socket.close(1008, 'Too many connections');
    return;
  }
  openConnections.set(address, openCount);

  let seat: Seat | null = null;
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
    if (!seat) {
      if (message.t !== 'hello') return;
      seat = rooms.join(send, message, () => socket.close(1000, 'Removed'));
      // One try per connection, so room codes cannot be guessed in a loop.
      if (!seat) socket.close(1000, 'Not joined');
      return;
    }
    seat.room.receive(seat.member, message);
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
    const left = (openConnections.get(address) ?? 1) - 1;
    if (left > 0) openConnections.set(address, left);
    else openConnections.delete(address);
    if (seat) seat.room.leave(seat.member);
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
    rooms.tick();
  }
}, 4);

http.listen(PORT, () => {
  const built = existsSync(join(CLIENT_DIR, 'index.html'));
  console.log(`\nCursar game server listening on port ${PORT}.`);
  if (built) {
    console.log(`\n  On this computer:   http://localhost:${PORT}`);
    for (const address of lanAddresses()) console.log(`  On your network:    http://${address}:${PORT}`);
    console.log('\nCreate a room in the game and give the other players its link or code. Press Ctrl+C to stop.\n');
  }
});
