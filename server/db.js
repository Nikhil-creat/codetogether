import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, "data.sqlite"));

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  is_private INTEGER DEFAULT 0,
  invite_code TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'editor',
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  language TEXT DEFAULT 'javascript',
  ydoc_state BLOB,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_id, filename)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  username TEXT NOT NULL,
  color TEXT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

export default db;
