# Decade Dial

A live multiplayer music trivia game. One person hosts on a shared screen, players scan the room QR code with their phones, and answers and scores update in real time.

## Run with Docker

Pull the published image (built automatically by GitHub Actions on every push to `main`):

```bash
docker run -d --name decade-dial -p 8080:8080 ghcr.io/ethan-chriswell/music-game:latest
```

Then open http://localhost:8080

## Run with Docker Compose

```bash
docker compose up -d
```

This builds the image locally from the `Dockerfile`. To use the published image instead, edit `docker-compose.yml` and drop the `build: .` line.

## Build locally

```bash
docker build -t decade-dial .
docker run -d -p 8080:8080 decade-dial
```

## Run without Docker

```bash
npm install
npm start
```

## How it works

The Node server uses Socket.IO to keep the host and player phones synchronized. Rooms and scores are held in memory, so restarting the container ends active games. Song clips stream directly from YouTube on the host screen; audio is not proxied or stored.

The song catalog lives in SQLite at `data/songs.db`. To edit it reproducibly, update `data/songs.json` and run `npm run db:build`. Set `SONG_DATABASE` to use a different database file at runtime.

Release-year mode uses only catalog entries with a verified `release_year`. Run `npm run db:enrich-years` to query MusicBrainz for missing first-release years, review the resulting JSON changes, then run `npm run db:build`.

The fifth value in each catalog entry is its `"easy"`, `"normal"`, or `"hard"` song tier. A game fills its queue from the selected tier first, then falls back to neighboring tiers only when there are not enough songs for the requested decades and round count. Legacy `"popular"` and `"deep"` values are still accepted by the database builder and map to Easy and Hard. Difficulty also sets the round timer to 45, 30, or 20 seconds respectively.

Large curated batches can be staged in `data/song-additions.json` and imported with `npm run db:import-additions`. The importer resolves YouTube IDs, rejects duplicates, checkpoints each track, and is safe to resume.

Difficulty-balanced batches use `data/difficulty-song-additions.json` and can be imported with `npm run db:import-difficulty-additions`. Each decade must contain exactly 10 songs in each difficulty tier, with a unique prevalidated YouTube ID for every track.

For phones to join, they must be able to reach the address shown in the browser. On a home network, open the game on the host using the computer's LAN IP (for example `http://192.168.1.20:8080`), not `localhost`. For internet play, deploy behind HTTPS with a public hostname. Run a single container replica unless room storage is moved to Redis.

## CI/CD

`.github/workflows/docker-build.yml` builds a multi-arch (amd64/arm64) image on every push to `main`, on version tags (`v*.*.*`), and on pull requests (build-only, not pushed). Pushes to `main` publish `ghcr.io/ethan-chriswell/music-game:latest`.
