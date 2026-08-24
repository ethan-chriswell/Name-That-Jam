"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const catalogPath = path.join(root, "data", "songs.json");
const additionsPath = path.join(root, "data", "difficulty-song-additions.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const additions = JSON.parse(fs.readFileSync(additionsPath, "utf8"));
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const existingSongs = new Set(Object.values(catalog).flat().map(song =>
  `${normalize(song[0])}|${normalize(song[1])}`));
const existingVideos = new Set(Object.values(catalog).flat().map(song => song[2]));

for (const [decade, songs] of Object.entries(additions)) {
  const counts = { easy: 0, normal: 0, hard: 0 };
  for (const [title, artist, year, difficulty, videoId] of songs) {
    if (!(difficulty in counts)) throw new Error(`Invalid difficulty: ${difficulty}`);
    counts[difficulty] += 1;
    if (!videoId) throw new Error(`Missing YouTube ID for ${artist} — ${title}`);
    const key = `${normalize(title)}|${normalize(artist)}`;
    if (existingSongs.has(key)) throw new Error(`Duplicate song: ${artist} — ${title}`);
    if (existingVideos.has(videoId)) throw new Error(`Duplicate YouTube ID: ${videoId}`);
    catalog[decade].push([title, artist, videoId, year, difficulty]);
    existingSongs.add(key);
    existingVideos.add(videoId);
  }
  for (const [difficulty, count] of Object.entries(counts)) {
    if (count !== 10) throw new Error(`${decade} must contain 10 ${difficulty} songs; found ${count}`);
  }
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Imported ${Object.values(additions).flat().length} difficulty-tiered songs.`);
