# Hosting Cursar for internet play

The game server serves the page and the game connection from one port, so hosting it means running one Node.js process somewhere public and putting HTTPS in front of it. Players then open `https://your-address`, create a room and share its code or link.

## What the server needs

- **One long-running process, exactly one copy.** Rooms live in the server's memory. Two copies would each have their own rooms, and a player could be sent to the wrong one. Turn off autoscaling, and anything that runs more than one instance.
- **WebSockets.** The game connection is a WebSocket at `/ws`. Most hosts support it; "serverless" functions do not, so they will not work.
- **No sleeping when idle.** Some free tiers stop the process after a few idle minutes. The next visitor then waits for it to start again, and any open rooms are lost.
- **HTTPS.** Browsers expect it. The server itself speaks plain HTTP; the host's proxy (or Caddy, below) adds HTTPS in front. Set `TRUST_PROXY=1` so the connection limits see players' real addresses rather than the proxy's.
- **Small.** Each room runs at 60 ticks a second. One small virtual CPU and 256–512 MB of memory is plenty for a handful of rooms.
- **Close to the players.** Your own movement always feels immediate, but rivals, checkpoints and finishes are confirmed by the server, so a host in the same region as the players is best.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. Most platforms set it for you. |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy (any hosting platform, Caddy, nginx). Already on in the `Dockerfile`. |
| `MAX_ROOMS` | `50` | Most rooms open at once. Further "Create a room" attempts are told the server is busy. |

`GET /health` answers `{"ok":true,"rooms":N}`, for the platform's health check.

## Railway (the chosen host)

Railway builds the `Dockerfile` straight from the GitHub repository and gives an HTTPS address. Its settings are in `railway.json`, so they do not need setting by hand:

| In `railway.json` | Why |
|---|---|
| Dockerfile build | The same build as anywhere else. |
| `numReplicas: 1` | Rooms live in one process's memory. |
| `sleepApplication: false` | A sleeping server loses open rooms. |
| `overlapSeconds: 0` | During a deploy the old and new versions would otherwise run side by side for a moment, each with its own rooms. |
| `healthcheckPath: /health` | A new version only goes live once it answers. |
| Restart on failure | A crash restarts the server (open rooms are lost, but new ones work). |
| `watchPatterns` | Changes only to the docs do not redeploy, so they do not close rooms. |

Railway sets `PORT` itself; the server listens on it. `TRUST_PROXY=1` is already set in the `Dockerfile`.

### First time

1. Push `main` to GitHub: Railway deploys what is on GitHub, not what is on your computer.
2. On railway.com, sign in with GitHub and choose **New Project → Deploy from GitHub repo → cursar**. Allow Railway access to that repository when asked. The first build takes a few minutes.
3. Open the service, then **Settings → Networking → Generate Domain**. If it asks for a port, give the one the deploy logs print after "listening on port". This gives an address like `cursar-production.up.railway.app`. A custom domain can be added in the same place later.
4. **Settings → Deploy → Region**: choose the one nearest the players.
5. Check it: `https://<your address>/health` should answer `{"ok":true,"rooms":0}`. Then create a room on one device and join it from another device on a different network, such as a phone on mobile data.

Railway charges by use, and an always-on server needs a paid plan once the trial ends. Check current prices on railway.com. A server this small should sit near the bottom of the Hobby plan.

### Updates on Railway

Every push to `main` that touches the game redeploys it automatically, and that closes every open room. To choose when instead, turn off automatic deploys in the service settings, then deploy by hand from the dashboard when nobody is playing.

## Other container platforms

Fly.io, Render and similar services work the same way: build the `Dockerfile`, run exactly one instance, never sleep, use `/health` for the health check, and pick the region nearest the players.

## Alternative: a small virtual server with Caddy

A small Linux server from any provider, with Caddy in front for automatic HTTPS. You need a domain name pointed at the server.

```bash
# On the server, once: Node.js 22+, git and Caddy installed.
git clone https://github.com/iwi/cursar.git
cd cursar
npm ci
npm run build
TRUST_PROXY=1 PORT=3000 npm run start -w @cursar/server
```

Keep the process running with systemd (or `pm2`), so it restarts after a crash or a reboot. Then `/etc/caddy/Caddyfile`:

```
cursar.example.com {
  reverse_proxy localhost:3000
}
```

Caddy obtains and renews the HTTPS certificate by itself, and passes WebSockets through without extra settings.

## Updating

Deploying a new version restarts the server, which closes every room, so do it when nobody is playing. Pages still open from the old version are told to reload if the message format changed (`PROTOCOL_VERSION`).

## Local network play

Nothing changes for a game on your own network: `npm start` on one computer, then share the room link from the lobby. The lobby gives that computer's network addresses when it is opened as `localhost`.
