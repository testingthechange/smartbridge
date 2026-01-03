// src/minisite/album/albumStorage.js

export function readText(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null || v === undefined ? fallback : String(v);
  } catch {
    return fallback;
  }
}

export function writeText(key, val) {
  try {
    localStorage.setItem(key, String(val ?? ""));
  } catch {}
}

export function readBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    return v === "true";
  } catch {
    return fallback;
  }
}

export function writeBool(key, val) {
  try {
    localStorage.setItem(key, val ? "true" : "false");
  } catch {}
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
}
