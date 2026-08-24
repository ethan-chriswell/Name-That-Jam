"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const root = path.join(__dirname, "..");
const seedPath = path.join(root, "data", "songs.json");
const databasePath = process.env.SONG_DATABASE || path.join(root, "data", "songs.db");
const songs = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const database = new Database(databasePath);

database.pragma("journal_mode = WAL");
database.exec(`
  DROP TABLE IF EXISTS songs;
  CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    decade TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    youtube_video_id TEXT NOT NULL,
    release_year INTEGER CHECK(release_year BETWEEN 1900 AND 2100),
    difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'normal', 'hard')),
    UNIQUE(decade, title, artist)
  );
  CREATE INDEX IF NOT EXISTS idx_songs_decade ON songs(decade);
`);

const replaceCatalog = database.transaction(() => {
  database.prepare("DELETE FROM songs").run();
  const insert = database.prepare(`
    INSERT INTO songs (decade, title, artist, youtube_video_id, release_year, difficulty)
    VALUES (@decade, @title, @artist, @videoId, @releaseYear, @difficulty)
  `);
  for (const [decade, entries] of Object.entries(songs)) {
    for (const [title, artist, videoId, releaseYear, catalogTier = "easy"] of entries) {
      const difficulty = { popular: "easy", deep: "hard" }[catalogTier] || catalogTier;
      if (!["easy", "normal", "hard"].includes(difficulty)) {
        throw new Error(`Invalid difficulty for ${artist} — ${title}: ${catalogTier}`);
      }
      insert.run({ decade, title, artist, videoId,
        releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
        difficulty });
    }
  }
});

replaceCatalog();
database.pragma("wal_checkpoint(TRUNCATE)");
const count = database.prepare("SELECT COUNT(*) AS count FROM songs").get().count;
const yearCount = database.prepare("SELECT COUNT(release_year) AS count FROM songs").get().count;
database.close();
console.log(`Built ${databasePath} with ${count} songs (${yearCount} with verified release years).`);
