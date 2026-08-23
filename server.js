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

function publicState(room, viewerId) {
  const song = room.queue[room.round] || null;
  const viewer = room.players.get(viewerId);
  const reveal = room.phase === "reveal" || room.phase === "finished";
  return {
    code: room.code,
    phase: room.phase,
    isHost: viewerId === room.hostId,
    round: room.round + 1,
    totalRounds: room.settings.rounds,
    decade: song?.decade || null,
    videoId: viewerId === room.hostId ? song?.videoId || null : null,
    choices: song?.choices || [],
    answer: reveal && song ? { title: song.title, artist: song.artist } : null,
    answered: Boolean(viewer?.answer),
    deadline: room.phase === "question" || room.phase === "countdown" ? room.deadline : null,
    players: [...room.players.values()].map(({ id, name, score, answer }) => ({
      id, name, score, answered: Boolean(answer)
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
    if (player.answer?.correct && !player.answer.scored) {
      player.score += 100;
      player.answer.scored = true;
    }
  });
  room.phase = "reveal";
  room.deadline = null;
  broadcast(room);
}

function beginQuestion(room) {
  room.phase = "question";
  room.deadline = Date.now() + room.settings.seconds * 1000;
  room.timer = setTimeout(() => {
    if (room.phase === "question") revealRound(room);
  }, room.settings.seconds * 1000);
  broadcast(room);
}

function beginCountdown(room) {
  clearTimeout(room.timer);
  room.phase = "countdown";
  room.deadline = Date.now() + 3000;
  room.timer = setTimeout(() => beginQuestion(room), 3000);
  broadcast(room);
}

function makeQueue(settings) {
  const pool = getSongsByDecades(settings.decades);
  return shuffle(pool).slice(0, Math.min(settings.rounds, pool.length)).map(song => {
    const distractors = shuffle(pool.filter(other => other.title !== song.title)).slice(0, 3);
    return { ...song, choices: shuffle([song, ...distractors]).map(item => `${item.title} — ${item.artist}`) };
  });
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
    const decades = Array.isArray(raw?.decades) ? raw.decades.filter(d => DECADES.includes(d)) : [];
    const settings = {
      decades: decades.length ? decades : DECADES,
      rounds: [5, 10, 15].includes(Number(raw?.rounds)) ? Number(raw.rounds) : 10,
      seconds: [10, 20, 30].includes(Number(raw?.seconds)) ? Number(raw.seconds) : 20
    };
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
    const answer = String(value);
    if (!song.choices.includes(answer)) return;
    const correct = answer === `${song.title} — ${song.artist}`;
    player.answer = { value: answer, correct };
    broadcast(room);
  });

  socket.on("reveal", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== "question") return;
    revealRound(room);
  });

  socket.on("next-round", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== "reveal") return;
    if (room.round + 1 >= room.queue.length) room.phase = "finished";
    else {
      room.round += 1;
      room.players.forEach(player => { player.answer = null; });
      beginCountdown(room);
    }
    broadcast(room);
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

server.listen(PORT, "0.0.0.0", () => console.log(`Decade Dial listening on ${PORT}`));

module.exports = { server, makeQueue, cleanName };
