import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>Telephony Dashboard</h1>
      <p>SMS, WhatsApp, Voice Calls, TTS/STT — for AI agents.</p>
      <p>API: <a href="/api/messages">/api/messages</a> | <a href="/api/agents">/api/agents</a> | <a href="/api/numbers">/api/numbers</a> | <a href="/health">/health</a></p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
