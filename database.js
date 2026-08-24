"use strict";

const path = require("node:path");
const Database = require("better-sqlite3");

const databasePath = process.env.SONG_DATABASE || path.join(__dirname, "data", "songs.db");
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const listDecadesStatement = database.prepare("SELECT DISTINCT decade FROM songs ORDER BY decade");
const songsByDecadeStatement = database.prepare(`
  SELECT decade, title, artist, youtube_video_id AS videoId, release_year AS releaseYear, difficulty
  FROM songs
  WHERE decade = ?
`);

function listDecades() {
  return listDecadesStatement.all().map(row => row.decade);
}

function getSongsByDecades(decades) {
  return decades.flatMap(decade => songsByDecadeStatement.all(decade));
}

module.exports = { database, listDecades, getSongsByDecades };
