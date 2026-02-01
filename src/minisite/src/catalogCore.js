// FILE: src/catalogCore.js
// Canonical local project persistence + minimal helpers.
// Goal: Catalog (and later Album/Songs/etc.) can read/write a single project blob by projectId.
// Storage key: project_<projectId>

const KEY_PREFIX = "project_";

function projectKey(projectId) {
  return `${KEY_PREFIX}${String(projectId || "").trim()}`;
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function loadProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;

  const raw = localStorage.getItem(projectKey(pid));
  const parsed = raw ? safeParse(raw) : null;
  if (parsed && typeof parsed === "object") return parsed;

  return null;
}

export function saveProject(projectId, project) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("saveProject: missing projectId");
  if (!project || typeof project !== "object") throw new Error("saveProject: project must be an object");

  const next = {
    ...project,
    projectId: String(project.projectId || pid),
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(projectKey(pid), JSON.stringify(next));
  return next;
}

// Create a minimal default project if none exists (idempotent)
export function ensureProject(projectId, patch = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("ensureProject: missing projectId");

  const existing = loadProject(pid);
  if (existing) return existing;

  const base = {
    projectId: pid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    catalog: { songs: [] }, // songs: [{ slot, title, files?: { album?: { s3Key } } }]
    album: {
      playlistOrder: Array.from({ length: 9 }, (_, i) => i + 1),
      locks: { playlistComplete: false, metaComplete: false, coverComplete: false },
      meta: { albumTitle: "", artistName: "", releaseDate: "" },
      cover: { fileName: "", s3Key: "", previewUrl: "" },
      masterSave: null,
    },
    master: { isMasterSaved: false, masterSavedAt: "", lastSnapshotKey: "" },
    publish: { snapshotKey: "" },
  };

  const next = deepMerge(base, patch);
  saveProject(pid, next);
  return next;
}

// Update ONE section (e.g. "catalog") and persist. Returns updated project.
export function setSection(projectId, sectionKey, sectionValue) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("setSection: missing projectId");
  const key = String(sectionKey || "").trim();
  if (!key) throw new Error("setSection: missing sectionKey");

  const current = loadProject(pid) || ensureProject(pid);
  const next = {
    ...current,
    [key]: sectionValue,
    updatedAt: new Date().toISOString(),
  };
  return saveProject(pid, next);
}

// Optional: read a section safely
export function getSection(projectId, sectionKey) {
  const p = loadProject(projectId);
  if (!p) return null;
  return p[String(sectionKey || "").trim()] ?? null;
}

// ------- helpers -------
function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return b ?? a;
  if (!isObj(a) || !isObj(b)) return b ?? a;

  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = isObj(out[k]) && isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}
