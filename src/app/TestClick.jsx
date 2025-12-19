import React, { useState } from "react";

const BACKEND =
  import.meta.env.VITE_BACKEND_URL || "https://album-backend-c7ed.onrender.com";

export default function TestClick() {
  const [msg, setMsg] = useState("");

  const handleClick = async () => {
    console.log("CLICK IS LIVE");
    setMsg("Calling /api/master-save…");

    const url = `${BACKEND.replace(/\/$/, "")}/api/master-save?ts=${Date.now()}`;
    const body = {
      projectId: "proj_001",
      project: {
        source: "testclick",
        ping: "pong",
        savedAt: new Date().toISOString(),
      },
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      console.log("MASTER SAVE HTTP:", res.status, data);

      if (!res.ok || !data.ok) {
        setMsg(`❌ failed (HTTP ${res.status}) ${data.error || ""}`);
        return;
      }

      setMsg(`✅ saved! snapshotKey: ${data.snapshotKey}`);
    } catch (e) {
      console.error("MASTER SAVE FAIL:", e);
      setMsg(`❌ fetch error: ${e.message}`);
    }
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>MASTER SAVE CLICK TEST</h1>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        BACKEND: {BACKEND}
      </div>

      <button onClick={handleClick} style={{ padding: "10px 14px" }}>
        Test Master Save (POST)
      </button>

      {msg && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 12 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
