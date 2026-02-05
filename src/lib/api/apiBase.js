// FILE: src/lib/api/apiBase.js

export function getApiBase() {
  // Vite injects this at build time
  const v = (import.meta?.env?.VITE_API_BASE ?? "").toString().trim();

  // Allow local override via window for debugging if desired
  // (does not break build; optional)
  const w = (typeof window !== "undefined" && window.__VITE_API_BASE__) ? String(window.__VITE_API_BASE__).trim() : "";

  return w || v;
}

export function requireApiBase() {
  const base = getApiBase();
  if (!base) throw new Error("VITE_API_BASE not set");
  return base;
}

// Compatibility export for code that imports `API_BASE`
export const API_BASE = getApiBase();
