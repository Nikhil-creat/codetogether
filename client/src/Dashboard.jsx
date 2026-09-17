import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

export default function Dashboard({ onOpenRoom }) {
  const { apiFetch, user, logout } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRoomName, setNewRoomName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");

  const refresh = () => {
    apiFetch("/api/rooms").then((r) => r.json()).then((data) => { setRooms(data); setLoading(false); });
  };
  useEffect(refresh, []);

  const createRoom = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    const res = await apiFetch("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name: newRoomName, isPrivate }),
    });
    const room = await res.json();
    if (!res.ok) return setError(room.error);
    setNewRoomName("");
    refresh();
    onOpenRoom(room);
  };

  const joinRoom = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    const res = await apiFetch("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    });
    const room = await res.json();
    if (!res.ok) return setError(room.error);
    setInviteCode("");
    refresh();
    onOpenRoom(room);
  };

  return (
    <div className="lobby">
      <div className="lobby-card wide">
        <div className="dash-header">
          <div>
            <h1>⚡ CodeTogether</h1>
            <p className="subtitle">Welcome back, {user?.username}</p>
          </div>
          <button className="link-btn" onClick={logout}>Log out</button>
        </div>

        <div className="dash-forms">
          <form onSubmit={createRoom} className="dash-form">
            <h4>Create a workspace</h4>
            <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Room name" />
            <label className="checkbox-row">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              Private (invite-only)
            </label>
            <button type="submit">Create</button>
          </form>

          <form onSubmit={joinRoom} className="dash-form">
            <h4>Join with invite code</h4>
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="e.g. AB12CD" />
            <button type="submit">Join</button>
          </form>
        </div>

        {error && <p className="error">{error}</p>}

        <h3>Your workspaces</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rooms.length === 0 ? (
          <p className="muted">No workspaces yet — create one above.</p>
        ) : (
          <ul className="room-list">
            {rooms.map((room) => (
              <li key={room.id}>
                <div>
                  <strong>{room.name}</strong>
                  <span className="lang-badge">{room.role}</span>
                  {room.isPrivate ? <span className="lang-badge">🔒 {room.inviteCode}</span> : null}
                </div>
                <button onClick={() => onOpenRoom(room)}>Open</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
