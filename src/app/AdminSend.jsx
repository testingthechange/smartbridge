import React, { useState } from "react";
import { getApiBase } from "../lib/api/apiBase.js";

export default function AdminSend() {
  const [projectId, setProjectId] = useState("409074");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const pid = String(projectId || "").trim();
    const em = String(email || "").trim();
    if (!pid) return window.alert("Missing projectId");
    if (!em) return window.alert("Missing email");

    setBusy(true);
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/magic-link/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: pid, email: em }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok !== true) throw new Error(json?.error || `HTTP ${res.status}`);

      window.alert(`Sent.\n\nProject: ${json.projectId}\nTo: ${json.email}\nExpires: ${json.expiresAt}`);
    } catch (e) {
      window.alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h2>Admin: Send Magic Link</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        <label style={{ fontSize: 12, opacity: 0.75 }}>Project ID</label>
        <input value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ padding: 10 }} />

        <label style={{ fontSize: 12, opacity: 0.75 }}>Producer Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10 }} />

        <button onClick={send} disabled={busy} style={{ padding: "10px 12px", marginTop: 10 }}>
          {busy ? "Sending..." : "Send magic link email"}
        </button>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Uses backend: <code>{getApiBase()}/api/magic-link/send</code>
        </div>
      </div>
    </div>
  );
}
