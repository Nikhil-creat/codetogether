import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { db } from "./db.js";
import authRouter, { authMiddleware, verifyTokenString } from "./auth.js";
import { getOrCreateDoc, liveDocs } from "./ydoc.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRouter);

function genId(base) {
  return base.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Date.now().toString(36);
}
function genInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const BOILERPLATE = {
  javascript: "// Welcome to the team workspace!\nfunction hello() {\n  console.log('Hello, team!');\n}\n",
  python: "# Welcome to the team workspace!\ndef hello():\n    print('Hello, team!')\n",
  cpp: "#include <iostream>\nint main() {\n  std::cout << \"Hello, team!\" << std::endl;\n}\n",
};
function extFor(lang) {
  return { javascript: "js", python: "py", cpp: "cpp" }[lang] || "txt";
}

// ---------- Rooms ----------
app.post("/api/rooms", authMiddleware, (req, res) => {
  const { name, isPrivate } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Room name required" });
  const id = genId(name);
  const inviteCode = genInviteCode();
  db.prepare("INSERT INTO rooms (id, name, owner_id, is_private, invite_code) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, req.user.id, isPrivate ? 1 : 0, inviteCode);
  db.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user.id);
  db.prepare("INSERT INTO files (room_id, filename, language) VALUES (?, 'main.js', 'javascript')").run(id);
  getOrCreateDoc(id, "main.js", BOILERPLATE.javascript);
  res.json({ id, name, isPrivate: !!isPrivate, inviteCode, role: "owner" });
});

app.get("/api/rooms", authMiddleware, (req, res) => {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.is_private as isPrivate, r.invite_code as inviteCode, r.created_at as createdAt, rm.role
    FROM rooms r JOIN room_members rm ON r.id = rm.room_id
    WHERE rm.user_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json(rooms);
});

app.post("/api/rooms/join", authMiddleware, (req, res) => {
  const { inviteCode } = req.body;
  const room = db.prepare("SELECT * FROM rooms WHERE invite_code = ?").get(inviteCode?.toUpperCase());
  if (!room) return res.status(404).json({ error: "Invalid invite code" });
  db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'editor')")
    .run(room.id, req.user.id);
  res.json({ id: room.id, name: room.name, isPrivate: !!room.is_private, inviteCode: room.invite_code, role: "editor" });
});

function requireMember(req, res, next) {
  const membership = db.prepare("SELECT * FROM room_members WHERE room_id = ? AND user_id = ?")
    .get(req.params.roomId, req.user.id);
  if (!membership) return res.status(403).json({ error: "Not a member of this room" });
  req.membership = membership;
  next();
}

// ---------- Files (multi-file project support) ----------
app.get("/api/rooms/:roomId/files", authMiddleware, requireMember, (req, res) => {
  const files = db.prepare("SELECT filename, language, updated_at as updatedAt FROM files WHERE room_id = ? ORDER BY filename")
    .all(req.params.roomId);
  res.json(files);
});

app.post("/api/rooms/:roomId/files", authMiddleware, requireMember, (req, res) => {
  let { filename, language } = req.body;
  language = language || "javascript";
  if (!filename?.trim()) filename = `untitled.${extFor(language)}`;
  try {
    db.prepare("INSERT INTO files (room_id, filename, language) VALUES (?, ?, ?)")
      .run(req.params.roomId, filename, language);
    getOrCreateDoc(req.params.roomId, filename, BOILERPLATE[language] || "");
    res.json({ filename, language });
  } catch (e) {
    res.status(409).json({ error: "A file with that name already exists" });
  }
});

app.get("/api/rooms/:roomId/chat", authMiddleware, requireMember, (req, res) => {
  const rows = db.prepare(
    "SELECT username, color, text, created_at as ts FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT 50"
  ).all(req.params.roomId);
  res.json(rows.reverse());
});

// ---------- WebSocket: Yjs CRDT sync + presence + chat ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// per-doc connected clients, for presence + broadcasting updates
const docClients = new Map(); // key -> Map<ws, {userId, username, color, cursor}>

function b64ToBytes(b64) { return new Uint8Array(Buffer.from(b64, "base64")); }
function bytesToB64(bytes) { return Buffer.from(bytes).toString("base64"); }

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  const roomId = url.searchParams.get("room");
  const filename = url.searchParams.get("file");
  const color = url.searchParams.get("color") || "#888888";

  const user = verifyTokenString(token);
  if (!user || !roomId || !filename) { ws.close(4001, "Unauthorized"); return; }

  const membership = db.prepare("SELECT * FROM room_members WHERE room_id = ? AND user_id = ?").get(roomId, user.id);
  if (!membership) { ws.close(4003, "Forbidden"); return; }

  const key = `${roomId}:${filename}`;
  const ydoc = getOrCreateDoc(roomId, filename);
  if (!docClients.has(key)) docClients.set(key, new Map());
  const clients = docClients.get(key);
  clients.set(ws, { userId: user.id, username: user.username, color, cursor: null });

  const updateListener = (update, origin) => {
    if (origin === ws) return; // don't echo back to sender
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "update", update: bytesToB64(update) }));
  };
  ydoc.on("update", updateListener);

  // initial full sync
  ws.send(JSON.stringify({ type: "sync", update: bytesToB64(Y.encodeStateAsUpdate(ydoc)) }));
  broadcastPresence(clients);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "update") {
      Y.applyUpdate(ydoc, b64ToBytes(msg.update), ws); // tag origin=ws so we skip echo
    } else if (msg.type === "cursor") {
      const c = clients.get(ws);
      if (c) c.cursor = msg.cursor;
      broadcastPresence(clients);
    } else if (msg.type === "chat") {
      db.prepare("INSERT INTO chat_messages (room_id, username, color, text) VALUES (?, ?, ?, ?)")
        .run(roomId, user.username, color, msg.text);
      const payload = JSON.stringify({ type: "chat", username: user.username, color, text: msg.text, ts: Date.now() });
      for (const client of clients.keys()) if (client.readyState === 1) client.send(payload);
    }
  });

  ws.on("close", () => {
    ydoc.off("update", updateListener);
    clients.delete(ws);
    broadcastPresence(clients);
    if (clients.size === 0) docClients.delete(key);
  });
});

function broadcastPresence(clients) {
  const presence = Array.from(clients.values()).map((c) => ({
    userId: c.userId, username: c.username, color: c.color, cursor: c.cursor,
  }));
  const payload = JSON.stringify({ type: "presence", presence });
  for (const client of clients.keys()) if (client.readyState === 1) client.send(payload);
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`CodeTogether server (auth + SQLite + Yjs CRDT) on :${PORT}`));
