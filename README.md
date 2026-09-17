# CodeTogether — Real-Time Collaborative Code Editor (Professional Edition)

A production-shaped, full-stack real-time collaborative code editor: multiple engineers editing
the same project simultaneously with conflict-free merging, live cursors, multi-file workspaces,
JWT authentication, and persistent storage.

## Why this is "advanced," not a toy demo

| Concern | Naive approach | What this project does |
|---|---|---|
| Concurrent editing | Broadcast full text, last-write-wins (data loss on conflict) | **Yjs CRDT** — every keystroke becomes a conflict-free operation; two people can type in the same line simultaneously with no lost edits |
| Editor binding | Diff whole document on every change | Listens to Monaco's precise `onDidChangeModelContent` deltas and applies them as CRDT ops — O(edit size), not O(document size) |
| Persistence | In-memory only / flat JSON files | **SQLite** (via better-sqlite3) with a real relational schema: users, rooms, memberships, files, chat history |
| Auth | None / trust the client | **JWT + bcrypt-hashed passwords**, verified on both REST endpoints and the WebSocket handshake |
| Access control | Anyone can join any room | Room membership table; private rooms gated by invite code |
| Projects | Single file per room | **Multi-file workspaces** — each room is a mini project with its own file tree, each file its own CRDT document |
| Deployment | "run npm start and hope" | Dockerfile per service + `docker-compose.yml` for one-command spin-up |

## Architecture

```
collab-editor/
├── server/
│   ├── index.js     Express REST API + WebSocket CRDT relay + presence + chat
│   ├── db.js         SQLite schema (users, rooms, room_members, files, chat_messages)
│   ├── auth.js        JWT auth (register/login) + middleware
│   ├── ydoc.js         Per-file Y.Doc lifecycle + debounced persistence
│   └── Dockerfile
└── client/
    ├── src/
    │   ├── AuthContext.jsx   token/user state + authenticated fetch helper
    │   ├── AuthScreen.jsx     login / register
    │   ├── Dashboard.jsx       create/join workspaces
    │   ├── Room.jsx             file tree + Yjs-bound Monaco editor + presence + chat
    │   └── styles.css
    └── Dockerfile              multi-stage build served via nginx
```

### How the CRDT sync actually works
1. Each file is backed by a `Y.Doc` containing a `Y.Text`, kept authoritative on the server and
   mirrored in every connected client.
2. On connect, the server sends `Y.encodeStateAsUpdate(doc)` — the file's full current CRDT state.
3. When you type, Monaco reports the exact edit (`rangeOffset`, `rangeLength`, inserted text). That's
   applied directly to the local `Y.Text`, which emits a binary Yjs update.
4. That update is sent over the WebSocket, applied to the server's `Y.Doc` (broadcasting to every
   other client), and independently to everyone else's local `Y.Doc`.
5. Each client's `Y.Text.observe()` receives the resulting delta and applies it back onto the Monaco
   model at the correct offsets — so two people typing in the same paragraph converge to the same
   result with no manual conflict resolution.
6. The server debounce-persists `Y.encodeStateAsUpdate(doc)` as a BLOB in SQLite, so reconnecting
   (or the server restarting) never loses work.

This hand-rolled Yjs↔Monaco binding (rather than pulling in `y-monaco`/`y-websocket` as black
boxes) is a strong interview talking point: you can explain exactly how CRDT convergence,
offset math, and the update/observe event flow work.

## Setup & Run (local, no Docker)

Requires Node.js 18+.

```bash
# Terminal 1 — backend
cd server
npm install
npm start                 # http://localhost:4000

# Terminal 2 — frontend
cd client
npm install
npm run dev                # http://localhost:5173
```

Register two different accounts in two browser tabs (or use one account in two tabs), create a
workspace, and start typing — edits, cursors, and chat sync instantly.

## Setup & Run (Docker, one command)

```bash
docker compose up --build
# frontend → http://localhost:8080
# backend  → http://localhost:4000
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | server | Signs auth tokens — **set a real secret in production** |
| `VITE_API_BASE` | client (build-time) | URL of the backend, e.g. `https://api.yourdomain.com` |

## Resume-ready talking points
- Implemented CRDT-based real-time collaborative editing (Yjs) with a hand-written Monaco binding,
  not a copy-pasted library integration — can explain offset math and convergence guarantees.
- Designed a relational schema (SQLite) for users/rooms/memberships/files/chat from scratch.
- JWT auth validated on both HTTP routes and the WebSocket upgrade path.
- Multi-file, multi-room architecture — each file is an independent CRDT document, debounce-persisted.
- Containerized both services with Dockerfiles + docker-compose for reproducible deployment.

## Roadmap / good "future work" slide
- Swap SQLite for Postgres + connection pooling for multi-instance horizontal scaling.
- Redis pub/sub so WebSocket state is shared across multiple server instances.
- In-browser code execution sandbox (e.g. Judge0 API) to actually run submitted code.
- Role-based permissions (viewer vs editor vs owner) enforced per-file.
- Voice/video via WebRTC alongside the code session.
