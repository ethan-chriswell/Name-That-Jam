"use strict";

const fs = require("node:fs");
const path = require("node:path");

const catalogPath = path.join(__dirname, "..", "data", "songs.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const pending = Object.entries(catalog).flatMap(([decade, songs]) =>
  songs.map(song => ({ decade, song })).filter(({ song }) => !Number.isInteger(song[3]))
);
const batchSize = Math.max(1, Number(process.env.YEAR_BATCH_SIZE || 10));

const normalize = value => String(value).toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]/g, "");
const escapeQuery = value => String(value).replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, "\\$&");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function enrichBatch(batch) {
  const query = batch.map(({ song }) =>
    `(recording:"${escapeQuery(song[0])}" AND artist:"${escapeQuery(song[1])}")`
  ).join(" OR ");
  const url = new URL("https://musicbrainz.org/ws/2/recording");
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "100");
  let response;
  for (let attempt = 1; attempt <= 5; attempt++) {
    response = await fetch(url, { headers: { "User-Agent": "DecadeDial/2.0 (music trivia catalog)" } });
    if (response.ok) break;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 5) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await enrichBatch(batch.slice(0, middle));
        await sleep(1100);
        await enrichBatch(batch.slice(middle));
        return;
      }
      console.warn(`\nSkipping unavailable lookup: ${batch[0].song[1]} — ${batch[0].song[0]}`);
      return;
    }
    await sleep(attempt * 2000);
  }
  const { recordings = [] } = await response.json();
  for (const entry of batch) {
    const title = normalize(entry.song[0]);
    const decadeStart = Number(entry.decade.slice(0, 4));
    const candidates = recordings.filter(recording => {
      const year = Number(String(recording["first-release-date"] || "").slice(0, 4));
      const credited = normalize((recording["artist-credit"] || []).map(item => item.name || item.artist?.name).join(" "));
      const expectedArtist = normalize(entry.song[1].replace(/\b(ft\.?|feat\.?).*$/i, ""));
      return normalize(recording.title) === title && credited.includes(expectedArtist)
        && year >= decadeStart - 1 && year <= decadeStart + 10;
    }).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    if (candidates[0]) entry.song[3] = Number(candidates[0]["first-release-date"].slice(0, 4));
  }
}

(async () => {
  for (let index = 0; index < pending.length; index += batchSize) {
    await enrichBatch(pending.slice(index, index + batchSize));
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    process.stdout.write(`\rChecked ${Math.min(index + batchSize, pending.length)} / ${pending.length}`);
    if (index + batchSize < pending.length) await sleep(1100);
  }
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const unresolved = pending.filter(({ song }) => !Number.isInteger(song[3]));
  console.log(`\nResolved ${pending.length - unresolved.length}; unresolved ${unresolved.length}.`);
  unresolved.forEach(({ decade, song }) => console.log(`${decade}: ${song[1]} — ${song[0]}`));
  if (unresolved.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
