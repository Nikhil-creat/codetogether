import React, { useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext.jsx";
import AuthScreen from "./AuthScreen.jsx";
import Dashboard from "./Dashboard.jsx";
import Room from "./Room.jsx";

function Shell() {
  const { user } = useAuth();
  const [activeRoom, setActiveRoom] = useState(null);

  if (!user) return <AuthScreen />;
  if (!activeRoom) return <Dashboard onOpenRoom={setActiveRoom} />;
  return <Room room={activeRoom} onLeave={() => setActiveRoom(null)} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
