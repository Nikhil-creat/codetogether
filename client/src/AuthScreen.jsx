import React, { useState } from "react";
import { useAuth } from "./AuthContext.jsx";

export default function AuthScreen() {
  const { login, API_BASE } = useAuth();
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      login(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>⚡ CodeTogether</h1>
        <p className="subtitle">Real-time collaborative code editor — professional edition</p>

        <div className="tabs">
          <button className={mode === "login" ? "tab active" : "tab"} onClick={() => setMode("login")}>Login</button>
          <button className={mode === "register" ? "tab active" : "tab"} onClick={() => setMode("register")}>Register</button>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
