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
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    decade TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    youtube_video_id TEXT NOT NULL,
    UNIQUE(decade, title, artist)
  );
  CREATE INDEX IF NOT EXISTS idx_songs_decade ON songs(decade);
`);

const replaceCatalog = database.transaction(() => {
  database.prepare("DELETE FROM songs").run();
  const insert = database.prepare(`
    INSERT INTO songs (decade, title, artist, youtube_video_id)
    VALUES (@decade, @title, @artist, @videoId)
  `);
  for (const [decade, entries] of Object.entries(songs)) {
    for (const [title, artist, videoId] of entries) insert.run({ decade, title, artist, videoId });
  }
});

replaceCatalog();
database.pragma("wal_checkpoint(TRUNCATE)");
const count = database.prepare("SELECT COUNT(*) AS count FROM songs").get().count;
database.close();
console.log(`Built ${databasePath} with ${count} songs.`);
