import React, { useEffect, useRef, useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { useAuth } from "./AuthContext.jsx";

const COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2"];
const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];

function b64ToBytes(b64) { return new Uint8Array(atob(b64).split("").map((c) => c.charCodeAt(0))); }
function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }

// Apply a Yjs delta (retain/insert/delete ops) to a Monaco model
function applyYDeltaToModel(model, delta) {
  let index = 0;
  const edits = [];
  for (const op of delta) {
    if (op.retain) {
      index += op.retain;
    } else if (op.insert) {
      const pos = model.getPositionAt(index);
      edits.push({ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text: op.insert });
      index += op.insert.length;
    } else if (op.delete) {
      const startPos = model.getPositionAt(index);
      const endPos = model.getPositionAt(index + op.delete);
      edits.push({ range: { startLineNumber: startPos.lineNumber, startColumn: startPos.column, endLineNumber: endPos.lineNumber, endColumn: endPos.column }, text: "" });
    }
  }
  if (edits.length) model.applyEdits(edits);
}

export default function Room({ room, onLeave }) {
  const { apiFetch, API_BASE, user } = useAuth();
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState([]);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);

  const wsRef = useRef(null);
  const ydocRef = useRef(null);
  const ytextRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const isRemoteApplying = useRef(false);

  // Load file list
  useEffect(() => {
    apiFetch(`/api/rooms/${room.id}/files`).then((r) => r.json()).then((f) => {
      setFiles(f);
      if (f.length && !activeFile) setActiveFile(f[0].filename);
    });
    apiFetch(`/api/rooms/${room.id}/chat`).then((r) => r.json()).then(setChat);
  }, [room.id]);

  // Connect to WS + bind Yjs doc whenever active file changes
  useEffect(() => {
    if (!activeFile) return;
    const token = localStorage.getItem("ce_token");
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("content");
    ydocRef.current = ydoc;
    ytextRef.current = ytext;

    const wsBase = API_BASE.replace(/^http/, "ws");
    const params = new URLSearchParams({ token, room: room.id, file: activeFile, color: myColor });
    const ws = new WebSocket(`${wsBase}/?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "sync" || msg.type === "update") {
        Y.applyUpdate(ydoc, b64ToBytes(msg.update), "remote");
      } else if (msg.type === "presence") {
        setPresence(msg.presence);
      } else if (msg.type === "chat") {
        setChat((prev) => [...prev, msg]);
      }
    };

    const updateHandler = (update, origin) => {
      if (origin === "remote") return;
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "update", update: bytesToB64(update) }));
    };
    ydoc.on("update", updateHandler);

    const observer = (event) => {
      if (event.transaction.origin === "remote") {
        const model = editorRef.current?.getModel();
        if (!model) return;
        isRemoteApplying.current = true;
        applyYDeltaToModel(model, event.delta);
        isRemoteApplying.current = false;
      }
    };
    ytext.observe(observer);

    // sync initial content into a fresh editor model once doc has synced
    const initTimer = setTimeout(() => {
      const model = editorRef.current?.getModel();
      if (model && model.getValue() !== ytext.toString()) {
        isRemoteApplying.current = true;
        model.setValue(ytext.toString());
        isRemoteApplying.current = false;
      }
    }, 300);

    return () => {
      clearTimeout(initTimer);
      ydoc.off("update", updateHandler);
      ytext.unobserve(observer);
      ws.close();
      ydoc.destroy();
    };
  }, [activeFile, room.id]);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    if (ytextRef.current) editor.getModel().setValue(ytextRef.current.toString());

    editor.onDidChangeModelContent((e) => {
      if (isRemoteApplying.current) return;
      const ydoc = ydocRef.current, ytext = ytextRef.current;
      if (!ydoc || !ytext) return;
      Y.transact(ydoc, () => {
        for (const change of e.changes) {
          if (change.rangeLength > 0) ytext.delete(change.rangeOffset, change.rangeLength);
          if (change.text) ytext.insert(change.rangeOffset, change.text);
        }
      }, "local");
    });

    editor.onDidChangeCursorPosition((e) => {
      wsRef.current?.readyState === 1 &&
        wsRef.current.send(JSON.stringify({ type: "cursor", cursor: { line: e.position.lineNumber, column: e.position.column } }));
    });
  };

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const monaco = monacoRef.current;
    const others = presence.filter((p) => p.username !== user.username && p.cursor);
    const newDecorations = others.map((p) => ({
      range: new monaco.Range(p.cursor.line, p.cursor.column, p.cursor.line, p.cursor.column + 1),
      options: { className: "remote-cursor", beforeContentClassName: "remote-cursor-flag", hoverMessage: { value: p.username } },
    }));
    decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, newDecorations);
  }, [presence]);

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    wsRef.current?.send(JSON.stringify({ type: "chat", text: chatInput }));
    setChatInput("");
  };

  const createFile = async (e) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    const ext = newFileName.split(".").pop();
    const language = { js: "javascript", py: "python", cpp: "cpp" }[ext] || "javascript";
    const res = await apiFetch(`/api/rooms/${room.id}/files`, {
      method: "POST",
      body: JSON.stringify({ filename: newFileName, language }),
    });
    if (res.ok) {
      const f = await res.json();
      setFiles((prev) => [...prev, f]);
      setActiveFile(f.filename);
      setNewFileName("");
      setShowNewFile(false);
    }
  };

  const currentFileMeta = files.find((f) => f.filename === activeFile);

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <button className="link-btn" onClick={onLeave}>← Dashboard</button>
          <strong className="room-title">{room.name}</strong>
          {room.isPrivate && <span className="lang-badge">🔒 {room.inviteCode}</span>}
        </div>
        <div className="status">
          <span className={`dot ${connected ? "online" : "offline"}`} />
          {connected ? "Live · CRDT synced" : "Reconnecting…"}
        </div>
      </header>

      <div className="room-body">
        <nav className="file-tree">
          <h4>Files</h4>
          <ul>
            {files.map((f) => (
              <li key={f.filename} className={f.filename === activeFile ? "active" : ""} onClick={() => setActiveFile(f.filename)}>
                {f.filename}
              </li>
            ))}
          </ul>
          {showNewFile ? (
            <form onSubmit={createFile} className="new-file-form">
              <input autoFocus value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="app.py" />
              <button type="submit">+</button>
            </form>
          ) : (
            <button className="link-btn" onClick={() => setShowNewFile(true)}>+ New file</button>
          )}
        </nav>

        <div className="editor-wrap">
          <Editor
            height="100%"
            theme="vs-dark"
            language={currentFileMeta?.language || "javascript"}
            onMount={handleEditorMount}
            options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true }}
          />
        </div>

        <aside className="sidebar">
          <div className="presence-panel">
            <h4>Online ({presence.length})</h4>
            <ul>
              {presence.map((p) => (
                <li key={p.userId}>
                  <span className="avatar" style={{ background: p.color }}>{p.username[0]?.toUpperCase()}</span>
                  {p.username} {p.username === user.username && "(you)"}
                </li>
              ))}
            </ul>
          </div>
          <div className="chat-panel">
            <h4>Chat</h4>
            <div className="chat-messages">
              {chat.map((m, i) => (
                <div key={i} className="chat-msg">
                  <span className="chat-author" style={{ color: m.color }}>{m.username}:</span> {m.text}
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="chat-input">
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message the room…" />
              <button type="submit">Send</button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}
