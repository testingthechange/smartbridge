// FILE: src/minisite/catalogCore.js

// Local project storage + small helpers.
// IMPORTANT: smartbridge2 is a static site.
// Uploads must use the publisher/admin backend endpoints (POST /api/upload-to-s3, GET /api/playback-url, etc).

const LS_PREFIX = "project_";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function projectKey(projectId) {
  return `${LS_PREFIX}${String(projectId || "").trim()}`;
}

export function loadProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;
  const raw = localStorage.getItem(projectKey(pid));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function saveProject(projectId, project) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("saveProject: missing projectId");
  if (!project || typeof project !== "object") throw new Error("saveProject: project must be an object");
  localStorage.setItem(projectKey(pid), JSON.stringify(project));
  return project;
}

export function ensureProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("ensureProject: missing projectId");

  const existing = loadProject(pid);
  if (existing) return existing;

  const now = new Date().toISOString();
  const fresh = {
    projectId: pid,
    createdAt: now,
    updatedAt: now,
    catalog: { songs: [] },
    master: { isMasterSaved: false, masterSavedAt: "", lastSnapshotKey: "" },
    publish: { snapshotKey: "" },
  };

  saveProject(pid, fresh);
  return fresh;
}

/**
 * setSection(projectId, "catalog", {...}) etc
 * Options:
 *  - returnProject: true => returns the full updated project object (useful for React state)
 */
export function setSection(projectId, sectionKey, sectionValue, opts = {}) {
  const pid = String(projectId || "").trim();
  const key = String(sectionKey || "").trim();
  if (!pid) throw new Error("setSection: missing projectId");
  if (!key) throw new Error("setSection: missing sectionKey");

  const current = loadProject(pid) || ensureProject(pid);
  const next = {
    ...current,
    [key]: sectionValue,
    updatedAt: new Date().toISOString(),
  };

  saveProject(pid, next);
  return opts?.returnProject ? next : sectionValue;
}

/* -------- time formatting (fixes your crash) -------- */
export function fmtTime(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* -------- API helpers -------- */
export function getApiBase() {
  return String(import.meta.env.VITE_API_BASE || "").trim().replace(/\/+$/, "");
}

/**
 * POST /api/upload-to-s3?projectId=...
 * smartbridge2 is a STATIC SITE. It must NOT call /api/upload-to-s3 on itself.
 * It calls your publisher/admin backend specified by VITE_API_BASE.
 */
export async function uploadSongFile({ apiBase, projectId, slot, versionKey, file }) {
  const base = String(apiBase || getApiBase() || "").replace(/\/+$/, "");
  if (!base) throw new Error("uploadSongFile: missing apiBase (set VITE_API_BASE)");
  if (!projectId) throw new Error("uploadSongFile: missing projectId");
  if (!file) throw new Error("uploadSongFile: missing file");

  const url = `${base}/api/upload-to-s3?projectId=${encodeURIComponent(projectId)}&slot=${encodeURIComponent(
    String(slot || "")
  )}&versionKey=${encodeURIComponent(String(versionKey || ""))}`;

  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(url, { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Upload failed (HTTP ${res.status})`);
  return json;
}

/**
 * GET /api/playback-url?s3Key=...
 */
export async function fetchPlaybackUrl({ apiBase, s3Key }) {
  const base = String(apiBase || getApiBase() || "").replace(/\/+$/, "");
  if (!base) throw new Error("fetchPlaybackUrl: missing apiBase (set VITE_API_BASE)");
  const key = String(s3Key || "").trim();
  if (!key) return "";

  const res = await fetch(`${base}/api/playback-url?s3Key=${encodeURIComponent(key)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Playback URL failed (HTTP ${res.status})`);
  return String(json?.url || "");
}
