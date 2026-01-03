// src/lib/runS3Converter.js
// Single-source backend URL (NO imports so it can’t break)
const API_BASE =
  (import.meta.env.VITE_BACKEND_URL || "").trim() ||
  "https://album-backend-c7ed.onrender.com";

// NOTE: this calls the Render publisher endpoint
export async function runS3Converter({ projectId, snapshotKey }) {
  const res = await fetch(`${API_BASE}/api/publish-minisite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, snapshotKey }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) throw new Error(json?.error || text || `Request failed (${res.status})`);
  return json;
}
