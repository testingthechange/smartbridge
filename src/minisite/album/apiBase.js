// src/minisite/album/apiBase.js
export function getApiBase() {
  // ✅ ENV ONLY (no fallback)
  return String(import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "").trim();
}
