# Name That Jam

A live multiplayer music trivia game. One person hosts on a shared screen (TV, projector, laptop), players scan a QR code with their phones to join — no app install — and questions, answers, and the leaderboard update for everyone in real time. The catalog spans the 1950s through the 2020s across easy, normal, and hard difficulty tiers.

> **Heads up:** this is a vibe-coded side project — built quickly with heavy AI assistance rather than rigorous engineering. It works and is fun at a party, but there's no automated test suite and it hasn't been hardened for production use. Read the code before trusting it with anything that matters.

- [Quick start](#quick-start)
- [Running it](#running-it)
- [Letting phones join](#letting-phones-join)
- [Configuration](#configuration)
- [Updating](#updating)
- [How it works](#how-it-works)
- [Managing the song catalog](#managing-the-song-catalog)
- [Troubleshooting](#troubleshooting)
- [CI/CD](#cicd)

## Quick start

Requires only [Docker](https://docs.docker.com/get-docker/).

```bash
docker run -d --name name-that-jam -p 8080:8080 ghcr.io/ethan-chriswell/music-game:latest
```

Open the address below on the **host's** browser (the computer plugged into the TV or shared screen):

```
http://localhost:8080
```

Click **Host a game**, pick some decades, and create a room. `localhost` only works on the host machine itself — for phones to scan the room's QR code and join, see [Letting phones join](#letting-phones-join).

## Running it

### Docker Compose

The easiest way to keep it running long-term:

```bash
docker compose up -d
```

`docker-compose.yml` ships with both `build: .` and an `image:` pointing at the published image, so the first `up` builds locally from the `Dockerfile`. To use the published image instead of building, either delete the `build: .` line, or run `docker compose pull` before `up` to fetch it under the same tag.

### Plain Docker

```bash
docker run -d --name name-that-jam -p 8080:8080 ghcr.io/ethan-chriswell/music-game:latest
```

Use `-p 3000:8080` (or any host port) to serve the game on a different port — the container always listens on `8080` internally.

### Build the image yourself

```bash
docker build -t name-that-jam .
docker run -d -p 8080:8080 name-that-jam
```

### Without Docker

```bash
npm install
npm start
```

Requires Node.js 20+. `npm run dev` restarts the server on file changes.

## Letting phones join

Phones join by opening the same address shown on the host's screen, so that address has to be reachable from their network:

- **Home network / party**: open the game on the host using the computer's LAN IP, not `localhost` — for example `http://192.168.1.20:8080`. Find it with `ipconfig getifaddr en0` (macOS Wi-Fi) or `ipconfig` (Windows, look for the IPv4 address). The QR code and room-join screen automatically use whatever address the host's browser is on, so no extra configuration is needed.
- **Over the internet**: deploy behind HTTPS with a public hostname (reverse proxy or tunnel) — phones on other networks can't reach a bare LAN IP.
- **Scaling**: run a single container replica. Rooms and scores are held in memory, so a second replica or a restart won't see games created elsewhere.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on inside the container. Prefer remapping with `-p <host>:8080` over changing this — the image's built-in `HEALTHCHECK` always probes port `8080` inside the container. |
| `SONG_DATABASE` | `data/songs.db` | Path to the SQLite catalog to serve. Point this at a mounted volume to run a custom song catalog without rebuilding the image. |

Example running with a custom catalog file:

```bash
docker run -d -p 8080:8080 \
  -v $(pwd)/my-songs.db:/app/data/songs.db:ro \
  ghcr.io/ethan-chriswell/music-game:latest
```

## Updating

```bash
docker compose pull && docker compose up -d
```

or, without Compose:

```bash
docker pull ghcr.io/ethan-chriswell/music-game:latest
docker rm -f name-that-jam
docker run -d --name name-that-jam -p 8080:8080 ghcr.io/ethan-chriswell/music-game:latest
```

Images are also tagged by version (e.g. `v2.0.0`), by branch, and by commit SHA if you'd rather pin a specific build than track `latest`.

## How it works

The Node server uses Socket.IO to keep the host and player phones synchronized. Rooms and scores are held in memory, so restarting the container ends active games. Song clips stream directly from YouTube on the host screen; audio is not proxied or stored.

The fifth value in each catalog entry is its `"easy"`, `"normal"`, or `"hard"` song tier. A game fills its queue from the selected tier first, then falls back to neighboring tiers only when there are not enough songs for the requested decades and round count. Difficulty also sets the round timer to 45, 30, or 20 seconds respectively.

## Managing the song catalog

The song catalog lives in SQLite at `data/songs.db`. To edit it reproducibly, update `data/songs.json` and run `npm run db:build`.

Release-year mode uses only catalog entries with a verified `release_year`. Run `npm run db:enrich-years` to query MusicBrainz for missing first-release years, review the resulting JSON changes, then run `npm run db:build`.

Large curated batches can be staged in `data/song-additions.json` and imported with `npm run db:import-additions`. The importer resolves YouTube IDs, rejects duplicates, checkpoints each track, and is safe to resume.

Difficulty-balanced batches use `data/difficulty-song-additions.json` and can be imported with `npm run db:import-difficulty-additions`. Each decade must contain exactly 10 songs in each difficulty tier, with a unique prevalidated YouTube ID for every track. The importer is idempotent and also accepts another batch path, for example `node scripts/import-difficulty-additions.js data/difficulty-song-additions-2000s-2020s.json`.

## Troubleshooting

- **Phones can't reach the room** — the host is likely open on `localhost`; switch to the [LAN IP](#letting-phones-join) instead, and make sure the host machine's firewall allows inbound connections on port `8080`.
- **Container reports unhealthy** — check `docker logs name-that-jam`. The healthcheck hits `/healthz` on port `8080` inside the container, so it will report unhealthy if `PORT` was changed without also updating the `HEALTHCHECK` in the `Dockerfile`.
- **A song won't play** — clips stream live from YouTube; a blocked, deleted, or region-restricted video will fail to load on the host screen. Swap the entry out of the catalog (see [Managing the song catalog](#managing-the-song-catalog)).
- **Scores or rooms reset unexpectedly** — rooms live in memory only. A container restart, redeploy, or crash clears all active games.

## CI/CD

`.github/workflows/docker-build.yml` builds a multi-arch (amd64/arm64) image on every push to `main`, on version tags (`v*.*.*`), and on pull requests (build-only, not pushed). Pushes to `main` publish `ghcr.io/ethan-chriswell/music-game:latest`.
