import React, { createContext, useContext, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("ce_token"));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("ce_user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback((t, u) => {
    localStorage.setItem("ce_token", t);
    localStorage.setItem("ce_user", JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("ce_token");
    localStorage.removeItem("ce_user");
    setToken(null);
    setUser(null);
  }, []);

  const apiFetch = useCallback(
    (path, opts = {}) =>
      fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers || {}),
        },
      }),
    [token]
  );

  return (
    <AuthContext.Provider value={{ token, user, login, logout, apiFetch, API_BASE }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
