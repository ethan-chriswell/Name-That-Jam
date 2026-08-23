"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const catalogPath = path.join(root, "data", "songs.json");
const additionsPath = path.join(root, "data", "song-additions.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const additions = JSON.parse(fs.readFileSync(additionsPath, "utf8"));
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const existing = new Map(Object.values(catalog).flat().map(song => [`${normalize(song[0])}|${normalize(song[1])}`, song]));

for (const [decade, songs] of Object.entries(additions)) {
  if (songs.length !== 25) throw new Error(`${decade} must contain exactly 25 additions`);
  for (const [index, [title, artist, year, manualVideoId]] of songs.entries()) {
    const key = `${normalize(title)}|${normalize(artist)}`;
    const popularity = index < 10 ? "popular" : "deep";
    if (existing.has(key)) {
      existing.get(key)[4] = popularity;
      console.log(`${decade}: already imported ${artist} — ${title}`);
      continue;
    }
    let match = manualVideoId ? { id: manualVideoId } : null;
    if (!match) {
      const query = `ytsearch1:${artist} ${title} official audio`;
      const result = spawnSync("python3", ["-m", "yt_dlp", "--flat-playlist", "--dump-single-json", query], {
        cwd: root,
        env: { ...process.env, PYTHONPATH: path.join(root, ".tools") },
        encoding: "utf8", timeout: 45000
      });
      if (result.status !== 0) throw new Error(`YouTube lookup failed for ${artist} — ${title}: ${result.stderr}`);
      const response = JSON.parse(result.stdout);
      match = response.entries?.[0];
    }
    if (!match?.id) throw new Error(`No YouTube result for ${artist} — ${title}`);
    const song = [title, artist, match.id, year, popularity];
    catalog[decade].push(song);
    existing.set(key, song);
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`${decade}: ${artist} — ${title} (${match.id})`);
  }
}
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
