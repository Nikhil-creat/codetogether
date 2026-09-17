import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: "Username required; password must be 6+ characters" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Username already taken" });

  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
  const token = jwt.sign({ id: info.lastInsertRowid, username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: info.lastInsertRowid, username } });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, username: user.username } });
});

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });
  const token = header.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function verifyTokenString(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export default router;
