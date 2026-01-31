// FILE: src/lib/api/apiBase.js

export const FALLBACK_API_BASE = "https://album-backend-c7ed.onrender.com";

export function getApiBase() {
  const raw =
    String(import.meta.env.VITE_API_BASE || "").trim() ||
    String(import.meta.env.VITE_BACKEND_URL || "").trim() ||
    "";

  const base = raw.replace(/\/+$/, "");
  return base || FALLBACK_API_BASE;
}
