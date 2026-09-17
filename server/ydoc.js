import * as Y from "yjs";
import { db } from "./db.js";

// In-memory live Y.Docs, keyed by `${roomId}:${filename}`
const liveDocs = new Map();
const saveTimers = new Map();

function loadPersistedState(roomId, filename) {
  const row = db.prepare("SELECT ydoc_state FROM files WHERE room_id = ? AND filename = ?").get(roomId, filename);
  return row?.ydoc_state || null;
}

export function getOrCreateDoc(roomId, filename, boilerplate = "") {
  const key = `${roomId}:${filename}`;
  if (liveDocs.has(key)) return liveDocs.get(key);

  const ydoc = new Y.Doc();
  const persisted = loadPersistedState(roomId, filename);
  if (persisted) {
    Y.applyUpdate(ydoc, new Uint8Array(persisted));
  } else if (boilerplate) {
    ydoc.getText("content").insert(0, boilerplate);
  }

  ydoc.on("update", () => scheduleSave(roomId, filename, ydoc));
  liveDocs.set(key, ydoc);
  return ydoc;
}

function scheduleSave(roomId, filename, ydoc) {
  const key = `${roomId}:${filename}`;
  clearTimeout(saveTimers.get(key));
  saveTimers.set(
    key,
    setTimeout(() => {
      const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
      db.prepare(
        "UPDATE files SET ydoc_state = ?, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND filename = ?"
      ).run(state, roomId, filename);
    }, 600)
  );
}

export function docKey(roomId, filename) {
  return `${roomId}:${filename}`;
}

export { liveDocs };
