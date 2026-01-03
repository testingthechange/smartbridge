// src/lib/apiBase.js
export const API_BASE =
  (import.meta.env.VITE_BACKEND_URL || "").trim() ||
  "https://album-backend-c7ed.onrender.com";
