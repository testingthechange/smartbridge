// src/components/MasterSaveButton.jsx
import { useState } from "react";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "https://album-backend-c7ed.onrender.com";

export default function MasterSaveButton({ projectId, project, beforeSave }) {
  const [status, setStatus] = useState("");

  const handleClick = async () => {
    console.log("[MasterSaveButton] CLICK", { projectId, BACKEND_URL });

    if (beforeSave && beforeSave() === false) {
      console.log("[MasterSaveButton] blocked by beforeSave()");
      return;
    }

    setStatus("Saving…");

    try {
      const url = `${BACKEND_URL.replace(/\/$/, "")}/api/master-save`;
      console.log("[MasterSaveButton] POST", url);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, project }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("[MasterSaveButton] RESPONSE", res.status, data);

      if (!res.ok || !data.ok) {
        setStatus(`❌ Save failed (${res.status})`);
        return;
      }

      setStatus("✅ Saved to S3");
    } catch (err) {
      console.error("[MasterSaveButton] ERROR", err);
      setStatus("❌ Network error");
    }
  };

  return (
    <div>
      <button onClick={handleClick} style={{ padding: "10px 12px" }}>
        Master Save
      </button>
      {status ? <div style={{ marginTop: 8 }}>{status}</div> : null}
    </div>
  );
}
