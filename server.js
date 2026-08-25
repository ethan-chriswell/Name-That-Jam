"use strict";

const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { listDecades, getSongsByDecades } = require("./database");

const PORT = Number(process.env.PORT || 8080);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

const DECADES = listDecades();

function code() {
  let value;
  do value = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(value));
  return value;
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cleanName(value) {
  return String(value || "Player").trim().replace(/\s+/g, " ").slice(0, 24) || "Player";
}

function normalizeAnswer(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

function textMatches(value, candidate) {
  const guess = normalizeAnswer(value);
  if (guess.length < 2) return false;
  const expected = normalizeAnswer(candidate);
  const tolerance = expected.length >= 12 ? 2 : expected.length >= 6 ? 1 : 0;
  return guess === expected || editDistance(guess, expected) <= tolerance;
}

function typedAnswerMatches(value, song) {
  return [song.title, song.artist].some(candidate => textMatches(value, candidate));
}

function publicState(room, viewerId) {
  const song = room.queue[room.round] || null;
  const viewer = room.players.get(viewerId);
  const reveal = room.phase === "reveal" || room.phase === "finished";
  return {
    code: room.code,
    phase: room.phase,
    isHost: viewerId === room.hostId,
    round: room.round + 1,
    totalRounds: room.queue.length || room.settings.rounds,
    decade: song?.decade || null,
    videoId: viewerId === room.hostId ? song?.videoId || null : null,
    choices: viewerId === room.hostId || room.settings.mode !== "mc" ? [] : song?.choices || [],
    answer: reveal && song ? { title: song.title, artist: song.artist, releaseYear: song.releaseYear } : null,
    answered: Boolean(viewer?.answer),
    deadline: ["question", "countdown", "reveal"].includes(room.phase) ? room.deadline : null,
    players: [...room.players.values()].map(({ id, name, score, answer }) => ({
      id, name, score, answered: Boolean(answer),
      roundPoints: reveal ? answer?.points || 0 : null,
      roundCorrect: reveal ? Boolean(answer?.correct) : null,
      roundArtistBonus: reveal ? Boolean(answer?.artistBonus) : null,
      roundYearBonus: reveal ? Boolean(answer?.yearBonus) : null
    })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    settings: room.settings
  };
}

function broadcast(room) {
  io.to(room.code).fetchSockets().then(sockets => {
    sockets.forEach(socket => socket.emit("state", publicState(room, socket.id)));
  });
}

function revealRound(room) {
  clearTimeout(room.timer);
  if (room.phase !== "question") return;
  room.players.forEach(player => {
    if (player.answer?.points > 0 && !player.answer.scored) {
      player.score += player.answer.points;
      player.answer.scored = true;
    }
  });
  room.phase = "reveal";
  room.deadline = Date.now() + 6000;
  room.timer = setTimeout(() => advanceRound(room), 6000);
  broadcast(room);
}

function advanceRound(room) {
  clearTimeout(room.timer);
  if (room.phase !== "reveal") return;
  if (room.round + 1 >= room.queue.length) {
    room.phase = "finished";
    room.deadline = null;
    broadcast(room);
    return;
  }
  room.round += 1;
  room.players.forEach(player => { player.answer = null; });
  beginCountdown(room);
}

function beginQuestion(room) {
  if (room.phase !== "loading") return;
  room.phase = "question";
  room.deadline = Date.now() + room.settings.seconds * 1000;
  room.timer = setTimeout(() => {
    if (room.phase === "question") revealRound(room);
  }, room.settings.seconds * 1000);
  broadcast(room);
}

function beginLoading(room) {
  room.phase = "loading";
  room.deadline = null;
  broadcast(room);
}

function beginCountdown(room) {
  clearTimeout(room.timer);
  room.phase = "countdown";
  room.deadline = Date.now() + 3000;
  room.timer = setTimeout(() => beginLoading(room), 3000);
  broadcast(room);
}

function makeQueue(settings) {
  const pool = getSongsByDecades(settings.decades)
    .filter(song => settings.mode !== "year" || Number.isInteger(song.releaseYear));
  const target = Math.min(settings.rounds, pool.length);
  const tierOrder = {
    easy: ["easy", "normal", "hard"],
    normal: ["normal", "easy", "hard"],
    hard: ["hard", "normal", "easy"]
  }[settings.difficulty];
  const selected = [];
  for (const tier of tierOrder) {
    const remaining = target - selected.length;
    if (!remaining) break;
    selected.push(...shuffle(pool.filter(song => song.difficulty === tier)).slice(0, remaining));
  }
  return shuffle(selected).map(song => {
    const distractors = shuffle(pool.filter(other => other.title !== song.title)).slice(0, 3);
    return { ...song, choices: shuffle([song, ...distractors]).map(item => `${item.title} — ${item.artist}`) };
  });
}

function buildSettings(raw) {
  const decades = Array.isArray(raw?.decades) ? raw.decades.filter(d => DECADES.includes(d)) : [];
  const difficulty = ["easy", "normal", "hard"].includes(raw?.difficulty) ? raw.difficulty : "normal";
  return {
    decades: decades.length ? decades : DECADES,
    rounds: [5, 10, 15].includes(Number(raw?.rounds)) ? Number(raw.rounds) : 10,
    seconds: { easy: 45, normal: 30, hard: 20 }[difficulty],
    difficulty,
    mode: ["type", "year"].includes(raw?.mode) ? raw.mode : "mc"
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.type("text").send("ok\n"));
app.get("/api/rooms/:code/qr", async (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).end();
  const joinUrl = `${req.protocol}://${req.get("host")}/?room=${room.code}`;
  res.type("image/svg+xml").send(await QRCode.toString(joinUrl, { type: "svg", margin: 1, width: 260 }));
});

io.on("connection", socket => {
  socket.on("create-room", (raw, reply = () => {}) => {
    const settings = buildSettings(raw);
    const roomCode = code();
    const room = { code: roomCode, hostId: socket.id, phase: "lobby", round: 0, settings,
      queue: [], players: new Map(), deadline: null, timer: null, createdAt: Date.now() };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    reply({ ok: true, code: roomCode });
    broadcast(room);
  });

  socket.on("join-room", (raw, reply = () => {}) => {
    const roomCode = String(raw?.code || "").replace(/\D/g, "");
    const room = rooms.get(roomCode);
    if (!room) return reply({ ok: false, error: "That room does not exist." });
    if (room.phase !== "lobby") return reply({ ok: false, error: "That game has already started." });
    room.players.set(socket.id, { id: socket.id, name: cleanName(raw?.name), score: 0, answer: null });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    reply({ ok: true });
    broadcast(room);
  });

  socket.on("restart-room", (raw, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return reply({ ok: false, error: "Not the host." });
    if (!["lobby", "finished"].includes(room.phase)) return reply({ ok: false, error: "Game is still in progress." });
    clearTimeout(room.timer);
    room.settings = buildSettings(raw);
    room.phase = "lobby";
    room.round = 0;
    room.queue = [];
    room.deadline = null;
    room.timer = null;
    room.players.forEach(player => { player.score = 0; player.answer = null; });
    reply({ ok: true });
    broadcast(room);
  });

  socket.on("start-game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || !room.players.size) return;
    room.queue = makeQueue(room.settings);
    room.round = 0;
    beginCountdown(room);
  });

  socket.on("answer", value => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    const song = room?.queue[room.round];
    if (!room || !player || !song || room.phase !== "question" || player.answer) return;
    const millisecondsLeft = Math.max(0, room.deadline - Date.now());
    const speedRatio = Math.min(1, millisecondsLeft / (room.settings.seconds * 1000));
    let answer, correct, artistBonus = false, yearBonus = false;
    if (room.settings.mode === "year") {
      const title = String(value?.title || "").trim();
      const artist = String(value?.artist || "").trim();
      const yearGuess = Number(value?.year);
      const hasYear = Number.isInteger(yearGuess) && yearGuess >= 1900 && yearGuess <= 2100;
      if (!title || title.length > 100 || artist.length > 100) return;
      answer = { title, year: hasYear ? yearGuess : null, artist };
      correct = textMatches(title, song.title);
      yearBonus = hasYear && yearGuess === song.releaseYear;
      artistBonus = Boolean(artist) && textMatches(artist, song.artist);
    } else {
      answer = String(value);
      if (room.settings.mode === "mc" && !song.choices.includes(answer)) return;
      if (room.settings.mode === "type" && (!answer.trim() || answer.length > 100)) return;
      correct = room.settings.mode === "type"
        ? typedAnswerMatches(answer, song)
        : answer === `${song.title} — ${song.artist}`;
    }
    const points = (correct ? Math.round(500 + 500 * speedRatio) : 0) + (yearBonus ? 250 : 0) + (artistBonus ? 250 : 0);
    player.answer = { value: answer, correct, artistBonus, yearBonus, points, submittedAt: Date.now(), scored: false };
    broadcast(room);
  });

  socket.on("playback-started", rawRound => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== "loading") return;
    if (Number(rawRound) !== room.round + 1) return;
    beginQuestion(room);
  });

  socket.on("reveal", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== "question") return;
    revealRound(room);
  });

  socket.on("next-round", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== "reveal") return;
    advanceRound(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId === socket.id) {
      clearTimeout(room.timer);
      io.to(room.code).emit("room-closed");
      rooms.delete(room.code);
    } else {
      room.players.delete(socket.id);
      broadcast(room);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  rooms.forEach((room, key) => { if (room.createdAt < cutoff) rooms.delete(key); });
}, 60 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => console.log(`Name That Jam listening on ${PORT}`));

module.exports = { server, makeQueue, cleanName };
