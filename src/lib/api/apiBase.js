// src/lib/apiBase.js
// Canonical env var: VITE_API_BASE
// Legacy supported: VITE_BACKEND_URL

export const API_BASE =
  (import.meta.env.VITE_API_BASE || "").trim() ||
  (import.meta.env.VITE_BACKEND_URL || "").trim() ||
  "";

export function requireApiBase(override = "") {
  const base = String(override || API_BASE || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("Missing VITE_API_BASE in .env.local");
  }
  return base;
}
